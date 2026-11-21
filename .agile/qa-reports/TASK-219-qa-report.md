# QA Report: TASK-219 — Access-activated handler, templates and date formatting

**Result:** PASS (US-044, 2026-11-21)

## Built
`ACCESS_TEMPLATES` (the three `AdmSetNotif` texts verbatim) with a one-pass `renderTemplate`; `formatAccessDate` (`27 Nov 2026, 23.59 WIB`); `accessActivatedHandler` for `subscription.granted` / `.extended`.

## Verified
- `access-date.spec.ts`: WIB / WITA / WIT, midnight as 00, Indonesian short months (Agu), other zone and unknown zone fall back.
- `access-templates.spec.ts`: board texts, a name containing `{creator}` is not re-expanded, unknown variables untouched.
- `access-activated-handler.int.spec.ts` (8 cases, real access events from `SubscriptionAccessService`): text, date and chat-path button; customer timezone; extension sends a second notice with the new date; revoked / ended before delivery → SKIPPED; blocked creator, blocked customer, bot-blocked → SKIPPED with no Telegram call; an outbox row whose payload names another subscription's access event → FAILED `event_missing`, nothing sent; duplicate job, 429 and ambiguous timeout → one send; a permanent failure leaves the subscription untouched.

## Notes
- Grants end at 23:59:59 admin-zone time, so the notice shows e.g. `21 Des 2026, 23.59 WIB` (the plan's examples used 12.00; the tests follow the real behaviour).
- Recipient, creator name, date and conversation come from the database by id; the payload only names the access event, which must belong to the outbox row's subscription.
