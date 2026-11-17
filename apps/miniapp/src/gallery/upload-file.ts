/** The signed upload target from `initMediaUpload`. */
export interface UploadTarget {
  url: string;
  headers: Record<string, string>;
}

/** A failed PUT. Any network trouble or non-2xx answer counts: trying again asks for a fresh link. */
export class UploadError extends Error {
  constructor() {
    super('Upload failed');
    this.name = 'UploadError';
  }
}

export type PutFile = (
  target: UploadTarget,
  file: Blob,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
) => Promise<void>;

/**
 * PUTs the file to the signed URL with progress (fetch cannot report upload progress). Sends exactly
 * the headers the server signed and no credentials; the browser adds the content length.
 */
export const putWithProgress: PutFile = (target, file, onProgress, signal) =>
  new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', target.url);
    xhr.withCredentials = false;
    for (const [name, value] of Object.entries(target.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new UploadError());
    xhr.onerror = () => reject(new UploadError());
    xhr.ontimeout = () => reject(new UploadError());
    xhr.onabort = () => reject(new UploadError());
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
