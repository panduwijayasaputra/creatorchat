import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReadResponse } from '@creatorchat/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import {
  chatHistory,
  chatMessage,
  createFakeMiniappApi,
  networkError,
} from '../../test/fake-miniapp-api';
import { useChat } from './useChat';

const ID = '22222222-0000-4000-8000-000000000001';
const mine = (seq: number) => chatMessage(seq, { sender: 'ME' });
const theirs = (seq: number) => chatMessage(seq, { sender: 'CREATOR' });

let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
afterEach(() => {
  visibility = 'visible';
});

const ready = (hook: { result: { current: ReturnType<typeof useChat> } }) => {
  if (hook.result.current.state.status !== 'ready') throw new Error('not ready');
};
async function open(api: ReturnType<typeof createFakeMiniappApi>) {
  const hook = renderHook(() => useChat(api, ID));
  await waitFor(() => expect(hook.result.current.state.status).toBe('ready'));
  return hook;
}
const becomeVisible = async () => {
  visibility = 'visible';
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

describe('marking as read', () => {
  it('posts the newest creator message once when the chat opens', async () => {
    const api = createFakeMiniappApi({
      chatHistory: [chatHistory([mine(3), theirs(2), theirs(1)])],
    });
    await open(api);
    await waitFor(() => expect(api.chatReadCalls).toHaveLength(1));
    expect(api.chatReadCalls[0]).toEqual({ conversationId: ID, throughSeq: 2 });
  });

  it('posts nothing when no message of the creator is on screen', async () => {
    const api = createFakeMiniappApi({ chatHistory: [chatHistory([mine(2), mine(1)])] });
    await open(api);
    await new Promise((r) => setTimeout(r, 20));
    expect(api.chatReadCalls).toHaveLength(0);
  });

  it('does not post while the page is hidden, and does when it becomes visible', async () => {
    visibility = 'hidden';
    const api = createFakeMiniappApi({ chatHistory: [chatHistory([theirs(1)])] });
    await open(api);
    await new Promise((r) => setTimeout(r, 20));
    expect(api.chatReadCalls).toHaveLength(0);
    await becomeVisible();
    await waitFor(() => expect(api.chatReadCalls).toHaveLength(1));
  });

  it('never posts twice for the same value, and one request is in flight at a time', async () => {
    let release!: (v: ReadResponse) => void;
    const held = new Promise<ReadResponse>((r) => (release = r));
    const api = createFakeMiniappApi({
      chatHistory: [chatHistory([theirs(1)]), chatHistory([theirs(5), mine(4), theirs(1)])],
      chatRead: [held],
    });
    await open(api);
    await waitFor(() => expect(api.chatReadCalls).toHaveLength(1));
    // a newer creator message arrives while the first request is still out
    await becomeVisible();
    await waitFor(() => expect(api.chatHistoryCalls).toHaveLength(2));
    expect(api.chatReadCalls).toHaveLength(1);
    await act(async () => release({ last_read_seq: 1 }));
    await waitFor(() => expect(api.chatReadCalls).toHaveLength(2));
    expect(api.chatReadCalls[1]!.throughSeq).toBe(5);
    await new Promise((r) => setTimeout(r, 20));
    expect(api.chatReadCalls).toHaveLength(2);
  });

  it('a failed post is silent and the next trigger tries again', async () => {
    const api = createFakeMiniappApi({
      chatHistory: [chatHistory([theirs(1)])],
      chatRead: [networkError()],
    });
    const hook = await open(api);
    await waitFor(() => expect(api.chatReadCalls).toHaveLength(1));
    ready(hook);
    await becomeVisible();
    await waitFor(() => expect(api.chatReadCalls).toHaveLength(2));
  });
});

describe('peerReadSeq', () => {
  it('follows the creator’s cursor and never goes down on a stale refetch', async () => {
    const api = createFakeMiniappApi({
      chatHistory: [
        chatHistory([mine(2), theirs(1)], { peer_read_seq: 2 }),
        chatHistory([mine(2), theirs(1)], { peer_read_seq: 0 }),
      ],
    });
    const hook = await open(api);
    expect(hook.result.current.peerReadSeq).toBe(2);
    await becomeVisible();
    await waitFor(() => expect(api.chatHistoryCalls).toHaveLength(2));
    expect(hook.result.current.peerReadSeq).toBe(2);
  });
});
