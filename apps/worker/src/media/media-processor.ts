import type {
  MediaFailureCode as MediaFailure,
  MediaUploadService,
  ObjectStorage,
} from '@creatorchat/backend-core';
import type { PrismaClient } from '@creatorchat/db';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { poster, probe, remux, type FfmpegPaths } from './ffmpeg.js';

const THUMB_SIZE = 480;

export type ProcessOutcome = 'ready' | 'failed' | 'skipped';

interface Cleaned {
  file: string;
  mime: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  /** A file sharp can turn into the thumbnail (the cleaned photo, or the video's poster frame). */
  thumbSource: string;
}

const FORMATS = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' } as const;

/**
 * Verifies, cleans and thumbnails one uploaded asset (US-032). Photos are decoded and re-encoded
 * (auto-rotated, no metadata, so GPS and EXIF are gone); videos are remuxed without re-encoding and
 * without metadata. A file that cannot be used becomes FAILED with a code; an unexpected error is
 * thrown so the caller can retry. Safe to run twice: only a PROCESSING asset is touched.
 */
export class MediaProcessor {
  constructor(
    private readonly deps: {
      prisma: PrismaClient;
      storage: ObjectStorage;
      uploads: MediaUploadService;
      ffmpeg: FfmpegPaths;
      maxVideoSeconds: number;
    },
  ) {}

  async process(assetId: string): Promise<ProcessOutcome> {
    const { prisma, storage, uploads } = this.deps;
    const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
    if (!asset || asset.state !== 'PROCESSING') return 'skipped';

    const work = await mkdtemp(path.join(tmpdir(), 'cc-media-'));
    try {
      const original = path.join(work, 'original');
      await storage.download(asset.objectKey, original);
      const cleaned =
        asset.kind === 'PHOTO'
          ? await this.photo(original, asset.mime, work)
          : await this.video(original, asset.mime, work);
      if (typeof cleaned === 'string') {
        await uploads.markFailed(assetId, cleaned);
        return 'failed';
      }

      const thumb = path.join(work, 'thumb.webp');
      try {
        await sharp(cleaned.thumbSource)
          .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
          .webp({ quality: 80 })
          .toFile(thumb);
      } catch {
        await uploads.markFailed(assetId, 'UNREADABLE');
        return 'failed';
      }

      const thumbKey = `${asset.objectKey}/thumb.webp`;
      await storage.upload(asset.objectKey, cleaned.file, cleaned.mime);
      await storage.upload(thumbKey, thumb, 'image/webp');
      const committed = await uploads.markProcessed(assetId, {
        mime: cleaned.mime,
        sizeBytes: (await stat(cleaned.file)).size,
        width: cleaned.width,
        height: cleaned.height,
        durationMs: cleaned.durationMs,
        thumbKey,
      });
      return committed === 'READY' ? 'ready' : 'skipped';
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  private async photo(
    original: string,
    sniffedMime: string | null,
    work: string,
  ): Promise<Cleaned | MediaFailure> {
    const expected = FORMATS[sniffedMime as keyof typeof FORMATS];
    if (!expected) return 'TYPE_NOT_ALLOWED';
    try {
      const meta = await sharp(original).metadata();
      if (meta.format !== expected) return 'TYPE_NOT_ALLOWED';
      const file = path.join(work, 'cleaned');
      // Re-encoding drops every metadata block; `rotate()` applies the EXIF orientation first.
      const pipeline = sharp(original).rotate();
      await (
        expected === 'jpeg'
          ? pipeline.jpeg({ quality: 90, mozjpeg: false })
          : expected === 'png'
            ? pipeline.png()
            : pipeline.webp({ quality: 90 })
      ).toFile(file);
      const out = await sharp(file).metadata();
      return {
        file,
        mime: sniffedMime as string,
        width: out.width ?? null,
        height: out.height ?? null,
        durationMs: null,
        thumbSource: file,
      };
    } catch {
      return 'UNREADABLE';
    }
  }

  private async video(
    original: string,
    sniffedMime: string | null,
    work: string,
  ): Promise<Cleaned | MediaFailure> {
    const { ffmpeg } = this.deps;
    let facts;
    try {
      facts = await probe(ffmpeg, original);
    } catch {
      return 'UNREADABLE';
    }
    if (!/\b(mov|mp4)\b/.test(facts.formatName)) return 'TYPE_NOT_ALLOWED';
    if (!facts.video || facts.durationSeconds === null) return 'UNREADABLE';
    if (facts.video.codec !== 'h264' && facts.video.codec !== 'hevc') return 'TYPE_NOT_ALLOWED';
    if (facts.durationSeconds > this.deps.maxVideoSeconds) return 'TOO_LONG';

    const container = sniffedMime === 'video/quicktime' ? 'mov' : 'mp4';
    const file = path.join(work, `cleaned.${container}`);
    const frame = path.join(work, 'poster.jpg');
    try {
      await remux(ffmpeg, original, file, container, facts.video.codec === 'hevc');
      await poster(ffmpeg, file, frame, Math.min(1, facts.durationSeconds / 2));
      await stat(frame);
    } catch {
      return 'UNREADABLE';
    }
    const turned = facts.video.rotation === 90 || facts.video.rotation === 270;
    return {
      file,
      mime: container === 'mov' ? 'video/quicktime' : 'video/mp4',
      width: turned ? facts.video.height : facts.video.width,
      height: turned ? facts.video.width : facts.video.height,
      durationMs: Math.round(facts.durationSeconds * 1000),
      thumbSource: frame,
    };
  }
}
