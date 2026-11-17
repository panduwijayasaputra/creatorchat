import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalDiskStorage, verifyLocalSignature, type SignedParts } from './local-disk-storage.js';
import { R2Storage } from './r2-storage.js';

const SECRET = 's'.repeat(40);
const CREATOR = '11111111-1111-4111-8111-111111111111';
const ASSET = '22222222-2222-4222-8222-222222222222';
const KEY = `m/${CREATOR}/${ASSET}`;
const T0 = new Date('2026-11-18T10:00:00.000Z');

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'cc-storage-'));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const make = (now = T0) => new LocalDiskStorage(dir, SECRET, 'http://api.test', () => now);

function parse(url: string) {
  const u = new URL(url);
  const q = u.searchParams;
  const parts: SignedParts = {
    method: q.get('m') as 'PUT' | 'GET',
    key: u.pathname.replace('/v1/dev-storage/', ''),
    expires: Number(q.get('e')),
    length: Number(q.get('l')),
    type: q.get('t') ?? '',
  };
  return { parts, signature: q.get('s') ?? '' };
}

describe('local signatures', () => {
  it('accepts an untouched PUT url and rejects any tampered part', async () => {
    const { url } = await make().presignPut(KEY, {
      contentType: 'image/jpeg',
      contentLength: 1000,
      expiresInSeconds: 900,
    });
    const { parts, signature } = parse(url);
    expect(verifyLocalSignature(SECRET, parts, signature, T0)).toBe(true);
    const bad = [
      { ...parts, method: 'GET' as const },
      { ...parts, key: `m/${CREATOR}/${CREATOR}` },
      { ...parts, expires: parts.expires + 1 },
      { ...parts, length: 1001 },
      { ...parts, type: 'video/mp4' },
    ];
    for (const b of bad) expect(verifyLocalSignature(SECRET, b, signature, T0)).toBe(false);
    expect(verifyLocalSignature('x'.repeat(40), parts, signature, T0)).toBe(false);
    expect(verifyLocalSignature(SECRET, parts, 'zz', T0)).toBe(false);
  });

  it('expires', async () => {
    const url = await make().presignGet(KEY, { expiresInSeconds: 60 });
    const { parts, signature } = parse(url);
    expect(verifyLocalSignature(SECRET, parts, signature, new Date(T0.getTime() + 59_000))).toBe(
      true,
    );
    expect(verifyLocalSignature(SECRET, parts, signature, new Date(T0.getTime() + 61_000))).toBe(
      false,
    );
  });

  it('rejects a key outside the server-made shapes even when correctly signed', () => {
    const parts: SignedParts = {
      method: 'GET',
      key: '../../etc/passwd',
      expires: Math.floor(T0.getTime() / 1000) + 60,
      length: 0,
      type: 'x',
    };
    expect(verifyLocalSignature(SECRET, parts, 'aa', T0)).toBe(false);
  });
});

describe('LocalDiskStorage files', () => {
  it.each([
    '../x',
    '/etc/passwd',
    'm/a/b',
    `m/${CREATOR}/${ASSET}/../x`,
    `m/${CREATOR}/${ASSET}/evil`,
  ])('refuses the key %s', async (key) => {
    await expect(make().head(key)).rejects.toThrow('Invalid storage key.');
    await expect(make().presignGet(key, { expiresInSeconds: 5 })).rejects.toThrow();
  });

  it('stores, heads, reads a range, downloads and deletes', async () => {
    const s = make();
    expect(await s.head(KEY)).toBeNull();
    const source = path.join(dir, 'source.bin');
    await writeFile(source, Buffer.from('0123456789'));
    await s.upload(KEY, source, 'image/jpeg');
    expect(await s.head(KEY)).toEqual({ size: 10 });
    expect((await s.readRange(KEY, 2, 4)).toString()).toBe('234');
    expect((await s.readRange(KEY, 8, 99)).toString()).toBe('89');
    const copy = path.join(dir, 'copy.bin');
    await s.download(KEY, copy);
    expect((await readFile(copy)).toString()).toBe('0123456789');
    await s.delete(KEY);
    await s.delete(KEY); // a missing object counts as deleted
    expect(await s.head(KEY)).toBeNull();
  });

  it('keeps an original and its thumbnail side by side', async () => {
    const s = make();
    const source = path.join(dir, 'both.bin');
    await writeFile(source, Buffer.from('xyz'));
    const key = `m/${CREATOR}/55555555-5555-4555-8555-555555555555`;
    await s.upload(key, source, 'image/jpeg');
    await s.upload(`${key}/thumb.webp`, source, 'image/webp');
    expect(await s.head(key)).toEqual({ size: 3 });
    expect(await s.head(`${key}/thumb.webp`)).toEqual({ size: 3 });
  });

  it('streams a body to the object and stops at the size cap without leaving a file', async () => {
    const s = make();
    const key = `m/${CREATOR}/33333333-3333-4333-8333-333333333333`;
    expect(
      await s.writeStream(key, Readable.from([Buffer.from('abcd'), Buffer.from('ef')]), 100),
    ).toBe(6);
    expect((await s.head(key))?.size).toBe(6);
    const big = `m/${CREATOR}/44444444-4444-4444-8444-444444444444`;
    await expect(s.writeStream(big, Readable.from([Buffer.alloc(50)]), 10)).rejects.toThrow();
    expect(await s.head(big)).toBeNull();
  });
});

describe('R2Storage', () => {
  it('signs the content type and length into the PUT url without any network call', async () => {
    const r2 = new R2Storage({
      endpoint: 'https://acct.r2.example.test',
      bucket: 'bucket',
      accessKeyId: 'AKID',
      secretAccessKey: 'SECRET',
    });
    const put = await r2.presignPut(KEY, {
      contentType: 'video/mp4',
      contentLength: 12345,
      expiresInSeconds: 900,
    });
    const url = new URL(put.url);
    expect(url.hostname).toContain('r2.example.test');
    const signed = url.searchParams.get('X-Amz-SignedHeaders') ?? '';
    expect(signed).toContain('content-length');
    expect(signed).toContain('content-type');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(put.headers).toEqual({ 'Content-Type': 'video/mp4' });
    expect(put.url).not.toContain('SECRET');
    const get = await r2.presignGet(KEY, { expiresInSeconds: 300, contentType: 'image/webp' });
    expect(get).toContain('response-content-type=image%2Fwebp');
  });
});
