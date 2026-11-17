import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeMiniappApi,
  fakeSeen,
  fakeTelegram,
  maya,
  nadia,
  networkError,
  type FakeMiniappApi,
} from '../../test/fake-miniapp-api';
import { createFakeRealtime } from '../../test/fake-realtime';
import { createMiniappRoutes } from '../app/routes';
import {
  RETRY_BASE_MS,
  useRealtimeEvent,
  useRealtimeStatus,
  useReconnect,
} from './RealtimeProvider';

const CONV = '22222222-0000-4000-8000-000000000001';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('offline'))),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const log: string[] = [];
function Probe() {
  const { status, hasConnected } = useRealtimeStatus();
  useRealtimeEvent('message.created', (p) => log.push(`message ${p.conversation_id} ${p.seq}`));
  useRealtimeEvent('conversation.updated', (p) => log.push(`conversation ${p.conversation_id}`));
  useRealtimeEvent('read.updated', (p) => log.push(`read ${p.through_seq}`));
  useReconnect(() => log.push('reconnect'));
  return <div data-testid="probe">{`${status}|${hasConnected}`}</div>;
}

function mount(api: FakeMiniappApi, rt = createFakeRealtime(), withFactory = true) {
  log.length = 0;
  const routes = createMiniappRoutes({
    api,
    telegram: fakeTelegram('query_id=x&hash=y'),
    seen: fakeSeen(true),
    ...(withFactory ? { realtime: rt.factory } : {}),
    extraRoutes: [],
  });
  // The probe sits under the real providers through an extra page of the Mini App routes.
  routes[0]!.children![0]!.children!.unshift({ path: '/__probe', element: <Probe /> });
  const router = createMemoryRouter(routes, { initialEntries: ['/__probe'] });
  render(<RouterProvider router={router} />);
  return { rt, router };
}
const state = () => screen.getByTestId('probe').textContent;

describe('RealtimeProvider', () => {
  it('connects for a USER and a CREATOR, with the current token read at connect time', async () => {
    const a = mount(createFakeMiniappApi({ me: [nadia] }));
    await screen.findByTestId('probe');
    await waitFor(() => expect(a.rt.sockets).toHaveLength(1));
    expect(a.rt.last().connectCalls).toBe(1);
    expect(a.rt.last().tokens).toEqual(['token-0']);
    cleanup();
    const b = mount(createFakeMiniappApi({ me: [maya] }));
    await screen.findByTestId('probe');
    await waitFor(() => expect(b.rt.sockets).toHaveLength(1));
  });

  it('does not connect without a factory', async () => {
    const rt = createFakeRealtime();
    mount(createFakeMiniappApi({ me: [nadia] }), rt, false);
    await screen.findByTestId('probe');
    expect(rt.sockets).toHaveLength(0);
    expect(state()).toBe('idle|false');
  });

  it('follows connecting → connected → disconnected → connected and fires reconnect only the second time', async () => {
    const { rt } = mount(createFakeMiniappApi({ me: [nadia] }));
    await screen.findByTestId('probe');
    await waitFor(() => expect(rt.sockets).toHaveLength(1));
    expect(state()).toBe('connecting|false');
    act(() => rt.last().open());
    expect(state()).toBe('connected|true');
    expect(log).toEqual([]);
    act(() => rt.last().drop());
    expect(state()).toBe('disconnected|true');
    act(() => rt.last().open());
    expect(state()).toBe('connected|true');
    expect(log).toEqual(['reconnect']);
  });

  it('hands valid events to subscribers and drops malformed ones', async () => {
    const { rt } = mount(createFakeMiniappApi({ me: [nadia] }));
    await screen.findByTestId('probe');
    await waitFor(() => expect(rt.sockets).toHaveLength(1));
    act(() => {
      rt.last().open();
      rt.last().serverEmit('message.created', { conversation_id: CONV, seq: 4 });
      rt.last().serverEmit('conversation.updated', { conversation_id: CONV });
      rt.last().serverEmit('read.updated', { conversation_id: CONV, through_seq: 2 });
      rt.last().serverEmit('message.created', { conversation_id: 'nope', seq: 4 });
      rt.last().serverEmit('message.created', { conversation_id: CONV, seq: 4, body: 'leak' });
      rt.last().serverEmit('message.created', 'garbage');
    });
    expect(log).toEqual([`message ${CONV} 4`, `conversation ${CONV}`, 'read 2']);
  });

  it('renews the token and reconnects after the server hangs up, with backoff', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const api = createFakeMiniappApi({ me: [nadia] });
    const { rt } = mount(api);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => rt.last().open());
    act(() => rt.last().serverHangup());
    expect(api.renewCalls).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETRY_BASE_MS);
    });
    expect(api.renewCalls).toBe(1);
    expect(rt.last().connectCalls).toBe(2);
    expect(rt.last().tokens).toEqual(['token-0', 'token-1']);

    // Refused again: the next wait doubles.
    act(() => rt.last().refuse('UNAUTHENTICATED'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETRY_BASE_MS);
    });
    expect(api.renewCalls).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETRY_BASE_MS);
    });
    expect(api.renewCalls).toBe(2);
  });

  it('stops retrying when the session is lost, and retries when the renewal itself fails offline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const api = createFakeMiniappApi({ me: [nadia] });
    api.renewResults.push(networkError(), null);
    const { rt } = mount(api);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => rt.last().refuse('UNAUTHENTICATED'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETRY_BASE_MS);
    });
    expect(api.renewCalls).toBe(1); // offline: scheduled again
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETRY_BASE_MS * 2);
    });
    expect(api.renewCalls).toBe(2); // null: session lost
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(api.renewCalls).toBe(2);
    expect(rt.last().connectCalls).toBe(1);
  });

  it('a network error while connecting does not trigger a renewal', async () => {
    const api = createFakeMiniappApi({ me: [nadia] });
    const { rt } = mount(api);
    await screen.findByTestId('probe');
    await waitFor(() => expect(rt.sockets).toHaveLength(1));
    act(() => rt.last().networkError());
    expect(api.renewCalls).toBe(0);
    expect(state()).toBe('connecting|false');
  });

  it('closes the socket when the provider unmounts', async () => {
    const { rt } = mount(createFakeMiniappApi({ me: [nadia] }));
    await screen.findByTestId('probe');
    await waitFor(() => expect(rt.sockets).toHaveLength(1));
    cleanup();
    expect(rt.last().disconnectCalls).toBeGreaterThan(0);
  });
});
