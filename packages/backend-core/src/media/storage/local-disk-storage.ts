import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream, type ReadStream } from 'node:fs';
import { copyFile, mkdir, open, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { ObjectStorage, PresignedPut } from './object-storage.js';

/** `m/<creator id>/<asset id>` and its thumbnail. Nothing else maps to a file. */
const KEY = /^m\/[0-9a-f-]{36}\/[0-9a-f-]{36}(\/thumb\.webp)?$/;

export const DEV_STORAGE_PATH = '/v1/dev-storage/';

export class InvalidStorageKeyError extends Error {
  constructor() {
    super('Invalid storage key.');
    this.name = 'InvalidStorageKeyError';
  }
}

export interface SignedParts {
  method: 'PUT' | 'GET';
  key: string;
  /** Unix seconds. */
  expires: number;
  length: number;
  type: string;
}

const sign = (secret: string, p: SignedParts) =>
  createHmac('sha256', secret)
    .update([p.method, p.key, p.expires, p.length, p.type].join('\n'))
    .digest('hex');

/**
 * True when `signature` matches the parts and the URL has not expired. Constant-time compare; any
 * changed key, method, expiry, length or type fails.
 */
export function verifyLocalSignature(
  secret: string,
  parts: SignedParts,
  signature: string,
  now: Date = new Date(),
): boolean {
  if (!KEY.test(parts.key)) return false;
  if (parts.expires * 1000 <= now.getTime()) return false;
  const expected = Buffer.from(sign(secret, parts), 'hex');
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Development and test driver: objects are files under `rootDir`, and "presigned" URLs are
 * HMAC-signed, short-lived links served by the API (`/v1/dev-storage/*`). Never used in production
 * (the env schema refuses it).
 */
export class LocalDiskStorage implements ObjectStorage {
  constructor(
    private readonly rootDir: string,
    private readonly secret: string,
    private readonly publicBaseUrl: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * The file for a key. Throws for anything that is not a server-made key. The original
   * (`m/<creator>/<asset>`) is stored as `<asset>.orig` because its thumbnail lives under
   * `m/<creator>/<asset>/`, and a path cannot be a file and a folder at once.
   */
  pathFor(key: string): string {
    if (!KEY.test(key)) throw new InvalidStorageKeyError();
    const file = path.join(path.resolve(this.rootDir), ...key.split('/'));
    return key.endsWith('/thumb.webp') ? file : `${file}.orig`;
  }

  verify(parts: SignedParts, signature: string): boolean {
    return verifyLocalSignature(this.secret, parts, signature, this.clock());
  }

  private url(parts: SignedParts): string {
    const query = new URLSearchParams({
      m: parts.method,
      e: String(parts.expires),
      l: String(parts.length),
      t: parts.type,
      s: sign(this.secret, parts),
    });
    return `${this.publicBaseUrl}${DEV_STORAGE_PATH}${parts.key}?${query.toString()}`;
  }

  async presignPut(
    key: string,
    options: { contentType: string; contentLength: number; expiresInSeconds: number },
  ): Promise<PresignedPut> {
    this.pathFor(key);
    const expiresAt = new Date(this.clock().getTime() + options.expiresInSeconds * 1000);
    const url = this.url({
      method: 'PUT',
      key,
      expires: Math.floor(expiresAt.getTime() / 1000),
      length: options.contentLength,
      type: options.contentType,
    });
    return { url, method: 'PUT', headers: { 'Content-Type': options.contentType }, expiresAt };
  }

  async presignGet(
    key: string,
    options: { expiresInSeconds: number; contentType?: string },
  ): Promise<string> {
    this.pathFor(key);
    const expiresAt = new Date(this.clock().getTime() + options.expiresInSeconds * 1000);
    return this.url({
      method: 'GET',
      key,
      expires: Math.floor(expiresAt.getTime() / 1000),
      length: 0,
      type: options.contentType ?? 'application/octet-stream',
    });
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      const info = await stat(this.pathFor(key));
      return info.isFile() ? { size: info.size } : null;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async readRange(key: string, start: number, endInclusive: number): Promise<Buffer> {
    const handle = await open(this.pathFor(key), 'r');
    try {
      const buffer = Buffer.alloc(endInclusive - start + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async download(key: string, destinationPath: string): Promise<void> {
    await copyFile(this.pathFor(key), destinationPath);
  }

  async upload(key: string, sourcePath: string, _contentType: string): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${randomUUID()}.tmp`;
    await copyFile(sourcePath, temp);
    await rename(temp, target);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  /**
   * Streams a request body into the object (temp file, then rename, so a half upload is never
   * visible). Returns the bytes written; stops with an error after `maxBytes`.
   */
  async writeStream(key: string, body: Readable, maxBytes: number): Promise<number> {
    const target = this.pathFor(key);
    await mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${randomUUID()}.tmp`;
    let written = 0;
    body.on('data', (chunk: Buffer) => {
      written += chunk.length;
      if (written > maxBytes) body.destroy(new Error('too large'));
    });
    try {
      await pipeline(body, createWriteStream(temp));
      await rename(temp, target);
      return written;
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  /** A read stream for the whole object or an inclusive byte range. */
  readStream(key: string, range?: { start: number; end: number }): ReadStream {
    return createReadStream(this.pathFor(key), range);
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}
