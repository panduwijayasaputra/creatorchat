import { PHOTO_TYPES, VIDEO_TYPES, type MediaLimits } from '@creatorchat/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MiniappApi } from '../../auth/api-client';
import type { UnsentMedia } from '../../chat/useChat';
import type { PutFile } from '../../gallery/upload-file';
import {
  UploadAbandoned,
  UploadFailed,
  uploadMedia,
  type UploadFailure,
} from '../../gallery/upload-media';

/** A new file on its way to the server ("Upload Baru"); in memory only. */
export interface ChatUpload {
  file: File;
  clientUploadId: string;
  phase: 'uploading' | 'processing' | 'failed';
  progress: number;
  failure: UploadFailure | null;
}

export type AttachStep =
  | { name: 'closed' }
  | { name: 'sheet' }
  | { name: 'pick' }
  | {
      name: 'preview';
      source: 'GALLERY' | 'CHAT';
      /** The file to send; for a new upload it appears once the server has finished with it. */
      media: UnsentMedia | null;
      upload: ChatUpload | null;
    };

export type RefusedFile = { reason: 'type' } | { reason: 'size'; maxMb: number };

type AttachApi = Pick<
  MiniappApi,
  'getMediaLimits' | 'initMediaUpload' | 'completeMediaUpload' | 'getMedia'
>;

const PHOTOS: readonly string[] = PHOTO_TYPES;
const VIDEOS: readonly string[] = VIDEO_TYPES;

/**
 * The "Lampirkan media" steps of the creator chat as in-page state (`CrAttach` → `CrChatPick` or
 * "Upload Baru" → `CrChatPreview` / `CrChatUpload`). Nothing is sent here: the preview hands the
 * chosen file to the thread, which posts the message. Leaving the chat drops an unfinished upload
 * (the cleanup loop removes it on the server).
 */
export function useAttachFlow(
  api: AttachApi,
  options: {
    conversationId: string;
    onRefused: (why: RefusedFile) => void;
    put?: PutFile;
    pollMs?: number;
  },
) {
  const [step, setStep] = useState<AttachStep>({ name: 'closed' });
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const apiRef = useRef(api);
  apiRef.current = api;
  const stepRef = useRef(step);
  stepRef.current = step;
  const limits = useRef<MediaLimits | null>(null);
  const abort = useRef<AbortController | null>(null);

  const stopUpload = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
  }, []);
  useEffect(() => stopUpload, [stopUpload]);

  const patchUpload = useCallback((id: string, change: Partial<ChatUpload>) => {
    setStep((s) =>
      s.name === 'preview' && s.upload?.clientUploadId === id
        ? { ...s, upload: { ...s.upload, ...change } }
        : s,
    );
  }, []);

  const run = useCallback(
    async (upload: ChatUpload) => {
      stopUpload();
      const controller = new AbortController();
      abort.current = controller;
      const { conversationId, put, pollMs } = optionsRef.current;
      patchUpload(upload.clientUploadId, { phase: 'uploading', progress: 0, failure: null });
      try {
        const asset = await uploadMedia({
          api: apiRef.current,
          file: upload.file,
          clientUploadId: upload.clientUploadId,
          purpose: 'CHAT',
          conversationId,
          ...(put ? { put } : {}),
          ...(pollMs !== undefined ? { pollMs } : {}),
          signal: controller.signal,
          onProgress: (progress) => patchUpload(upload.clientUploadId, { progress }),
          onProcessing: () =>
            patchUpload(upload.clientUploadId, { phase: 'processing', progress: 100 }),
        });
        setStep((s) =>
          s.name === 'preview' && s.upload?.clientUploadId === upload.clientUploadId
            ? {
                ...s,
                upload: null,
                media: {
                  assetId: asset.id,
                  kind: asset.kind,
                  durationSeconds: asset.duration_seconds,
                  thumbnailUrl: asset.thumbnail_url ?? '',
                },
              }
            : s,
        );
      } catch (error) {
        if (error instanceof UploadAbandoned || controller.signal.aborted) return;
        patchUpload(upload.clientUploadId, {
          phase: 'failed',
          failure: error instanceof UploadFailed ? error.failure : { kind: 'network' },
        });
      }
    },
    [patchUpload, stopUpload],
  );

  const open = useCallback(() => {
    setStep({ name: 'sheet' });
    if (!limits.current) {
      apiRef.current.getMediaLimits().then(
        (l) => {
          limits.current = l;
        },
        () => undefined, // the server refuses a bad file anyway
      );
    }
  }, []);

  const close = useCallback(() => {
    stopUpload();
    setStep({ name: 'closed' });
  }, [stopUpload]);

  const choosePick = useCallback(() => setStep({ name: 'pick' }), []);

  const confirmPick = useCallback((media: UnsentMedia) => {
    setStep({ name: 'preview', source: 'GALLERY', media, upload: null });
  }, []);

  /** "Upload Baru": a file was chosen. */
  const startUpload = useCallback(
    (file: File) => {
      const isPhoto = PHOTOS.includes(file.type);
      if (!isPhoto && !VIDEOS.includes(file.type)) {
        optionsRef.current.onRefused({ reason: 'type' });
        return;
      }
      const max =
        limits.current &&
        (isPhoto ? limits.current.photo_max_bytes : limits.current.video_max_bytes);
      if (max && file.size > max) {
        optionsRef.current.onRefused({ reason: 'size', maxMb: Math.floor(max / 1_048_576) });
        return;
      }
      const upload: ChatUpload = {
        file,
        clientUploadId: crypto.randomUUID(),
        phase: 'uploading',
        progress: 0,
        failure: null,
      };
      setStep({ name: 'preview', source: 'CHAT', media: null, upload });
      void run(upload);
    },
    [run],
  );

  /** Same id after a lost connection; a new one after the server refused the file. */
  const retryUpload = useCallback(() => {
    const s = stepRef.current;
    if (s.name !== 'preview' || !s.upload || s.upload.phase !== 'failed') return;
    const next: ChatUpload = {
      ...s.upload,
      clientUploadId:
        s.upload.failure?.kind === 'rejected' ? crypto.randomUUID() : s.upload.clientUploadId,
      phase: 'uploading',
      progress: 0,
      failure: null,
    };
    setStep({ ...s, upload: next });
    void run(next);
  }, [run]);

  /** One step back: preview → picker (gallery) or sheet (upload); picker → sheet; sheet → closed. */
  const back = useCallback(() => {
    const s = stepRef.current;
    if (s.name === 'preview') {
      stopUpload();
      setStep(s.source === 'GALLERY' ? { name: 'pick' } : { name: 'sheet' });
    } else if (s.name === 'pick') setStep({ name: 'sheet' });
    else close();
  }, [close, stopUpload]);

  /** "Ganti": drop the choice and go back to the two options. */
  const change = useCallback(() => {
    stopUpload();
    setStep({ name: 'sheet' });
  }, [stopUpload]);

  return { step, open, close, choosePick, confirmPick, startUpload, retryUpload, back, change };
}

export type AttachFlow = ReturnType<typeof useAttachFlow>;
