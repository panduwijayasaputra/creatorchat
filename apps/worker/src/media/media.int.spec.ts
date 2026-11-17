import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Writable } from 'node:stream';
import {
  FixedWindowLimiter,
  loadEnv,
  LocalDiskStorage,
  MediaAccessService,
  MediaUploadService,
  OutboxService,
  type RateLimiterRedis,
} from '@creatorchat/backend-core';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { probe } from './ffmpeg.js';
import { MEDIA_MAX_ATTEMPTS, MediaEventHandler } from './media-events.js';
import { MediaProcessor } from './media-processor.js';
import { startMedia, type Media } from './media.js';

loadRootEnv();
const run = promisify(execFile);
const prisma: PrismaClient = createTestPrisma();
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const prefix = `test:bull:${randomUUID()}`;
const ffmpeg = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };

let dir: string;
let fixtures: string;
let storage: LocalDiskStorage;
let uploads: MediaUploadService;
let maxVideoSeconds = 300;
let n = 99_000n;
let codeNo = 0;

function fakeRedis(): RateLimiterRedis {
  const values = new Map<string, number>();
  return {
    get: async (k) => (values.has(k) ? String(values.get(k)) : null),
    incr: async (k) => {
      values.set(k, (values.get(k) ?? 0) + 1);
      return values.get(k) as number;
    },
    ttl: async () => 600,
    set: async (k, v, _m, _s, flag) => {
      if (flag === 'NX' && values.has(k)) return null;
      values.set(k, Number(v));
      return 'OK';
    },
  };
}

const makeProcessor = () =>
  new MediaProcessor({ prisma, storage, uploads, ffmpeg, maxVideoSeconds });

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'cc-worker-media-'));
  fixtures = await mkdtemp(path.join(tmpdir(), 'cc-fixtures-'));
  storage = new LocalDiskStorage(dir, 's'.repeat(40), 'http://api.test');
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(fixtures, { recursive: true, force: true });
  const redis = new Redis(redisUrl);
  const keys = await redis.keys(`${prefix}:*`);
  if (keys.length > 0) await redis.del(...keys);
  redis.disconnect();
  await prisma.$disconnect();
});
beforeEach(async () => {
  codeNo = 0;
  maxVideoSeconds = 300;
  await resetDatabase(prisma);
  uploads = new MediaUploadService({
    prisma,
    storage,
    outbox: new OutboxService(),
    limiter: new FixedWindowLimiter(fakeRedis(), 'test:media:worker'),
    access: new MediaAccessService(prisma, storage),
    limits: { photoMaxBytes: 5_000_000, videoMaxBytes: 50_000_000, videoMaxSeconds: 300 },
  });
});

async function makeCreator() {
  const user = await prisma.user.create({
    data: { telegramId: n++, displayName: 'Salsa', role: 'CREATOR' },
  });
  return prisma.creator.create({
    data: { userId: user.id, publicCode: `wwwwwww${'abcdefgh'[codeNo++]}` },
  });
}

async function jpegWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: '#cc3333' } })
    .withExif({
      IFD0: { Copyright: 'private-note' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '37/1 25/1 19/1',
        GPSLongitudeRef: 'W',
        GPSLongitude: '122/1 5/1 0/1',
      },
    })
    .jpeg()
    .toBuffer();
}

async function mp4WithLocation(seconds = 2): Promise<Buffer> {
  const file = path.join(fixtures, `v-${randomUUID()}.mp4`);
  await run('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `testsrc=duration=${seconds}:size=64x64:rate=10`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-metadata',
    'location=+37.4220-122.0841/',
    '-metadata',
    'com.apple.quicktime.location.ISO6709=+37.4220-122.0841/',
    '-movflags',
    'use_metadata_tags',
    file,
  ]);
  const { readFile } = await import('node:fs/promises');
  return readFile(file);
}

/** init → PUT the bytes → complete: the asset waits PROCESSING for the worker. */
async function uploaded(
  creator: { id: string; userId: string },
  bytes: Buffer,
  kind: 'PHOTO' | 'VIDEO',
  contentType: string,
) {
  const r = await uploads.init(creator.userId, {
    clientUploadId: randomUUID(),
    kind,
    contentType,
    sizeBytes: bytes.length,
  });
  if (r.kind !== 'created') throw new Error(`init ${r.kind}`);
  const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: r.asset.id } });
  const source = path.join(fixtures, `up-${randomUUID()}`);
  await writeFile(source, bytes);
  await storage.upload(row.objectKey, source, contentType);
  const done = await uploads.complete(creator.userId, r.asset.id);
  if (done.kind !== 'ok' || done.asset.state !== 'PROCESSING') throw new Error('complete failed');
  return row;
}

const asset = (id: string) => prisma.mediaAsset.findUniqueOrThrow({ where: { id } });

describe('MediaProcessor: photos', () => {
  it('removes EXIF/GPS, writes a thumbnail and adds gallery item #1', async () => {
    const creator = await makeCreator();
    const bytes = await jpegWithGps();
    expect((await sharp(bytes).metadata()).exif).toBeDefined(); // the fixture really has EXIF
    const row = await uploaded(creator, bytes, 'PHOTO', 'image/jpeg');

    expect(await makeProcessor().process(row.id)).toBe('ready');

    const after = await asset(row.id);
    expect(after.state).toBe('READY');
    expect(after.width).toBe(64);
    expect(after.height).toBe(48);
    expect(after.thumbKey).toBe(`${row.objectKey}/thumb.webp`);
    const cleaned = path.join(fixtures, 'cleaned-check');
    await storage.download(row.objectKey, cleaned);
    const meta = await sharp(cleaned).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.format).toBe('jpeg');
    expect(Number(after.sizeBytes)).toBe((await storage.head(row.objectKey))?.size);
    const thumb = path.join(fixtures, 'thumb-check');
    await storage.download(after.thumbKey as string, thumb);
    expect(await sharp(thumb).metadata()).toMatchObject({
      format: 'webp',
      width: 480,
      height: 480,
    });
    const items = await prisma.galleryItem.findMany({ where: { creatorId: creator.id } });
    expect(items.map((i) => i.seq)).toEqual([1]);
  });

  it('fails a JPEG that only starts with the right bytes as UNREADABLE and deletes the object', async () => {
    const creator = await makeCreator();
    const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(900, 0x41)]);
    const row = await uploaded(creator, bytes, 'PHOTO', 'image/jpeg');
    expect(await makeProcessor().process(row.id)).toBe('failed');
    expect(await asset(row.id)).toMatchObject({ state: 'FAILED', failureCode: 'UNREADABLE' });
    expect(await storage.head(row.objectKey)).toBeNull();
    expect(await prisma.galleryItem.count()).toBe(0);
  });

  it('a second run of the same job does not add a second gallery item', async () => {
    const creator = await makeCreator();
    const row = await uploaded(creator, await jpegWithGps(), 'PHOTO', 'image/jpeg');
    const processor = makeProcessor();
    expect(await processor.process(row.id)).toBe('ready');
    expect(await processor.process(row.id)).toBe('skipped');
    expect(await prisma.galleryItem.count()).toBe(1);
  });
});

describe('MediaProcessor: chat uploads', () => {
  it('a chat-only upload becomes READY with its thumbnail but no gallery item or media number', async () => {
    const creator = await makeCreator();
    const customer = await prisma.user.create({ data: { telegramId: n++, displayName: 'Rani' } });
    await prisma.subscription.create({
      data: {
        customerId: customer.id,
        creatorId: creator.id,
        startsAt: new Date(Date.now() - 86_400_000),
        endsAt: new Date(Date.now() + 86_400_000),
      },
    });
    const conversation = await prisma.conversation.create({
      data: { customerId: customer.id, creatorId: creator.id },
    });
    const bytes = await jpegWithGps();
    const init = await uploads.init(creator.userId, {
      clientUploadId: randomUUID(),
      kind: 'PHOTO',
      contentType: 'image/jpeg',
      sizeBytes: bytes.length,
      purpose: 'CHAT',
      conversationId: conversation.id,
    });
    if (init.kind !== 'created') throw new Error(init.kind);
    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: init.asset.id } });
    const source = path.join(fixtures, `chat-${randomUUID()}`);
    await writeFile(source, bytes);
    await storage.upload(row.objectKey, source, 'image/jpeg');
    await uploads.complete(creator.userId, row.id);

    expect(await makeProcessor().process(row.id)).toBe('ready');
    const after = await asset(row.id);
    expect(after).toMatchObject({
      state: 'READY',
      purpose: 'CHAT',
      conversationId: conversation.id,
    });
    expect(await storage.head(after.thumbKey as string)).not.toBeNull();
    expect(await prisma.galleryItem.count()).toBe(0);
    expect(
      (await prisma.creator.findUniqueOrThrow({ where: { id: creator.id } })).lastGallerySeq,
    ).toBe(0);
  });
});

describe('MediaProcessor: videos', () => {
  it('remuxes without the location tag, records the duration and writes a poster thumbnail', async () => {
    const creator = await makeCreator();
    const bytes = await mp4WithLocation(2);
    const source = path.join(fixtures, 'orig.mp4');
    await writeFile(source, bytes);
    const before = JSON.stringify(
      await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', source]),
    );
    expect(before).toContain('37.4220'); // the fixture really carries a location

    const row = await uploaded(creator, bytes, 'VIDEO', 'video/mp4');
    expect(await makeProcessor().process(row.id)).toBe('ready');

    const after = await asset(row.id);
    expect(after.state).toBe('READY');
    expect(after.mime).toBe('video/mp4');
    expect(Math.abs((after.durationMs ?? 0) - 2000)).toBeLessThan(300);
    expect([after.width, after.height]).toEqual([64, 64]);
    const cleaned = path.join(fixtures, 'cleaned.mp4');
    await storage.download(row.objectKey, cleaned);
    const raw = (
      await run('ffprobe', [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        cleaned,
      ])
    ).stdout;
    expect(raw).not.toContain('37.4220');
    const parsed = JSON.parse(raw) as {
      format: { tags?: Record<string, string> };
      streams: { tags?: Record<string, string> }[];
    };
    const tagKeys = [parsed.format, ...parsed.streams].flatMap((x) => Object.keys(x.tags ?? {}));
    expect(tagKeys.filter((k) => /location|iso6709/i.test(k))).toEqual([]);
    expect((await probe(ffmpeg, cleaned)).video?.codec).toBe('h264');
    expect(await storage.head(after.thumbKey as string)).not.toBeNull();
    expect(await prisma.galleryItem.count()).toBe(1);
  });

  it('fails a video longer than the limit as TOO_LONG and deletes its objects', async () => {
    const creator = await makeCreator();
    maxVideoSeconds = 1;
    const row = await uploaded(creator, await mp4WithLocation(3), 'VIDEO', 'video/mp4');
    expect(await makeProcessor().process(row.id)).toBe('failed');
    expect(await asset(row.id)).toMatchObject({ state: 'FAILED', failureCode: 'TOO_LONG' });
    expect(await storage.head(row.objectKey)).toBeNull();
    expect(await prisma.galleryItem.count()).toBe(0);
  });

  it('fails a file with a video header but no readable streams as UNREADABLE', async () => {
    const creator = await makeCreator();
    const bytes = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from('ftypisom'),
      Buffer.alloc(300, 7),
    ]);
    const row = await uploaded(creator, bytes, 'VIDEO', 'video/mp4');
    expect(await makeProcessor().process(row.id)).toBe('failed');
    expect(await asset(row.id)).toMatchObject({ state: 'FAILED', failureCode: 'UNREADABLE' });
  });
});

describe('MediaEventHandler', () => {
  async function event(assetId: string) {
    return prisma.outboxEvent.findFirstOrThrow({
      where: { type: 'media.uploaded', aggregateId: assetId },
    });
  }

  it('finishes the event when the asset is processed, and ignores it when run again', async () => {
    const creator = await makeCreator();
    const row = await uploaded(creator, await jpegWithGps(), 'PHOTO', 'image/jpeg');
    const handler = new MediaEventHandler(prisma, makeProcessor(), uploads);
    const e = await event(row.id);
    expect(await handler.process(e.id)).toBe('ready');
    expect((await event(row.id)).status).toBe('DONE');
    expect(await handler.process(e.id)).toBe('duplicate');
  });

  it('retries an unexpected error later and gives up as FAILED / UNREADABLE after the last attempt', async () => {
    const creator = await makeCreator();
    const row = await uploaded(creator, await jpegWithGps(), 'PHOTO', 'image/jpeg');
    const broken = {
      process: async () => Promise.reject(new Error('disk on fire')),
    } as unknown as MediaProcessor;
    const handler = new MediaEventHandler(prisma, broken, uploads);
    const e = await event(row.id);
    for (let i = 1; i < MEDIA_MAX_ATTEMPTS; i++) {
      expect(await handler.process(e.id)).toBe('retry');
      const after = await event(row.id);
      expect(after.status).toBe('PENDING');
      expect(after.availableAt.getTime()).toBeGreaterThan(Date.now());
      expect(after.lastError).toBe('processing_error');
    }
    expect(await handler.process(e.id)).toBe('failed');
    expect((await event(row.id)).status).toBe('FAILED');
    expect(await asset(row.id)).toMatchObject({ state: 'FAILED', failureCode: 'UNREADABLE' });
  });
});

describe('startMedia', () => {
  let logs = '';
  const logger = pino(
    { level: 'info' },
    new Writable({ write: (c, _e, cb) => ((logs += String(c)), cb()) }),
  );
  let running: Media | null = null;
  const env = (over: Record<string, string | undefined> = {}) =>
    loadEnv({
      DATABASE_URL: process.env.DATABASE_URL_TEST,
      REDIS_URL: redisUrl,
      NODE_ENV: 'test',
      STORAGE_LOCAL_SIGNING_SECRET: 's'.repeat(40),
      ...over,
    });

  beforeEach(() => {
    logs = '';
  });
  afterAll(async () => {
    await running?.stop();
  });

  it('is not registered without ffprobe: one warning, and the uploaded event stays PENDING', async () => {
    const creator = await makeCreator();
    const row = await uploaded(creator, await jpegWithGps(), 'PHOTO', 'image/jpeg');
    const started = await startMedia({
      env: env({ FFPROBE_PATH: '/nonexistent/ffprobe' }),
      prisma,
      logger,
      storage,
      queuePrefix: prefix,
    });
    expect(started).toBeNull();
    expect(logs.match(/ffprobe was not found/g)).toHaveLength(1);
    expect(
      (await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: row.id } })).status,
    ).toBe('PENDING');
  });

  it('is not registered without storage settings', async () => {
    const started = await startMedia({
      env: env({ STORAGE_LOCAL_SIGNING_SECRET: undefined }),
      prisma,
      logger,
      queuePrefix: prefix,
    });
    expect(started).toBeNull();
    expect(logs).toContain('media unconfigured');
  });

  it('runs the whole pipeline: outbox → queue → processor → READY with a gallery item', async () => {
    const creator = await makeCreator();
    const row = await uploaded(creator, await jpegWithGps(), 'PHOTO', 'image/jpeg');
    running = await startMedia({
      env: env(),
      prisma,
      logger,
      storage,
      queuePrefix: prefix,
      intervalMs: 50,
    });
    expect(running).not.toBeNull();
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && (await asset(row.id)).state !== 'READY') {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect((await asset(row.id)).state).toBe('READY');
    expect(await prisma.galleryItem.count()).toBe(1);
    expect(
      (await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: row.id } })).status,
    ).toBe('DONE');
    await running?.stop();
    running = null;
    expect((await readdir(dir, { recursive: true })).length).toBeGreaterThan(0);
  });
});
