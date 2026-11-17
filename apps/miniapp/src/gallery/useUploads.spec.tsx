import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeMiniappApi, mediaAsset } from '../../test/fake-miniapp-api';
import type { PutFile } from './upload-file';
import { useUploads } from './useUploads';

const file = (type = 'image/jpeg', size = 1000) => {
  const f = new File([new Uint8Array(10)], 'a', { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};
const limits = { photo_max_bytes: 5000, video_max_bytes: 20_000, video_max_seconds: 300 };
const okPut: PutFile = async () => undefined;

function setup(
  api = createFakeMiniappApi(),
  extra: Partial<Parameters<typeof useUploads>[1]> = {},
) {
  const onReady = vi.fn();
  const onRefused = vi.fn();
  const hook = renderHook(() =>
    useUploads(api, { limits, onReady, onRefused, put: okPut, pollMs: 0, ...extra }),
  );
  return { api, onReady, onRefused, hook };
}

describe('useUploads', () => {
  it('refuses a type outside the list and a file over its kind limit, with the limit in MB', () => {
    const { hook, onRefused, api } = setup();
    act(() => hook.result.current.start(file('image/gif')));
    act(() => hook.result.current.start(file('image/jpeg', 5001)));
    act(() => hook.result.current.start(file('video/mp4', 20_001)));
    expect(onRefused.mock.calls.map((c) => c[0])).toEqual([
      { reason: 'type' },
      { reason: 'size', maxMb: 0 },
      { reason: 'size', maxMb: 0 },
    ]);
    expect(api.mediaInitCalls).toHaveLength(0);
    expect(hook.result.current.uploads).toHaveLength(0);
  });

  it('accepts a video and reports READY exactly once', async () => {
    const api = createFakeMiniappApi({
      mediaGet: [
        { asset: mediaAsset(900, { kind: 'VIDEO', state: 'PROCESSING', thumbnail_url: null }) },
        { asset: mediaAsset(900, { kind: 'VIDEO', duration_seconds: 5 }) },
      ],
    });
    const { hook, onReady } = setup(api);
    act(() => hook.result.current.start(file('video/mp4', 1000)));
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    expect(api.mediaInitCalls[0]).toMatchObject({ kind: 'VIDEO', content_type: 'video/mp4' });
    expect(api.mediaGetCalls).toHaveLength(2);
    expect(hook.result.current.uploads).toHaveLength(0);
  });

  it('gives up after pollMax checks and offers a retry with the same id', async () => {
    const api = createFakeMiniappApi({
      mediaGet: Array.from({ length: 3 }, () => ({
        asset: mediaAsset(900, { state: 'PROCESSING' as const, thumbnail_url: null }),
      })),
    });
    const { hook, onReady } = setup(api, { pollMax: 3 });
    act(() => hook.result.current.start(file()));
    await waitFor(() => expect(hook.result.current.uploads[0]?.phase).toBe('failed'));
    expect(hook.result.current.uploads[0]?.failure).toEqual({ kind: 'network' });
    expect(onReady).not.toHaveBeenCalled();
  });
});
