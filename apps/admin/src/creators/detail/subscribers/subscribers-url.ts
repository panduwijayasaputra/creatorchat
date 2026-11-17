import {
  CreatorSubscribersQuerySchema,
  DEFAULT_CREATOR_SUBSCRIBERS_QUERY,
  type CreatorSubscribersQuery,
} from '@creatorchat/contracts';
import { creatorSubscribersSearch } from '../../../auth/api-client';

/** Each URL value is checked alone; an invalid one falls back to its default. */
export function parseSubscribersSearch(params: URLSearchParams): CreatorSubscribersQuery {
  const raw: Record<string, string> = {};
  for (const key of Object.keys(CreatorSubscribersQuerySchema.shape)) {
    const value = params.get(key);
    if (value !== null && CreatorSubscribersQuerySchema.safeParse({ [key]: value }).success) {
      raw[key] = value;
    }
  }
  return CreatorSubscribersQuerySchema.parse(raw);
}

export function subscribersSearchParams(query: CreatorSubscribersQuery): URLSearchParams {
  return new URLSearchParams(creatorSubscribersSearch(query).slice(1));
}

export function isDefaultSubscribersFilter(query: CreatorSubscribersQuery): boolean {
  const d = DEFAULT_CREATOR_SUBSCRIBERS_QUERY;
  return query.q === null && query.status === d.status && query.ends === d.ends;
}

/** Filters back to default; sort and page size stay. */
export function resetSubscribersFilters(query: CreatorSubscribersQuery): CreatorSubscribersQuery {
  const d = DEFAULT_CREATOR_SUBSCRIBERS_QUERY;
  return { ...query, q: null, status: d.status, ends: d.ends, page: 1 };
}
