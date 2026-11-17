import {
  CreatorListQuerySchema,
  DEFAULT_CREATOR_LIST_QUERY,
  type CreatorListQuery,
  type CreatorListStatus,
} from '@creatorchat/contracts';
import { creatorListSearch } from '../auth/api-client';

/**
 * The list view lives in the URL (`/creators?status=…&sort=…&page=…`), so a reload, a detail page
 * and the back button all return to the same view. A hand-edited URL never breaks the page: every
 * value is checked on its own with the API's schema, and an invalid one falls back to its default.
 */
export function parseListSearch(params: URLSearchParams): CreatorListQuery {
  const raw: Record<string, string> = {};
  for (const key of Object.keys(CreatorListQuerySchema.shape)) {
    const value = params.get(key);
    if (value !== null && CreatorListQuerySchema.safeParse({ [key]: value }).success) {
      raw[key] = value;
    }
  }
  return CreatorListQuerySchema.parse(raw);
}

export function listSearchParams(query: CreatorListQuery): URLSearchParams {
  return new URLSearchParams(creatorListSearch(query).slice(1));
}

export function isDefaultFilter(query: CreatorListQuery): boolean {
  const d = DEFAULT_CREATOR_LIST_QUERY;
  return (
    query.q === null &&
    query.status.join() === d.status.join() &&
    query.type === d.type &&
    query.range === d.range
  );
}

/** Filters back to default; sort and page size are the person's layout choices and stay. */
export function resetFilters(query: CreatorListQuery): CreatorListQuery {
  const d = DEFAULT_CREATOR_LIST_QUERY;
  return { ...query, q: null, status: d.status, type: d.type, range: d.range, page: 1 };
}

/** Every non-empty combination of the three statuses, in the order `Select` shows them. */
export const STATUS_COMBINATIONS: readonly (readonly CreatorListStatus[])[] = [
  ['request', 'active', 'blocked'],
  ['request'],
  ['active'],
  ['blocked'],
  ['request', 'active'],
  ['request', 'blocked'],
  ['active', 'blocked'],
];
