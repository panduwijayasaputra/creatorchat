import type { WelcomeMessageResponse } from '@creatorchat/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, type MiniappApi } from '../../auth/api-client';
import type { PutFile } from '../../gallery/upload-file';
import {
  useChosenMedia,
  type ChosenMedia,
  type ChosenMediaApi,
} from '../../media-picker/useChosenMedia';
import { WELCOME_COPY as COPY } from './welcome-copy';

export type WelcomeApi = ChosenMediaApi &
  Pick<MiniappApi, 'getWelcomeMessage' | 'saveWelcomeMessage' | 'getGallery'>;

type Load = 'loading' | 'failed' | 'ready';

const toChosen = (m: WelcomeMessageResponse['media']): ChosenMedia | null =>
  m
    ? {
        source: m.source,
        file: {
          assetId: m.asset_id,
          kind: m.kind,
          durationSeconds: m.duration_seconds,
          thumbnailUrl: m.thumbnail_url ?? '',
        },
      }
    : null;

/**
 * The creator's welcome message screen (US-040): loads the saved state, edits it as a local draft
 * (nothing is saved until "Simpan Pesan"), and saves the whole state with one PUT. A failed save
 * keeps everything on screen. The server decides what a valid file is; this only reports it.
 */
export function useWelcome(
  api: WelcomeApi,
  options: {
    onSaved: () => void;
    onNotice: (text: string) => void;
    put?: PutFile;
    pollMs?: number;
  },
) {
  const [load, setLoad] = useState<Load>('loading');
  const [enabled, setEnabled] = useState(false);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const apiRef = useRef(api);
  apiRef.current = api;
  const inFlight = useRef(false);

  const chosen = useChosenMedia(api, {
    purpose: 'WELCOME',
    onRefused: (text) => optionsRef.current.onNotice(text),
    ...(options.put ? { put: options.put } : {}),
    ...(options.pollMs !== undefined ? { pollMs: options.pollMs } : {}),
  });
  const resetMedia = chosen.reset;

  const fetchSaved = useCallback(() => {
    setLoad('loading');
    apiRef.current.getWelcomeMessage().then(
      (saved) => {
        setEnabled(saved.enabled);
        setBody(saved.body);
        resetMedia(toChosen(saved.media));
        setLoad('ready');
      },
      () => setLoad('failed'),
    );
  }, [resetMedia]);
  useEffect(fetchSaved, [fetchSaved]);

  const trimmed = body.trim();
  const canSave =
    load === 'ready' && !saving && chosen.upload === null && (!enabled || trimmed.length > 0);

  const save = useCallback(async () => {
    if (!canSave || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      const saved = await apiRef.current.saveWelcomeMessage({
        enabled,
        body: trimmed,
        asset_id: chosen.media?.file.assetId ?? null,
      });
      setBody(saved.body);
      optionsRef.current.onSaved();
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : null;
      setError(
        code === 'MEDIA_NOT_READY'
          ? COPY.gap.notReady
          : code === 'MEDIA_NOT_FOUND'
            ? COPY.gap.mediaGone
            : COPY.gap.saveFailed,
      );
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, [canSave, chosen.media, enabled, trimmed]);

  return {
    load,
    retryLoad: fetchSaved,
    enabled,
    setEnabled: (value: boolean) => {
      setEnabled(value);
      setError(null);
    },
    body,
    setBody: (value: string) => {
      setBody(value);
      setError(null);
    },
    chosen,
    saving,
    error,
    canSave,
    save,
  };
}
