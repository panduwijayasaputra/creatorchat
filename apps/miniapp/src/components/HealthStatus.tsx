import { useEffect, useState } from 'react';
import { fetchHealth, type HealthState } from '../health';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

/** API reachability indicator from GET /v1/health (US-001). */
export function HealthStatus({ baseUrl = API_BASE_URL }: { baseUrl?: string }) {
  const [state, setState] = useState<HealthState>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    void fetchHealth(baseUrl).then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, [baseUrl]);

  return (
    <div>
      {state.kind === 'loading' && <p>Checking API…</p>}
      {state.kind === 'unreachable' && <p>API unreachable</p>}
      {(state.kind === 'ok' || state.kind === 'degraded') && (
        <p>
          API: {state.kind} (database {state.health.checks.db}, redis {state.health.checks.redis})
        </p>
      )}
    </div>
  );
}
