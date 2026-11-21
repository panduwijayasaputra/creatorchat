import { PHOTO_TYPES, VIDEO_TYPES, type MediaLimits } from '@creatorchat/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MiniappApi } from '../auth/api-client';
import type { UnsentMedia } from '../chat/useChat';
import { ATTACH_COPY } from '../creator-chat/attach/attach-copy';
import type { ChatUpload } from '../creator-chat/attach/useAttachFlow';
import type { PutFile } from '../gallery/upload-file';
import {
  UploadAbandoned,
  UploadFailed,
  uploadMedia,
  type UploadFailure,
} from '../gallery/upload-media';

/** The chosen file: from the gallery (the same asset) or a new upload (kept only where it is used). */
export interface ChosenMedia {
  source: 'GALLERY' | 'UPLOAD';
  file: UnsentMedia;
}

export type ChosenMediaApi = Pick<
  MiniappApi,
  'getMediaLimits' | 'initMediaUpload' | 'completeMediaUpload' | 'getMedia'
>;

const PHOTOS: readonly string[] = PHOTO_TYPES;
const VIDEOS: readonly string[] = VIDEO_TYPES;

/**
 * "Pilih Galeri" / "Upload Baru" for one optional file (US-040; the broadcast composer has its own
 * copy of this logic, `// shortcut: move it onto this hook when that screen is next touched`). A new
 * file is checked for type and size before any request, uploaded with the given purpose, and becomes
 * the chosen media once the server has made it READY; until then `upload` carries the progress or the
 * failure. Leaving the screen drops an unfinished upload (the cleanup loop removes it on the server).
 */
export function useChosenMedia(
  api: ChosenMediaApi,
  options: {
    purpose: 'BROADCAST' | 'WELCOME';
    initial?: ChosenMedia | null;
    onRefused: (text: string) => void;
    put?: PutFile;
    pollMs?: number;
  },
) {
  const [media, setMedia] = useState<ChosenMedia | null>(options.initial ?? null);
  const [upload, setUpload] = useState<ChatUpload | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const apiRef = useRef(api);
  apiRef.current = api;
  const uploadRef = useRef(upload);
  uploadRef.current = upload;
  const limits = useRef<MediaLimits | null>(null);
  const abort = useRef<AbortController | null>(null);

  const stopUpload = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
  }, []);
  useEffect(() => stopUpload, [stopUpload]);

  useEffect(() => {
    let live = true;
    api.getMediaLimits().then(
      (l) => {
        if (live) limits.current = l;
      },
      () => undefined, // the server refuses a bad file anyway
    );
    return () => {
      live = false;
    };
  }, [api]);

  const patchUpload = useCallback((id: string, change: Partial<ChatUpload>) => {
    setUpload((u) => (u?.clientUploadId === id ? { ...u, ...change } : u));
  }, []);

  const run = useCallback(
    async (next: ChatUpload) => {
      stopUpload();
      const controller = new AbortController();
      abort.current = controller;
      const { put, pollMs, purpose } = optionsRef.current;
      patchUpload(next.clientUploadId, { phase: 'uploading', progress: 0, failure: null });
      try {
        const asset = await uploadMedia({
          api: apiRef.current,
          file: next.file,
          clientUploadId: next.clientUploadId,
          purpose,
          ...(put ? { put } : {}),
          ...(pollMs !== undefined ? { pollMs } : {}),
          signal: controller.signal,
          onProgress: (progress) => patchUpload(next.clientUploadId, { progress }),
          onProcessing: () =>
            patchUpload(next.clientUploadId, { phase: 'processing', progress: 100 }),
        });
        if (uploadRef.current?.clientUploadId !== next.clientUploadId) return;
        setUpload(null);
        setMedia({
          source: 'UPLOAD',
          file: {
            assetId: asset.id,
            kind: asset.kind,
            durationSeconds: asset.duration_seconds,
            thumbnailUrl: asset.thumbnail_url ?? '',
          },
        });
      } catch (error) {
        if (error instanceof UploadAbandoned || controller.signal.aborted) return;
        patchUpload(next.clientUploadId, {
          phase: 'failed',
          failure:
            error instanceof UploadFailed ? error.failure : ({ kind: 'network' } as UploadFailure),
        });
      }
    },
    [patchUpload, stopUpload],
  );

  /** "Lanjut" in the picker: the same gallery asset. */
  const pickFromGallery = useCallback(
    (file: UnsentMedia) => {
      stopUpload();
      setUpload(null);
      setMedia({ source: 'GALLERY', file });
    },
    [stopUpload],
  );

  /** "Upload Baru": a file was chosen. */
  const startUpload = useCallback(
    (file: File) => {
      const isPhoto = PHOTOS.includes(file.type);
      if (!isPhoto && !VIDEOS.includes(file.type)) {
        optionsRef.current.onRefused(ATTACH_COPY.gap.refusedType);
        return;
      }
      const max =
        limits.current &&
        (isPhoto ? limits.current.photo_max_bytes : limits.current.video_max_bytes);
      if (max && file.size > max) {
        optionsRef.current.onRefused(ATTACH_COPY.gap.refusedSize(Math.floor(max / 1_048_576)));
        return;
      }
      const next: ChatUpload = {
        file,
        clientUploadId: crypto.randomUUID(),
        phase: 'uploading',
        progress: 0,
        failure: null,
      };
      setMedia(null);
      setUpload(next);
      void run(next);
    },
    [run],
  );

  /** Same id after a lost connection; a new one after the server refused the file. */
  const retryUpload = useCallback(() => {
    const current = uploadRef.current;
    if (!current || current.phase !== 'failed') return;
    const next: ChatUpload = {
      ...current,
      clientUploadId:
        current.failure?.kind === 'rejected' ? crypto.randomUUID() : current.clientUploadId,
      phase: 'uploading',
      progress: 0,
      failure: null,
    };
    setUpload(next);
    void run(next);
  }, [run]);

  /** "Hapus Media" / "Ganti Media": back to the two options (an unfinished upload is dropped). */
  const clear = useCallback(() => {
    stopUpload();
    setUpload(null);
    setMedia(null);
  }, [stopUpload]);

  /** Sets the saved media once it is loaded from the server. */
  const reset = useCallback(
    (next: ChosenMedia | null) => {
      stopUpload();
      setUpload(null);
      setMedia(next);
    },
    [stopUpload],
  );

  return { media, upload, pickFromGallery, startUpload, retryUpload, clear, reset };
}
