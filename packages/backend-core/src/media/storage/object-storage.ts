import type { ServerEnv } from '../../config/env.js';
import { LocalDiskStorage } from './local-disk-storage.js';
import { R2Storage } from './r2-storage.js';

export interface PresignedPut {
  url: string;
  method: 'PUT';
  /** Sent by the client exactly as given. The content length is set by the browser from the body. */
  headers: Record<string, string>;
  expiresAt: Date;
}

/**
 * Private object storage (brief §8). Keys are server-made; no method returns a permanent URL.
 * Implemented by the R2 bucket and, for development and tests, by the local disk driver.
 */
export interface ObjectStorage {
  presignPut(
    key: string,
    options: { contentType: string; contentLength: number; expiresInSeconds: number },
  ): Promise<PresignedPut>;
  presignGet(
    key: string,
    options: { expiresInSeconds: number; contentType?: string },
  ): Promise<string>;
  /** `null` when the object does not exist. */
  head(key: string): Promise<{ size: number } | null>;
  readRange(key: string, start: number, endInclusive: number): Promise<Buffer>;
  download(key: string, destinationPath: string): Promise<void>;
  upload(key: string, sourcePath: string, contentType: string): Promise<void>;
  /** A missing object counts as deleted. */
  delete(key: string): Promise<void>;
}

type StorageEnv = Pick<
  ServerEnv,
  | 'STORAGE_DRIVER'
  | 'STORAGE_LOCAL_DIR'
  | 'STORAGE_LOCAL_SIGNING_SECRET'
  | 'API_PUBLIC_URL'
  | 'API_PORT'
  | 'R2_ACCOUNT_ENDPOINT'
  | 'R2_BUCKET'
  | 'R2_ACCESS_KEY_ID'
  | 'R2_SECRET_ACCESS_KEY'
>;

/** `null` while the chosen driver lacks its settings: media answers 503 and the rest keeps working. */
export function createObjectStorage(env: StorageEnv): ObjectStorage | null {
  if (env.STORAGE_DRIVER === 'r2') {
    if (
      !env.R2_ACCOUNT_ENDPOINT ||
      !env.R2_BUCKET ||
      !env.R2_ACCESS_KEY_ID ||
      !env.R2_SECRET_ACCESS_KEY
    ) {
      return null;
    }
    return new R2Storage({
      endpoint: env.R2_ACCOUNT_ENDPOINT,
      bucket: env.R2_BUCKET,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    });
  }
  if (!env.STORAGE_LOCAL_SIGNING_SECRET) return null;
  return new LocalDiskStorage(
    env.STORAGE_LOCAL_DIR,
    env.STORAGE_LOCAL_SIGNING_SECRET,
    (env.API_PUBLIC_URL ?? `http://localhost:${env.API_PORT}`).replace(/\/+$/, ''),
  );
}
