# Record analytics contract

October 6, 2026. Active metrics derive from persisted ledger records. Account queries require a current authorized worker; cross-worker requests are forbidden. Administrator aggregate endpoints require an administrator session. Responses are no-store. Public `/api/ml/health` contains no user telemetry and reports trained ML unavailable.

- Policy counts and active-status counts are stored labels, not proof of real cover.
- Premium marked paid sums `premium_payments.amount` only where status equals `paid`. Policy face premiums are not money collected.
- Claims marked paid sum `claims.amount` only where status equals `paid`; `auto_approved` is not a transfer. These are historical record statuses, not verified bank movements.
- Recorded ratio equals all-time claims marked paid / premium marked paid; it is not a matched-period actuarial loss ratio. With zero denominator it is null and shown as insufficient data. There is no default BCR, reserve ratio, forecast or stress-test result.
- Sandbox policy premium and receipt totals come exclusively from sandbox tables and are never added to real ledger metrics. Review claims cannot settle.
- No manufactured sample charts, inferred fraud flags, trained forest label, synthetic clean/suspicious scores or self-test accuracy is displayed.
- New support requests retain user-selected priority; old classifier metadata is preserved in storage but not returned as validated assessment.

Read-only legacy policy/claim views replace obsolete payment/simulator/receipt controls. Administrator view preserves metric read access and support-status updates; live bonuses and financial approval remain blocked. Historical engines and seed fixtures are dormant and unvalidated, not erased records.
