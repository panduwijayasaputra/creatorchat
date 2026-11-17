import {
  DEFAULT_USER_LIST_QUERY,
  UserListQuerySchema,
  type UserListQuery,
} from '@creatorchat/contracts';
import { userListSearch } from '../auth/api-client';

/** Same rule as the creator list: every URL value is checked on its own; an invalid one falls back to its default. */
export function parseUserListSearch(params: URLSearchParams): UserListQuery {
  const raw: Record<string, string> = {};
  for (const key of Object.keys(UserListQuerySchema.shape)) {
    const value = params.get(key);
    if (value !== null && UserListQuerySchema.safeParse({ [key]: value }).success) {
      raw[key] = value;
    }
  }
  return UserListQuerySchema.parse(raw);
}

export function userListSearchParams(query: UserListQuery): URLSearchParams {
  return new URLSearchParams(userListSearch(query).slice(1));
}

export function isDefaultUserFilter(query: UserListQuery): boolean {
  const d = DEFAULT_USER_LIST_QUERY;
  return (
    query.q === null &&
    query.status.join() === d.status.join() &&
    query.request.join() === d.request.join() &&
    query.access === d.access &&
    query.range === d.range
  );
}

/** Filters back to default; sort and page size stay. */
export function resetUserFilters(query: UserListQuery): UserListQuery {
  const d = DEFAULT_USER_LIST_QUERY;
  return {
    ...query,
    q: null,
    status: d.status,
    request: d.request,
    access: d.access,
    range: d.range,
    page: 1,
  };
}
