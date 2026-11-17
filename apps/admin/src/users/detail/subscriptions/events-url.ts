import {
  DEFAULT_SUBSCRIPTION_EVENTS_QUERY,
  SubscriptionEventsQuerySchema,
  type SubscriptionEventsQuery,
} from '@creatorchat/contracts';
import { subscriptionEventsSearch } from '../../../auth/api-client';

/** Each URL value is checked alone; an invalid one falls back to its default. */
export function parseEventsSearch(params: URLSearchParams): SubscriptionEventsQuery {
  const raw: Record<string, string> = {};
  for (const key of Object.keys(SubscriptionEventsQuerySchema.shape)) {
    const value = params.get(key);
    if (value !== null && SubscriptionEventsQuerySchema.safeParse({ [key]: value }).success) {
      raw[key] = value;
    }
  }
  return SubscriptionEventsQuerySchema.parse(raw);
}

export function eventsSearchParams(query: SubscriptionEventsQuery): URLSearchParams {
  return new URLSearchParams(subscriptionEventsSearch(query).slice(1));
}

export const isDefaultEvents = (query: SubscriptionEventsQuery): boolean =>
  JSON.stringify(query) === JSON.stringify(DEFAULT_SUBSCRIPTION_EVENTS_QUERY);
