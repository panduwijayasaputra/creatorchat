# QA Report: TASK-083

**Verdict:** PASS

## Verified (run)
- API integration (6 cases over HTTP with a real admin session): contract shape + `Cache-Control: no-store`; no session → 401 and a **Telegram user Bearer token → 401**; filters, sort and pagination change the backend result (name asc/desc reverse each other, pages concatenate to the full set, status/type/q/range counts, page past the end empty, page_size 25); 13 invalid queries (unknown sort/dir/status/type/range/size/key, empty status, repeated key, 101-char q) → 400 `VALIDATION_FAILED`; the body holds only contract keys and none of the application text; the endpoint writes nothing (row counts of users, applications, creators, audit, outbox unchanged).
- Admin client (6 cases): GET without CSRF or body; defaults left out and every non-default value URL-encoded; response validated; an aborted call is a `NetworkError`; one renewal then a retry; a 400 keeps its `ApiError`. admin auth specs still pass (36).
- Lint caught three leftovers in the copied test harness; fixed.
