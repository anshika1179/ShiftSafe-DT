# Support change history

Administrator saves record the actual previous and new status/note, configured authenticated administrator email, a server timestamp and a per-ticket monotonic revision. Note-only edits, note clearing and reopening are recorded. An unchanged save does not create a fake event. No old events are reconstructed for existing tickets.

Ticket changes and history are one database transaction. Conditional UPDATE checks the prior timestamp and unique change token. History INSERT SELECT runs only when that transaction's unique token is stored on the ticket; stale saves return409 without an event. Failure to save history rolls back the ticket change. Revision ordering remains stable when timestamps match. Reopening clears resolved_at; edits within a resolved/closed state preserve the original resolution time.

The existing admin card adds only a collapsed Change history disclosure. Open it to load the newest100 recorded changes and the actual total. The text states that earlier changes are unavailable. Failed loads show a retry, not stale entries or a false empty state. Saving/reloading replaces the card with the saved revision, which discards old history responses. Notes are plain React text with wrapping, not rendered HTML.

`GET /api/admin/service-requests/history?requestId=...` is admin-only, validated and no-store. Workers still see their current note/status through their existing scoped API, not administrator identity or old notes. There are no history edit/delete endpoints. This is stored application history, not a tamper-proof compliance log: a database administrator can still alter rows. Creation/imports/direct database edits outside the admin-save workflow are not recorded by this feature.

The rollout adds a history table/index and two non-null defaulted revision columns. Existing workers and ticket contents remain unchanged. No production ticket should be changed merely to demonstrate the feature; use local fixtures unless the owner has reviewed the exact real update.

Local tests cover authorization, truthful empty history, no-op, status/note changes, preserved resolution times, reopen/clear, stale and concurrent saves, same-timestamp token guards, worker privacy,100-event cap/count and transaction rollback. Exact SQL is also checked on an isolated PostgreSQL engine, separate from the SQLite tests. Desktop1280/mobile390 browser tests verify stored history, retry/no-stale behavior and wrapping in the existing design.

PostgreSQL row-lock behavior used by the transaction:
https://www.postgresql.org/docs/current/sql-select.html
