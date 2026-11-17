import { z } from 'zod';

/** Socket.IO path of the API (US-031). */
export const REALTIME_PATH = '/realtime';

/** The room of one account. The server joins it from the verified token; clients never choose it. */
export const userRoom = (userId: string): string => `user:${userId}`;

/**
 * Server → client events are signals only: no text, names or previews. The client refetches over
 * HTTP, which stays the only read and write path for content.
 */
export const MessageCreatedEventSchema = z.strictObject({
  conversation_id: z.uuid(),
  seq: z.number().int().min(1),
});
export const ReadUpdatedEventSchema = z.strictObject({
  conversation_id: z.uuid(),
  through_seq: z.number().int().min(0),
});
export const ConversationUpdatedEventSchema = z.strictObject({ conversation_id: z.uuid() });
export const SessionEndedEventSchema = z.strictObject({});

export const RealtimeEventSchemas = {
  'message.created': MessageCreatedEventSchema,
  'read.updated': ReadUpdatedEventSchema,
  'conversation.updated': ConversationUpdatedEventSchema,
  'session.ended': SessionEndedEventSchema,
} as const;
export type RealtimeEventName = keyof typeof RealtimeEventSchemas;

export type RealtimeEvents = {
  'message.created': z.infer<typeof MessageCreatedEventSchema>;
  'read.updated': z.infer<typeof ReadUpdatedEventSchema>;
  'conversation.updated': z.infer<typeof ConversationUpdatedEventSchema>;
  'session.ended': z.infer<typeof SessionEndedEventSchema>;
};

/** The handshake carries the access token in `auth`, never in the URL. */
export const RealtimeAuthSchema = z.strictObject({ token: z.string().min(1) });
export type RealtimeAuth = z.infer<typeof RealtimeAuthSchema>;

/** `connect_error` data: a code only. */
export const REALTIME_CONNECT_ERRORS = ['UNAUTHENTICATED', 'FORBIDDEN_ROLE'] as const;
export type RealtimeConnectError = (typeof REALTIME_CONNECT_ERRORS)[number];
