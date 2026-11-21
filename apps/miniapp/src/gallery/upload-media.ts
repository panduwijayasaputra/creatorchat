import type { VIDEO_TYPES } from '@creatorchat/contracts';
import {
  PHOTO_TYPES,
  type MediaAssetView,
  type MediaFailure,
  type MediaUploadInitBody,
} from '@creatorchat/contracts';
import { ApiError, type MiniappApi } from '../auth/api-client';
import { putWithProgress, type PutFile } from './upload-file';

export type UploadFailure = { kind: 'network' } | { kind: 'rejected'; code: MediaFailure | null };

/** The upload did not end in a READY asset. `failure` says whether to retry as is or start over. */
export class UploadFailed extends Error {
  constructor(readonly failure: UploadFailure) {
    super('Upload failed');
    this.name = 'UploadFailed';
  }
}

/** The owner went away (unmounted, flow closed): stop quietly. */
export class UploadAbandoned extends Error {
  constructor() {
    super('Upload abandoned');
    this.name = 'UploadAbandoned';
  }
}

export type UploadMediaApi = Pick<
  MiniappApi,
  'initMediaUpload' | 'completeMediaUpload' | 'getMedia'
>;

export interface UploadMediaOptions {
  api: UploadMediaApi;
  file: File;
  clientUploadId: string;
  /**
   * `CHAT` is "Upload Baru" in a conversation: it needs `conversationId` and never reaches the gallery.
   * `BROADCAST` / `WELCOME` are "Upload Baru" in a broadcast / the welcome message: no conversation,
   * and not in the gallery by themselves.
   */
  purpose?: 'GALLERY' | 'CHAT' | 'BROADCAST' | 'WELCOME';
  conversationId?: string;
  put?: PutFile;
  onProgress: (percent: number) => void;
  /** The file is on the server and is being checked and prepared. */
  onProcessing: () => void;
  signal?: AbortSignal;
  /** Wait between status checks while the server processes the file. */
  pollMs?: number;
  /** Checks before giving up (150 x 2 s = 5 min). */
  pollMax?: number;
}

const PHOTOS: readonly string[] = PHOTO_TYPES;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Init → PUT with progress → complete → poll until READY. A 409 on complete means the file did not
 * arrive: it is uploaded once more with a fresh link. `// shortcut: polling every 2 s; switch to a
 * realtime media.updated event if processing gets slow`.
 */
export async function uploadMedia(o: UploadMediaOptions): Promise<MediaAssetView> {
  const { api, file } = o;
  const put = o.put ?? putWithProgress;
  const pollMs = o.pollMs ?? 2000;
  const pollMax = o.pollMax ?? 150;
  const alive = () => !o.signal?.aborted;
  const body = {
    client_upload_id: o.clientUploadId,
    kind: PHOTOS.includes(file.type) ? 'PHOTO' : 'VIDEO',
    content_type: file.type as (typeof PHOTO_TYPES | typeof VIDEO_TYPES)[number],
    size_bytes: file.size,
    ...(o.purpose === 'CHAT'
      ? { purpose: 'CHAT' as const, conversation_id: o.conversationId as string }
      : o.purpose === 'BROADCAST' || o.purpose === 'WELCOME'
        ? { purpose: o.purpose }
        : {}),
  } as MediaUploadInitBody;
  try {
    const send = async () => {
      const init = await api.initMediaUpload(body);
      if (init.asset.state === 'PENDING' && init.upload) {
        await put(init.upload, file, o.onProgress, o.signal);
      }
      return init.asset;
    };
    let asset = await send();
    if (!alive()) throw new UploadAbandoned();
    if (asset.state === 'PENDING') {
      try {
        asset = (await api.completeMediaUpload(asset.id)).asset;
      } catch (error) {
        // The file did not arrive: upload it once more with a fresh link, then complete.
        if (!(error instanceof ApiError) || error.code !== 'MEDIA_UPLOAD_INCOMPLETE') throw error;
        asset = await send();
        asset = (await api.completeMediaUpload(asset.id)).asset;
      }
    }
    o.onProcessing();
    for (let i = 0; asset.state === 'PROCESSING' && i < pollMax; i++) {
      await sleep(pollMs);
      if (!alive()) throw new UploadAbandoned();
      try {
        asset = (await api.getMedia(asset.id)).asset;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) throw error;
        // Offline for a moment: keep waiting.
      }
    }
    if (!alive()) throw new UploadAbandoned();
    if (asset.state === 'READY') return asset;
    throw new UploadFailed(
      asset.state === 'FAILED' ? { kind: 'rejected', code: asset.failure } : { kind: 'network' },
    );
  } catch (error) {
    if (error instanceof UploadFailed || error instanceof UploadAbandoned) throw error;
    if (!alive()) throw new UploadAbandoned();
    throw new UploadFailed(
      error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 401
        ? { kind: 'rejected', code: null }
        : { kind: 'network' },
    );
  }
}
