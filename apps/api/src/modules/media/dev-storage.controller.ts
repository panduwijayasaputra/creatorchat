import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Readable } from 'node:stream';
import type { LocalDiskStorage, SignedParts } from '@creatorchat/backend-core';
import { ErrorCode } from '@creatorchat/contracts';
import { AppError } from '../../common/errors/app-error.js';
import { STORAGE } from './tokens.js';

const forbidden = () => new AppError(ErrorCode.FORBIDDEN, 403, 'Invalid or expired link.');

/** `bytes=a-b`, `bytes=a-` or `bytes=-n` against a file of `size` bytes; null when unsatisfiable. */
export function parseRange(header: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start <= end && start < size ? { start, end } : null;
}

/**
 * Development and test stand-in for the R2 bucket (STORAGE_DRIVER=local; the module is not
 * registered otherwise, and never in production). There is no user session here: like a presigned
 * R2 URL, the signature in the query is the authority, and it is checked before anything is read.
 */
@Controller('dev-storage')
export class DevStorageController {
  constructor(@Inject(STORAGE) private readonly storage: LocalDiskStorage | null) {}

  private store(): LocalDiskStorage {
    if (!this.storage) {
      throw new AppError(
        ErrorCode.SERVICE_UNAVAILABLE,
        503,
        'The service is temporarily unavailable.',
      );
    }
    return this.storage;
  }

  private parts(
    method: 'PUT' | 'GET',
    key: string,
    q: Record<string, string | undefined>,
  ): { parts: SignedParts; signature: string } {
    const expires = Number(q.e);
    const length = Number(q.l);
    if (q.m !== method || !Number.isInteger(expires) || !Number.isInteger(length) || !q.s) {
      throw forbidden();
    }
    return {
      parts: { method, key, expires, length, type: q.t ?? '' },
      signature: q.s,
    };
  }

  @Put('m/:creatorId/:assetId')
  @HttpCode(200)
  put(
    @Param('creatorId') creatorId: string,
    @Param('assetId') assetId: string,
    @Query() query: Record<string, string | undefined>,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    return this.write(`m/${creatorId}/${assetId}`, query, req);
  }

  @Put('m/:creatorId/:assetId/thumb.webp')
  @HttpCode(200)
  putThumb(
    @Param('creatorId') creatorId: string,
    @Param('assetId') assetId: string,
    @Query() query: Record<string, string | undefined>,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    return this.write(`m/${creatorId}/${assetId}/thumb.webp`, query, req);
  }

  @Get('m/:creatorId/:assetId')
  get(
    @Param('creatorId') creatorId: string,
    @Param('assetId') assetId: string,
    @Query() query: Record<string, string | undefined>,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StreamableFile> {
    return this.read(`m/${creatorId}/${assetId}`, query, range, reply);
  }

  @Get('m/:creatorId/:assetId/thumb.webp')
  getThumb(
    @Param('creatorId') creatorId: string,
    @Param('assetId') assetId: string,
    @Query() query: Record<string, string | undefined>,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StreamableFile> {
    return this.read(`m/${creatorId}/${assetId}/thumb.webp`, query, range, reply);
  }

  private async write(
    key: string,
    query: Record<string, string | undefined>,
    req: FastifyRequest,
  ): Promise<void> {
    const storage = this.store();
    const { parts, signature } = this.parts('PUT', key, query);
    // The signature is checked before a single body byte is read.
    if (!storage.verify(parts, signature)) throw forbidden();
    if (
      Number(req.headers['content-length']) !== parts.length ||
      req.headers['content-type'] !== parts.type
    ) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 400, 'The upload does not match the link.');
    }
    let written: number;
    try {
      written = await storage.writeStream(key, req.body as Readable, parts.length);
    } catch {
      throw new AppError(ErrorCode.PAYLOAD_TOO_LARGE, 413, 'The upload is too large.');
    }
    if (written !== parts.length) {
      await storage.delete(key);
      throw new AppError(ErrorCode.VALIDATION_FAILED, 400, 'The upload is incomplete.');
    }
  }

  private async read(
    key: string,
    query: Record<string, string | undefined>,
    rangeHeader: string | undefined,
    reply: FastifyReply,
  ): Promise<StreamableFile> {
    const storage = this.store();
    const { parts, signature } = this.parts('GET', key, query);
    if (!storage.verify(parts, signature)) throw forbidden();
    const head = await storage.head(key);
    if (!head) throw new AppError(ErrorCode.NOT_FOUND, 404, 'Not found.');
    void reply.header('Accept-Ranges', 'bytes').header('Cache-Control', 'private, max-age=60');
    if (rangeHeader === undefined) {
      return new StreamableFile(storage.readStream(key), { type: parts.type, length: head.size });
    }
    const range = parseRange(rangeHeader, head.size);
    if (!range) {
      void reply.header('Content-Range', `bytes */${head.size}`);
      throw new AppError(ErrorCode.VALIDATION_FAILED, 416, 'Range not satisfiable.');
    }
    void reply
      .status(206)
      .header('Content-Range', `bytes ${range.start}-${range.end}/${head.size}`);
    return new StreamableFile(storage.readStream(key, range), {
      type: parts.type,
      length: range.end - range.start + 1,
    });
  }
}
