import {
  DEFAULT_HISTORY_QUERY,
  HistoryQuerySchema,
  type HistoryQuery,
} from '@creatorchat/contracts';
import { historySearch } from '../../auth/api-client';

/** Same rule as the lists: each URL value is checked alone; an invalid one falls back to its default. */
export function parseHistorySearch(params: URLSearchParams): HistoryQuery {
  const raw: Record<string, string> = {};
  for (const key of Object.keys(HistoryQuerySchema.shape)) {
    const value = params.get(key);
    if (value !== null && HistoryQuerySchema.safeParse({ [key]: value }).success) raw[key] = value;
  }
  return HistoryQuerySchema.parse(raw);
}

export function historySearchParams(query: HistoryQuery): URLSearchParams {
  return new URLSearchParams(historySearch(query).slice(1));
}

export function isDefaultHistoryFilter(query: HistoryQuery): boolean {
  const d = DEFAULT_HISTORY_QUERY;
  return query.q === null && query.type === d.type && query.status === d.status;
}

export function resetHistoryFilters(query: HistoryQuery): HistoryQuery {
  const d = DEFAULT_HISTORY_QUERY;
  return { ...query, q: null, type: d.type, status: d.status, page: 1 };
}
