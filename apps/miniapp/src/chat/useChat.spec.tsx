import { act, renderHook, waitFor } from '@testing-library/react';
import type { SendMessageResponse } from '@creatorchat/contracts';
import { describe, expect, it } from 'vitest';
import {
  apiError,
  chatHistory,
  chatMessage,
  createFakeMiniappApi,
  networkError,
} from '../../test/fake-miniapp-api';
import { useChat } from './useChat';

const ID = '22222222-0000-4000-8000-000000000001';

async function ready(api = createFakeMiniappApi()) {
  const hook = renderHook(() => useChat(api, ID));
  await waitFor(() => expect(hook.result.current.state.status).toBe('ready'));
  return { api, hook };
}
const ready_ = (hook: { result: { current: ReturnType<typeof useChat> } }) => {
  const s = hook.result.current.state;
  if (s.status !== 'ready') throw new Error('not ready');
  return s;
};

describe('useChat loading', () => {
  it('shows the newest page oldest-first', async () => {
    const api = createFakeMiniappApi({
      chatHistory: [chatHistory([chatMessage(3), chatMessage(2)], { next_before: 2 })],
    });
    const { hook } = await ready(api);
    expect(ready_(hook).messages.map((m) => m.seq)).toEqual([2, 3]);
    expect(api.chatHistoryCalls[0]).toMatchObject({ conversationId: ID, limit: 30 });
  });

  it('maps 404 to not-found and other failures to error', async () => {
    const a = renderHook(() =>
      useChat(createFakeMiniappApi({ chatHistory: [apiError(404, 'NOT_FOUND')] }), ID),
    );
    await waitFor(() => expect(a.result.current.state.status).toBe('not-found'));
    const b = renderHook(() =>
      useChat(createFakeMiniappApi({ chatHistory: [networkError()] }), ID),
    );
    await waitFor(() => expect(b.result.current.state.status).toBe('error'));
  });

  it('prepends an older page once; a second call while loading is ignored', async () => {
    let release!: (v: ReturnType<typeof chatHistory>) => void;
    const slow = new Promise<ReturnType<typeof chatHistory>>((r) => (release = r));
    const api = createFakeMiniappApi({
      chatHistory: [chatHistory([chatMessage(3), chatMessage(2)], { next_before: 2 }), slow],
    });
    const { hook } = await ready(api);
    act(() => {
      void hook.result.current.loadOlder();
      void hook.result.current.loadOlder();
    });
    expect(api.chatHistoryCalls).toHaveLength(2);
    expect(api.chatHistoryCalls[1]).toMatchObject({ before: 2 });
    await act(async () => release(chatHistory([chatMessage(1)])));
    const s = ready_(hook);
    expect(s.messages.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(s.nextBefore).toBeNull();
  });
});

describe('useChat sending', () => {
  it('shows Mengirim… then replaces the bubble with the server message', async () => {
    let release!: (v: SendMessageResponse) => void;
    const held = new Promise<SendMessageResponse>((r) => (release = r));
    const { api, hook } = await ready(createFakeMiniappApi({ chatSend: [held] }));
    act(() => void hook.result.current.send('  halo  '));
    expect(ready_(hook).unsent).toMatchObject([{ body: 'halo', status: 'sending' }]);
    const sent = api.chatSendCalls[0]!;
    await act(async () =>
      release({
        message: chatMessage(1, {
          sender: 'ME',
          body: 'halo',
          client_message_id: sent.client_message_id,
        }),
      }),
    );
    const s = ready_(hook);
    expect(s.unsent).toEqual([]);
    expect(s.messages.map((m) => m.body)).toEqual(['halo']);
  });

  it('does not send empty, whitespace or over-long text', async () => {
    const { api, hook } = await ready();
    act(() => {
      expect(hook.result.current.send('   ')).toBe(false);
      expect(hook.result.current.send('a'.repeat(2001))).toBe(false);
    });
    expect(api.chatSendCalls).toHaveLength(0);
  });

  it('a network failure marks the bubble failed; Kirim Ulang reuses the same id and ends with one bubble', async () => {
    const { api, hook } = await ready(createFakeMiniappApi({ chatSend: [networkError()] }));
    act(() => void hook.result.current.send('halo'));
    await waitFor(() => expect(ready_(hook).unsent[0]?.status).toBe('failed'));
    const id = ready_(hook).unsent[0]!.clientMessageId;
    act(() => hook.result.current.retry(id));
    await waitFor(() => expect(ready_(hook).unsent).toEqual([]));
    expect(api.chatSendCalls.map((c) => c.client_message_id)).toEqual([id, id]);
    expect(ready_(hook).messages).toHaveLength(1);
  });

  it('a double tap on Kirim Ulang posts once', async () => {
    let release!: (v: SendMessageResponse) => void;
    const held = new Promise<SendMessageResponse>((r) => (release = r));
    const { api, hook } = await ready(createFakeMiniappApi({ chatSend: [networkError(), held] }));
    act(() => void hook.result.current.send('halo'));
    await waitFor(() => expect(ready_(hook).unsent[0]?.status).toBe('failed'));
    const id = ready_(hook).unsent[0]!.clientMessageId;
    act(() => {
      hook.result.current.retry(id);
      hook.result.current.retry(id);
    });
    expect(api.chatSendCalls).toHaveLength(2);
    await act(async () =>
      release({ message: chatMessage(1, { sender: 'ME', client_message_id: id }) }),
    );
  });

  it('CHAT_ACCESS_EXPIRED removes the bubble and flips the access state, history stays', async () => {
    const api = createFakeMiniappApi({
      chatHistory: [
        chatHistory([chatMessage(1)]),
        chatHistory([chatMessage(1)], { state: 'EXPIRED' }),
      ],
      chatSend: [apiError(403, 'CHAT_ACCESS_EXPIRED')],
    });
    const { hook } = await ready(api);
    act(() => void hook.result.current.send('halo'));
    await waitFor(() => expect(ready_(hook).conversation.access.state).toBe('EXPIRED'));
    expect(ready_(hook).unsent).toEqual([]);
    expect(ready_(hook).messages).toHaveLength(1);
    await waitFor(() => expect(ready_(hook).conversation.access.ended_at).not.toBeNull());
  });

  it('CHAT_CREATOR_BLOCKED switches to the blocked state', async () => {
    const api = createFakeMiniappApi({
      chatHistory: [chatHistory([]), chatHistory([], { state: 'CREATOR_BLOCKED' })],
      chatSend: [apiError(403, 'CHAT_CREATOR_BLOCKED')],
    });
    const { hook } = await ready(api);
    act(() => void hook.result.current.send('halo'));
    await waitFor(() => expect(ready_(hook).conversation.access.state).toBe('CREATOR_BLOCKED'));
  });
});

describe('useChat refetch', () => {
  it('merges new messages when the tab becomes visible and drops a confirmed unsent bubble', async () => {
    const api = createFakeMiniappApi({
      chatHistory: [
        chatHistory([chatMessage(1)]),
        chatHistory([
          chatMessage(3),
          chatMessage(2, {
            sender: 'ME',
            client_message_id: 'a0000000-0000-4000-8000-000000000001',
          }),
          chatMessage(1),
        ]),
      ],
      chatSend: [networkError()],
    });
    const { hook } = await ready(api);
    act(() => void hook.result.current.send('lost answer'));
    await waitFor(() => expect(ready_(hook).unsent[0]?.status).toBe('failed'));
    // pretend the server did store it under this id
    (ready_(hook).unsent[0] as { clientMessageId: string }).clientMessageId =
      'a0000000-0000-4000-8000-000000000001';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(ready_(hook).messages.map((m) => m.seq)).toEqual([1, 2, 3]));
    expect(ready_(hook).unsent).toEqual([]);
  });
});
