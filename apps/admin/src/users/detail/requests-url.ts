import {
  DEFAULT_USER_REQUESTS_QUERY,
  UserRequestsQuerySchema,
  type UserRequestsQuery,
} from '@creatorchat/contracts';
import { userRequestsSearch } from '../../auth/api-client';

/** Each URL value is checked alone; an invalid one falls back to its default. */
export function parseRequestsSearch(params: URLSearchParams): UserRequestsQuery {
  const raw: Record<string, string> = {};
  for (const key of Object.keys(UserRequestsQuerySchema.shape)) {
    const value = params.get(key);
    if (value !== null && UserRequestsQuerySchema.safeParse({ [key]: value }).success) {
      raw[key] = value;
    }
  }
  return UserRequestsQuerySchema.parse(raw);
}

export function requestsSearchParams(query: UserRequestsQuery): URLSearchParams {
  return new URLSearchParams(userRequestsSearch(query).slice(1));
}

export function isDefaultRequestsFilter(query: UserRequestsQuery): boolean {
  return query.q === null && query.status === DEFAULT_USER_REQUESTS_QUERY.status;
}

export function resetRequestsFilters(query: UserRequestsQuery): UserRequestsQuery {
  return { ...query, q: null, status: DEFAULT_USER_REQUESTS_QUERY.status, page: 1 };
}
