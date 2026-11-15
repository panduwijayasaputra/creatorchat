import { HealthResponseSchema, type HealthResponse } from '@creatorchat/contracts';

export type HealthState =
  | { kind: 'loading' }
  | { kind: 'ok' | 'degraded'; health: HealthResponse }
  | { kind: 'unreachable' };

/** Calls GET /v1/health. Network errors and malformed bodies become `unreachable`; never throws. */
export async function fetchHealth(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HealthState> {
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/v1/health`);
    const parsed = HealthResponseSchema.safeParse(await response.json());
    if (!parsed.success) return { kind: 'unreachable' };
    return { kind: parsed.data.status, health: parsed.data };
  } catch {
    return { kind: 'unreachable' };
  }
}
