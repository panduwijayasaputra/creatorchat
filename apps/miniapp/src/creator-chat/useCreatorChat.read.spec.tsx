import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createFakeMiniappApi,
  creatorChatHistory,
  creatorChatMessage,
  networkError,
} from '../../test/fake-miniapp-api';
import { useCreatorChat } from './useCreatorChat';

const ID = '66666666-0000-4000-8000-000000000001';
const customer = (seq: number) => creatorChatMessage(seq, { sender: 'CUSTOMER' });
const mine = (seq: number) => creatorChatMessage(seq, { sender: 'ME' });

let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
afterEach(() => {
  visibility = 'visible';
});

async function open(api: ReturnType<typeof createFakeMiniappApi>) {
  const hook = renderHook(() => useCreatorChat(api, ID));
  await waitFor(() => expect(hook.result.current.state.status).toBe('ready'));
  return hook;
}

describe('the creator marks the customer’s messages as read', () => {
  it('posts the newest customer message to the creator endpoint, never the customer one', async () => {
    const api = createFakeMiniappApi({
      creatorChatHistory: [creatorChatHistory([mine(4), customer(3), customer(2), mine(1)])],
    });
    await open(api);
    await waitFor(() => expect(api.creatorReadCalls).toHaveLength(1));
    expect(api.creatorReadCalls[0]).toEqual({ conversationId: ID, throughSeq: 3 });
    expect(api.chatReadCalls).toHaveLength(0);
  });

  it('posts nothing when only my own messages are on screen', async () => {
    const api = createFakeMiniappApi({
      creatorChatHistory: [creatorChatHistory([mine(2), mine(1)])],
    });
    await open(api);
    await new Promise((r) => setTimeout(r, 20));
    expect(api.creatorReadCalls).toHaveLength(0);
  });

  it('retries a failed post when the tab becomes visible again', async () => {
    const api = createFakeMiniappApi({
      creatorChatHistory: [creatorChatHistory([customer(1)])],
      creatorRead: [networkError()],
    });
    await open(api);
    await waitFor(() => expect(api.creatorReadCalls).toHaveLength(1));
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(api.creatorReadCalls).toHaveLength(2));
  });
});
