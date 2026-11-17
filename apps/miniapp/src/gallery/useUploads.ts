import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PHOTO_TYPES,
  VIDEO_TYPES,
  type MediaAssetView,
  type MediaLimits,
} from '@creatorchat/contracts';
import type { MiniappApi } from '../auth/api-client';
import type { PutFile } from './upload-file';
import { UploadAbandoned, UploadFailed, uploadMedia, type UploadFailure } from './upload-media';

export type { UploadFailure };

/** A tile that is not in the gallery yet (in memory only). */
export interface Upload {
  localId: string;
  clientUploadId: string;
  file: File;
  phase: 'uploading' | 'processing' | 'failed';
  progress: number;
  failure: UploadFailure | null;
}

export type RefusedReason = { reason: 'type' } | { reason: 'size'; maxMb: number };

export interface UploadsOptions {
  limits: MediaLimits | null;
  /** Called with the finished asset once it is READY. */
  onReady: (asset: MediaAssetView) => void;
  onRefused: (why: RefusedReason) => void;
  put?: PutFile;
  /** Wait between status checks while the server processes the file. */
  pollMs?: number;
  /** Checks before giving up (150 x 2 s = 5 min). */
  pollMax?: number;
}

type UploadsApi = Pick<MiniappApi, 'initMediaUpload' | 'completeMediaUpload' | 'getMedia'>;

const PHOTOS: readonly string[] = PHOTO_TYPES;
const VIDEOS: readonly string[] = VIDEO_TYPES;

/**
 * The creator's uploads: pre-check, ask for a link, PUT with progress, tell the server, then wait
 * for the worker (polling). A dropped connection keeps the same `client_upload_id`, so Coba Lagi
 * continues the same asset; a file the server refused starts over with a new id.
 * `// shortcut: polling every 2 s; switch to a realtime media.updated event if processing gets slow`
 */
export function useUploads(api: UploadsApi, options: UploadsOptions) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const uploadsRef = useRef(uploads);
  uploadsRef.current = uploads;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const apiRef = useRef(api);
  apiRef.current = api;
  const alive = useRef(true);
  const abort = useRef(new AbortController());

  useEffect(() => {
    alive.current = true;
    abort.current = new AbortController();
    const controller = abort.current;
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, []);

  const patch = useCallback((localId: string, change: Partial<Upload>) => {
    if (!alive.current) return;
    setUploads((list) => list.map((u) => (u.localId === localId ? { ...u, ...change } : u)));
  }, []);

  const run = useCallback(
    async (upload: Upload) => {
      const { put, pollMs, pollMax } = optionsRef.current;
      patch(upload.localId, { phase: 'uploading', progress: 0, failure: null });
      try {
        const asset = await uploadMedia({
          api: apiRef.current,
          file: upload.file,
          clientUploadId: upload.clientUploadId,
          ...(put ? { put } : {}),
          ...(pollMs !== undefined ? { pollMs } : {}),
          ...(pollMax !== undefined ? { pollMax } : {}),
          signal: abort.current.signal,
          onProgress: (progress) => patch(upload.localId, { progress }),
          onProcessing: () => patch(upload.localId, { phase: 'processing', progress: 100 }),
        });
        if (!alive.current) return;
        setUploads((list) => list.filter((u) => u.localId !== upload.localId));
        optionsRef.current.onReady(asset);
      } catch (error) {
        if (error instanceof UploadAbandoned || !alive.current) return;
        patch(upload.localId, {
          phase: 'failed',
          failure: error instanceof UploadFailed ? error.failure : { kind: 'network' },
        });
      }
    },
    [patch],
  );

  const start = useCallback(
    (file: File) => {
      const { limits, onRefused } = optionsRef.current;
      const isPhoto = PHOTOS.includes(file.type);
      if (!isPhoto && !VIDEOS.includes(file.type)) return onRefused({ reason: 'type' });
      if (limits) {
        const max = isPhoto ? limits.photo_max_bytes : limits.video_max_bytes;
        if (file.size > max)
          return onRefused({ reason: 'size', maxMb: Math.floor(max / 1_048_576) });
      }
      const upload: Upload = {
        localId: crypto.randomUUID(),
        clientUploadId: crypto.randomUUID(),
        file,
        phase: 'uploading',
        progress: 0,
        failure: null,
      };
      setUploads((list) => [upload, ...list]);
      void run(upload);
    },
    [run],
  );

  const retry = useCallback(
    (localId: string) => {
      const current = uploadsRef.current.find((u) => u.localId === localId);
      if (!current || current.phase !== 'failed') return;
      // Same id after a lost connection; a new one after the server refused the file.
      const next: Upload = {
        ...current,
        clientUploadId:
          current.failure?.kind === 'rejected' ? crypto.randomUUID() : current.clientUploadId,
        phase: 'uploading',
        progress: 0,
        failure: null,
      };
      setUploads((list) => list.map((u) => (u.localId === localId ? next : u)));
      void run(next);
    },
    [run],
  );

  return { uploads, start, retry };
}
