import {
  DEFAULT_SUBSCRIPTION_LIST_QUERY,
  SubscriptionListQuerySchema,
  type SubscriptionListQuery,
} from '@creatorchat/contracts';
import { subscriptionListSearch } from '../../../auth/api-client';

/** Each URL value is checked alone; an invalid one falls back to its default. */
export function parseSubscriptionsSearch(params: URLSearchParams): SubscriptionListQuery {
  const raw: Record<string, string> = {};
  for (const key of Object.keys(SubscriptionListQuerySchema.shape)) {
    const value = params.get(key);
    if (value !== null && SubscriptionListQuerySchema.safeParse({ [key]: value }).success) {
      raw[key] = value;
    }
  }
  return SubscriptionListQuerySchema.parse(raw);
}

export function subscriptionsSearchParams(query: SubscriptionListQuery): URLSearchParams {
  return new URLSearchParams(subscriptionListSearch(query).slice(1));
}

export function isDefaultSubscriptionsFilter(query: SubscriptionListQuery): boolean {
  const d = DEFAULT_SUBSCRIPTION_LIST_QUERY;
  return query.q === null && query.status === d.status && query.ends === d.ends;
}

export function resetSubscriptionsFilters(query: SubscriptionListQuery): SubscriptionListQuery {
  const d = DEFAULT_SUBSCRIPTION_LIST_QUERY;
  return { ...query, q: null, status: d.status, ends: d.ends, page: 1 };
}
