import { useCallback, useEffect, useRef, useState } from 'react';
import { CHAT_TEXT_MAX, type ChatHistoryResponse, type ChatMessage } from '@creatorchat/contracts';
import { ApiError, type MiniappApi } from '../auth/api-client';
import { useReconnect, useRealtimeEvent } from '../realtime/RealtimeProvider';
import { mergeMessages } from './chat-model';
import { useMarkRead } from './useMarkRead';

const PAGE = 30;

/** The file of a media message that is still being sent: enough to draw its bubble. */
export interface UnsentMedia {
  assetId: string;
  kind: 'PHOTO' | 'VIDEO';
  durationSeconds: number | null;
  thumbnailUrl: string;
}

/** A message of mine that the server has not confirmed (in memory only). `body` is empty for a media-only message. */
export interface UnsentMessage {
  clientMessageId: string;
  body: string;
  media?: UnsentMedia;
  status: 'sending' | 'failed';
}

export type ChatConversation = ChatHistoryResponse['conversation'];

/** A photo or video in a message (US-036). */
export interface ThreadAttachment {
  id: string;
  kind: 'PHOTO' | 'VIDEO';
  duration_seconds: number | null;
  thumbnail_url: string;
}

/** What a thread needs of a message, whichever side of the chat it is read from. */
export interface ThreadMessage {
  id: string;
  client_message_id: string;
  seq: number;
  type: 'TEXT' | 'MEDIA';
  body: string | null;
  attachments: ThreadAttachment[];
  created_at: string;
}

export type ThreadState<M extends ThreadMessage, C> =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'not-found' }
  | {
      status: 'ready';
      conversation: C;
      /** Ascending by seq. */
      messages: M[];
      nextBefore: number | null;
      older: 'idle' | 'loading' | 'failed';
      unsent: UnsentMessage[];
    };

export type ChatState = ThreadState<ChatMessage, ChatConversation>;

/** The two calls a thread makes, plus how a refused send changes the conversation's access. */
export interface ThreadAdapter<M extends ThreadMessage, C> {
  getHistory(
    conversationId: string,
    query: { before?: number; limit: number },
  ): Promise<{ conversation: C; items: M[]; next_before: number | null }>;
  send(
    conversationId: string,
    input: { client_message_id: string; body?: string; attachment?: { asset_id: string } },
  ): Promise<{ message: M }>;
  /** The conversation after the server refused a send with `code`, or null for any other failure. */
  accessLost(conversation: C, code: string): C | null;
}

type ChatApi = Pick<MiniappApi, 'getChatHistory' | 'sendChatMessage' | 'markChatRead'>;

const newestFirst = <M>(items: M[]) => [...items].reverse();

/** The customer side (US-026). */
export function useChat(api: ChatApi, conversationId: string) {
  const adapter: ThreadAdapter<ChatMessage, ChatConversation> = {
    getHistory: (id, q) => api.getChatHistory(id, q),
    // The customer only sends text.
    send: (id, input) =>
      api.sendChatMessage(id, {
        client_message_id: input.client_message_id,
        body: input.body ?? '',
      }),
    accessLost: (conversation, code) =>
      code === 'CHAT_CREATOR_BLOCKED'
        ? {
            ...conversation,
            access: { state: 'CREATOR_BLOCKED', ends_at: null, ended_at: null },
          }
        : code === 'CHAT_ACCESS_EXPIRED'
          ? { ...conversation, access: { state: 'EXPIRED', ends_at: null, ended_at: null } }
          : null,
  };
  const thread = useThread(adapter, conversationId);

  useMarkRead(
    thread.state,
    (m) => m.sender === 'CREATOR',
    conversationId,
    (id, seq) => api.markChatRead(id, seq),
  );

  // The creator's cursor only goes up: a stale refetch must not take a "Dibaca" back.
  const peer = useRef({ id: conversationId, seq: 0 });
  if (peer.current.id !== conversationId) peer.current = { id: conversationId, seq: 0 };
  if (thread.state.status === 'ready') {
    peer.current.seq = Math.max(peer.current.seq, thread.state.conversation.peer_read_seq);
  }

  return { ...thread, peerReadSeq: peer.current.seq };
}

/**
 * One private chat (US-026, shared with the creator side in US-029). The server paginates by `seq`;
 * a newer load supersedes an older one. Sending posts over HTTP with a client-made id, so a retry
 * (Kirim Ulang, lost answer) returns the same message. Unsent bubbles live in memory only.
 */
export function useThread<M extends ThreadMessage, C>(
  adapter: ThreadAdapter<M, C>,
  conversationId: string,
) {
  type State = ThreadState<M, C>;
  type Ready = Extract<State, { status: 'ready' }>;
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const apiRef = useRef(adapter);
  apiRef.current = adapter;
  const stateRef = useRef(state);
  stateRef.current = state;
  const sendingIds = useRef(new Set<string>());
  const olderBusy = useRef(false);
  /** What to post for my unsent messages by client id, so Kirim Ulang can repost without reading state. */
  const drafts = useRef(new Map<string, { body?: string; attachment?: { asset_id: string } }>());

  const failure = (error: unknown): State =>
    error instanceof ApiError && error.status === 404
      ? { status: 'not-found' }
      : { status: 'error' };

  useEffect(() => {
    const mine = ++generation.current;
    setState({ status: 'loading' });
    apiRef.current.getHistory(conversationId, { limit: PAGE }).then(
      (page) => {
        if (generation.current !== mine) return;
        setState({
          status: 'ready',
          conversation: page.conversation,
          messages: newestFirst(page.items),
          nextBefore: page.next_before,
          older: 'idle',
          unsent: [],
        });
      },
      (error: unknown) => {
        if (generation.current === mine) setState(failure(error));
      },
    );
    return () => {
      generation.current += 1;
    };
  }, [conversationId, attempt]);

  /** Fetches the newest page and merges it in. */
  const fetchNewest = useCallback(async () => {
    const mine = generation.current;
    try {
      const page = await apiRef.current.getHistory(conversationId, { limit: PAGE });
      if (generation.current !== mine) return;
      setState((s) => {
        if (s.status !== 'ready') return s;
        const incoming = newestFirst(page.items);
        const newest = s.messages[s.messages.length - 1]?.seq ?? 0;
        const gap = page.next_before !== null && (incoming[0]?.seq ?? Infinity) > newest + 1;
        const confirmed = new Set(incoming.map((m) => m.client_message_id));
        return {
          ...s,
          conversation: page.conversation,
          // A gap means more than a page arrived while away: start again from the newest page.
          messages: gap ? incoming : mergeMessages(s.messages, incoming),
          nextBefore: gap ? page.next_before : s.nextBefore,
          unsent: s.unsent.filter((u) => !confirmed.has(u.clientMessageId)),
        };
      });
    } catch {
      // Keep what is on screen; the next trigger tries again.
    }
  }, [conversationId]);

  /**
   * Refetches the newest page (tab visible again, a live signal, a reconnect, or access changed).
   * Triggers are coalesced: one fetch runs at a time and any number of triggers during it cause
   * exactly one more, so a burst of events is not a burst of requests.
   */
  const refreshing = useRef(false);
  const again = useRef(false);
  const refresh = useCallback(async () => {
    if (refreshing.current) {
      again.current = true;
      return;
    }
    refreshing.current = true;
    try {
      do {
        again.current = false;
        await fetchNewest();
      } while (again.current);
    } finally {
      refreshing.current = false;
    }
  }, [fetchNewest]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const loadOlder = useCallback(async () => {
    const current = stateRef.current;
    if (olderBusy.current || current.status !== 'ready' || current.nextBefore === null) return;
    const before = current.nextBefore;
    olderBusy.current = true;
    setState((s) => (s.status === 'ready' ? { ...s, older: 'loading' } : s));
    const mine = generation.current;
    try {
      const page = await apiRef.current.getHistory(conversationId, { before, limit: PAGE });
      if (generation.current !== mine) return;
      setState((s) =>
        s.status === 'ready'
          ? {
              ...s,
              messages: mergeMessages(s.messages, newestFirst(page.items)),
              nextBefore: page.next_before,
              older: 'idle',
            }
          : s,
      );
    } catch {
      if (generation.current === mine) {
        setState((s) => (s.status === 'ready' ? { ...s, older: 'failed' } : s));
      }
    } finally {
      olderBusy.current = false;
    }
  }, [conversationId]);

  const update = (fn: (s: Ready) => Ready) => setState((s) => (s.status === 'ready' ? fn(s) : s));

  const post = useCallback(
    async (clientMessageId: string) => {
      const draft = drafts.current.get(clientMessageId);
      if (!draft || sendingIds.current.has(clientMessageId)) return;
      sendingIds.current.add(clientMessageId);
      update((s) => ({
        ...s,
        unsent: s.unsent.map((u) =>
          u.clientMessageId === clientMessageId ? { ...u, status: 'sending' } : u,
        ),
      }));
      try {
        const { message } = await apiRef.current.send(conversationId, {
          client_message_id: clientMessageId,
          ...draft,
        });
        drafts.current.delete(clientMessageId);
        update((s) => ({
          ...s,
          messages: mergeMessages(s.messages, [message]),
          unsent: s.unsent.filter((u) => u.clientMessageId !== clientMessageId),
        }));
      } catch (error) {
        const code = error instanceof ApiError ? error.code : null;
        const lost = code ? (stateRef.current.status === 'ready' ? stateRef.current : null) : null;
        const changed = lost && code ? apiRef.current.accessLost(lost.conversation, code) : null;
        if (changed) {
          drafts.current.delete(clientMessageId);
          // Nothing was stored: drop the bubble and switch the composer; the refetch fills in dates.
          update((s) => ({
            ...s,
            conversation: changed,
            unsent: s.unsent.filter((u) => u.clientMessageId !== clientMessageId),
          }));
          void refresh();
        } else {
          update((s) => ({
            ...s,
            unsent: s.unsent.map((u) =>
              u.clientMessageId === clientMessageId ? { ...u, status: 'failed' } : u,
            ),
          }));
        }
      } finally {
        sendingIds.current.delete(clientMessageId);
      }
    },
    [conversationId, refresh],
  );

  const enqueue = useCallback(
    (
      draft: { body?: string; attachment?: { asset_id: string } },
      unsent: Omit<UnsentMessage, 'clientMessageId' | 'status'>,
    ) => {
      const clientMessageId = crypto.randomUUID();
      drafts.current.set(clientMessageId, draft);
      update((s) => ({
        ...s,
        unsent: [...s.unsent, { clientMessageId, status: 'sending', ...unsent }],
      }));
      void post(clientMessageId);
    },
    [post],
  );

  const send = useCallback(
    (text: string): boolean => {
      const body = text.trim();
      if (body.length === 0 || [...body].length > CHAT_TEXT_MAX) return false;
      enqueue({ body }, { body });
      return true;
    },
    [enqueue],
  );

  /** A photo or video, with an optional text (US-036). The asset was validated by the attach flow; the server checks it again. */
  const sendMedia = useCallback(
    (media: UnsentMedia, text: string): boolean => {
      const body = text.trim();
      if ([...body].length > CHAT_TEXT_MAX) return false;
      enqueue(
        { ...(body ? { body } : {}), attachment: { asset_id: media.assetId } },
        { body, media },
      );
      return true;
    },
    [enqueue],
  );

  const retry = useCallback(
    (clientMessageId: string) => {
      void post(clientMessageId);
    },
    [post],
  );

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  // Live signals (US-031): they carry no content, so the answer is always an HTTP refetch.
  useRealtimeEvent('message.created', (e) => {
    if (e.conversation_id === conversationId) void refresh();
  });
  useRealtimeEvent('read.updated', (e) => {
    if (e.conversation_id === conversationId) void refresh();
  });
  // After a reconnect: catch up, and post my unconfirmed messages again with the same ids (the
  // server returns the stored message when one did arrive; `post` ignores one already in flight).
  useReconnect(() => {
    void refresh();
    const current = stateRef.current;
    if (current.status !== 'ready') return;
    for (const u of current.unsent) void post(u.clientMessageId);
  });

  return { state, send, sendMedia, retry, loadOlder, reload, refresh };
}
