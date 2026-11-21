import { CHAT_TEXT_MAX, PHOTO_TYPES, VIDEO_TYPES, type MediaLimits } from '@creatorchat/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, type MiniappApi } from '../auth/api-client';
import type { UnsentMedia } from '../chat/useChat';
import type { ChatUpload } from '../creator-chat/attach/useAttachFlow';
import type { PutFile } from '../gallery/upload-file';
import {
  UploadAbandoned,
  UploadFailed,
  uploadMedia,
  type UploadFailure,
} from '../gallery/upload-media';
import { BROADCAST_COPY as COPY } from './broadcast-copy';

export type BroadcastApi = Pick<
  MiniappApi,
  | 'createBroadcast'
  | 'getGallery'
  | 'getMediaLimits'
  | 'initMediaUpload'
  | 'completeMediaUpload'
  | 'getMedia'
>;

/** The chosen file: from the gallery (the same asset) or a new upload (only in this broadcast). */
export interface BroadcastMedia {
  source: 'GALLERY' | 'UPLOAD';
  file: UnsentMedia;
}

export type BroadcastState = {
  /** `pick` = the gallery picker drawn over the page. */
  step: 'compose' | 'pick';
  media: BroadcastMedia | null;
  /** The new file on its way to the server; `media` is set when it is READY. */
  upload: ChatUpload | null;
  body: string;
  saveToGallery: boolean;
  confirming: boolean;
  sending: boolean;
  /** A message for the inline error line under the button (cleared by the next change). */
  error: string | null;
};

const INITIAL: BroadcastState = {
  step: 'compose',
  media: null,
  upload: null,
  body: '',
  saveToGallery: false,
  confirming: false,
  sending: false,
  error: null,
};

const PHOTOS: readonly string[] = PHOTO_TYPES;
const VIDEOS: readonly string[] = VIDEO_TYPES;

/**
 * The creator's broadcast composer as in-page state (`CrBroadcast` → `CrBroadcastPick` /
 * "Upload Baru" → `CrBroadcastReady` / `CrBroadcastUpload` → `CrBroadcastConfirm` →
 * `CrBroadcastDone`). Nothing is kept as a draft: leaving the page drops an unfinished upload (the
 * cleanup loop removes it on the server). A failed send keeps the media, the text and the box; the
 * retry reuses the same `client_broadcast_id` while the content is unchanged, so a lost answer can
 * never send the broadcast twice.
 */
export function useBroadcast(
  api: BroadcastApi,
  options: {
    onSent: () => void;
    onNotice: (text: string) => void;
    put?: PutFile;
    pollMs?: number;
  },
) {
  const [state, setState] = useState<BroadcastState>(INITIAL);
  const stateRef = useRef(state);
  stateRef.current = state;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const apiRef = useRef(api);
  apiRef.current = api;
  const limits = useRef<MediaLimits | null>(null);
  const abort = useRef<AbortController | null>(null);
  /** The id of the attempt in flight or last failed, with the content it was made for. */
  const attempt = useRef<{ id: string; signature: string } | null>(null);

  const patch = useCallback((change: Partial<BroadcastState>) => {
    setState((s) => ({ ...s, ...change }));
  }, []);

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
    setState((s) =>
      s.upload?.clientUploadId === id ? { ...s, upload: { ...s.upload, ...change } } : s,
    );
  }, []);

  const run = useCallback(
    async (upload: ChatUpload) => {
      stopUpload();
      const controller = new AbortController();
      abort.current = controller;
      const { put, pollMs } = optionsRef.current;
      patchUpload(upload.clientUploadId, { phase: 'uploading', progress: 0, failure: null });
      try {
        const asset = await uploadMedia({
          api: apiRef.current,
          file: upload.file,
          clientUploadId: upload.clientUploadId,
          purpose: 'BROADCAST',
          ...(put ? { put } : {}),
          ...(pollMs !== undefined ? { pollMs } : {}),
          signal: controller.signal,
          onProgress: (progress) => patchUpload(upload.clientUploadId, { progress }),
          onProcessing: () =>
            patchUpload(upload.clientUploadId, { phase: 'processing', progress: 100 }),
        });
        setState((s) =>
          s.upload?.clientUploadId === upload.clientUploadId
            ? {
                ...s,
                upload: null,
                media: {
                  source: 'UPLOAD',
                  file: {
                    assetId: asset.id,
                    kind: asset.kind,
                    durationSeconds: asset.duration_seconds,
                    thumbnailUrl: asset.thumbnail_url ?? '',
                  },
                },
              }
            : s,
        );
      } catch (error) {
        if (error instanceof UploadAbandoned || controller.signal.aborted) return;
        patchUpload(upload.clientUploadId, {
          phase: 'failed',
          failure:
            error instanceof UploadFailed ? error.failure : ({ kind: 'network' } as UploadFailure),
        });
      }
    },
    [patchUpload, stopUpload],
  );

  const openPicker = useCallback(() => patch({ step: 'pick', error: null }), [patch]);
  const closePicker = useCallback(() => patch({ step: 'compose' }), [patch]);

  /** "Lanjut" in the picker: the same gallery asset, no box. */
  const pickFromGallery = useCallback(
    (file: UnsentMedia) => {
      stopUpload();
      setState((s) => ({
        ...s,
        step: 'compose',
        media: { source: 'GALLERY', file },
        upload: null,
        saveToGallery: false,
        error: null,
      }));
    },
    [stopUpload],
  );

  /** "Upload Baru": a file was chosen. */
  const startUpload = useCallback(
    (file: File) => {
      const isPhoto = PHOTOS.includes(file.type);
      if (!isPhoto && !VIDEOS.includes(file.type)) {
        optionsRef.current.onNotice(COPY.gap.refusedType);
        return;
      }
      const max =
        limits.current &&
        (isPhoto ? limits.current.photo_max_bytes : limits.current.video_max_bytes);
      if (max && file.size > max) {
        optionsRef.current.onNotice(COPY.gap.refusedSize(Math.floor(max / 1_048_576)));
        return;
      }
      const upload: ChatUpload = {
        file,
        clientUploadId: crypto.randomUUID(),
        phase: 'uploading',
        progress: 0,
        failure: null,
      };
      setState((s) => ({ ...s, media: null, upload, saveToGallery: false, error: null }));
      void run(upload);
    },
    [run],
  );

  /** Same id after a lost connection; a new one after the server refused the file. */
  const retryUpload = useCallback(() => {
    const upload = stateRef.current.upload;
    if (!upload || upload.phase !== 'failed') return;
    const next: ChatUpload = {
      ...upload,
      clientUploadId:
        upload.failure?.kind === 'rejected' ? crypto.randomUUID() : upload.clientUploadId,
      phase: 'uploading',
      progress: 0,
      failure: null,
    };
    setState((s) => ({ ...s, upload: next }));
    void run(next);
  }, [run]);

  /** "Ganti Media": back to the two options (an unfinished upload is dropped). */
  const changeMedia = useCallback(() => {
    stopUpload();
    setState((s) => ({ ...s, media: null, upload: null, saveToGallery: false, error: null }));
  }, [stopUpload]);

  const setBody = useCallback((body: string) => patch({ body, error: null }), [patch]);
  const setSaveToGallery = useCallback(
    (saveToGallery: boolean) => patch({ saveToGallery, error: null }),
    [patch],
  );

  const canSend = state.media !== null && state.upload === null && !state.sending;
  const askConfirm = useCallback(() => {
    if (stateRef.current.media && !stateRef.current.upload && !stateRef.current.sending) {
      patch({ confirming: true, error: null });
    }
  }, [patch]);
  const cancelConfirm = useCallback(() => patch({ confirming: false }), [patch]);

  /** "Kirim Broadcast" in the confirmation: one request; failures keep everything on screen. */
  const confirmSend = useCallback(async () => {
    const s = stateRef.current;
    if (!s.media || s.upload || s.sending) return;
    const text = s.body.trim().slice(0, CHAT_TEXT_MAX);
    const saveToGallery = s.media.source === 'UPLOAD' && s.saveToGallery;
    const signature = JSON.stringify([s.media.file.assetId, text, saveToGallery]);
    if (attempt.current?.signature !== signature) {
      attempt.current = { id: crypto.randomUUID(), signature };
    }
    patch({ sending: true, error: null });
    try {
      await apiRef.current.createBroadcast({
        client_broadcast_id: attempt.current.id,
        attachment: { asset_id: s.media.file.assetId },
        ...(text ? { body: text } : {}),
        save_to_gallery: saveToGallery,
      });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : null;
      if (code === 'NO_ACTIVE_SUBSCRIBERS') {
        patch({ sending: false, confirming: false });
        optionsRef.current.onNotice(COPY.gap.noSubscribers);
        return;
      }
      const message =
        code === 'MEDIA_NOT_READY'
          ? COPY.gap.notReady
          : code === 'MEDIA_NOT_FOUND'
            ? COPY.gap.mediaGone
            : code === 'RATE_LIMITED'
              ? COPY.gap.rateLimited
              : COPY.gap.failed;
      patch({ sending: false, confirming: false, error: message });
      return;
    }
    attempt.current = null;
    setState(INITIAL);
    optionsRef.current.onSent();
  }, [patch]);

  return {
    state,
    canSend,
    openPicker,
    closePicker,
    pickFromGallery,
    startUpload,
    retryUpload,
    changeMedia,
    setBody,
    setSaveToGallery,
    askConfirm,
    cancelConfirm,
    confirmSend,
  };
}

export type BroadcastFlow = ReturnType<typeof useBroadcast>;
