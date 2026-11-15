# QA Report: TASK-007 — API bootstrap — request ID, error contract, logging, health

**Result:** PASS
**Date:** 2026-11-15

## Checked
- 25 API tests pass against real PostgreSQL + Redis: error contract (404/403/500/400/413/malformed JSON), request-id echo/replace, log hygiene (no auth, cookie, body, query or initData in logs), CORS allowlist, health ok (200), db-down and redis-down (503 degraded, only the failing dependency down), no connection details in bodies.
- Live check on the running dev stack: GET /v1/health returns 200 {"status":"ok","checks":{"db":"up","redis":"up"}}; unknown route returns the {code,message,request_id} contract with a matching x-request-id header; CORS echoes only the allowlisted origin.
- Bugs found and fixed during QA: (1) unexpected-error messages were being logged (now only error name + stack frames); (2) env placeholders such as https://<tunnel-or-domain> were treated as real URLs and stopped the API from starting (now any value containing <...> is "unset", with a regression test that loads .env.example as-is).
