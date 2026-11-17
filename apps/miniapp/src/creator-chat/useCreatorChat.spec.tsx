import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  apiError,
  createFakeMiniappApi,
  creatorChatHistory,
  creatorChatMessage,
  networkError,
} from '../../test/fake-miniapp-api';
import { useCreatorChat } from './useCreatorChat';

const ID = '66666666-0000-4000-8000-000000000001';

async function ready(api = createFakeMiniappApi()) {
  const hook = renderHook(() => useCreatorChat(api, ID));
  await waitFor(() => expect(hook.result.current.state.status).toBe('ready'));
  return { api, hook };
}
const readyState = (hook: { result: { current: ReturnType<typeof useCreatorChat> } }) => {
  const s = hook.result.current.state;
  if (s.status !== 'ready') throw new Error('not ready');
  return s;
};

describe('useCreatorChat', () => {
  it('loads the newest page oldest-first and pages older ones', async () => {
    const api = createFakeMiniappApi({
      creatorChatHistory: [
        creatorChatHistory([creatorChatMessage(3), creatorChatMessage(2)], { next_before: 2 }),
        creatorChatHistory([creatorChatMessage(1)]),
      ],
    });
    const { hook } = await ready(api);
    expect(readyState(hook).messages.map((m) => m.seq)).toEqual([2, 3]);
    await act(async () => hook.result.current.loadOlder());
    expect(readyState(hook).messages.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(api.creatorChatHistoryCalls[1]).toMatchObject({ conversationId: ID, before: 2 });
  });

  it('maps 404 to not-found and other failures to error', async () => {
    const a = renderHook(() =>
      useCreatorChat(
        createFakeMiniappApi({ creatorChatHistory: [apiError(404, 'NOT_FOUND')] }),
        ID,
      ),
    );
    await waitFor(() => expect(a.result.current.state.status).toBe('not-found'));
    const b = renderHook(() =>
      useCreatorChat(createFakeMiniappApi({ creatorChatHistory: [networkError()] }), ID),
    );
    await waitFor(() => expect(b.result.current.state.status).toBe('error'));
  });

  it('sends once and replaces the unsent bubble with the stored message', async () => {
    const { api, hook } = await ready();
    act(() => void hook.result.current.send('  halo  '));
    await waitFor(() => expect(readyState(hook).messages).toHaveLength(1));
    expect(api.creatorChatSendCalls).toHaveLength(1);
    expect(api.creatorChatSendCalls[0]?.body).toBe('halo');
    expect(readyState(hook).unsent).toEqual([]);
    expect(readyState(hook).messages[0]).toMatchObject({ sender: 'ME', origin: 'MANUAL' });
  });

  it('keeps a failed bubble and retries with the same client id', async () => {
    const api = createFakeMiniappApi({ creatorChatSend: [networkError()] });
    const { hook } = await ready(api);
    act(() => void hook.result.current.send('halo'));
    await waitFor(() => expect(readyState(hook).unsent[0]?.status).toBe('failed'));
    const id = readyState(hook).unsent[0]!.clientMessageId;
    act(() => hook.result.current.retry(id));
    await waitFor(() => expect(readyState(hook).messages).toHaveLength(1));
    expect(api.creatorChatSendCalls.map((c) => c.client_message_id)).toEqual([id, id]);
  });

  it('switches to EXPIRED when the server refuses a send, dropping the bubble', async () => {
    const api = createFakeMiniappApi({
      creatorChatSend: [apiError(403, 'CHAT_ACCESS_EXPIRED')],
      creatorChatHistory: [
        creatorChatHistory([]),
        creatorChatHistory([], { state: 'EXPIRED', ended_at: '2026-11-17T01:00:00.000Z' }),
      ],
    });
    const { hook } = await ready(api);
    act(() => void hook.result.current.send('halo'));
    await waitFor(() => expect(readyState(hook).conversation.access.state).toBe('EXPIRED'));
    expect(readyState(hook).unsent).toEqual([]);
    await waitFor(() =>
      expect(readyState(hook).conversation.access.ended_at).toBe('2026-11-17T01:00:00.000Z'),
    );
  });
});
