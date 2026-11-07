# Stage A: safe onboarding and financial boundaries

This stage is a safety foundation, not a working production insurance service.

## Changed behavior

- No default admin credentials, cron secrets or worker signing-secret fallback. Signing secrets must be unique and at least 32 characters.
- Production requires `DATABASE_URL`. A failed Neon request never silently selects SQLite in production. Local failover is opt-in.
- Neon requests full results so an UPDATE without RETURNING still exposes its affected-row count. Ambiguous writes are not automatically retried.
- Registration requires a phone-bound, ten-minute, single-use proof. Proof consumption is atomic; replay and concurrent replay fail.
- Real SMS verification is not integrated. Production OTP request, verify and login fail closed. Local tests require `OTP_MODE=local_test` and an explicitly configured six-digit `OTP_DEMO_CODE`. No SMS is sent and local mode is not identity verification.
- Registration uses actual entered activity days and explicit consent choices. It records the choices. It does not fabricate KYC, upload verification, consent or a payout address.
- Account, consent, pending policy, calculation and activity records are written in one database transaction. A failed write rolls back the batch. A failed registration after proof consumption requires verification again.
- A registered worker can be signed in without a policy. Ineligible and opted-out workers have no policy. Eligible workers receive an unpaid `pending` quote, not active cover. Existing eligibility thresholds are unchanged.
- Claims, policy history, claim export and worker-specific pricing require a worker session matching an active account. Client-supplied worker IDs cannot authorize access. Dashboard aggregates and actuarial projections require an admin session.
- Direct trigger-claim submission, payment order creation, policy reactivation, admin payout approval and cron claim generation are disabled. They return an explicit unavailable response before any financial effect. Review/rejection remains available.
- Trigger checks are previews only. Local simulation requires an explicit switch; it never creates claims or ledger entries.
- Dashboard, claims, policy and profile status do not show invented active cover for null or pending policies. Fabricated client-side payments, receipt verification and local paid claims were removed.

## Local checks

Run from the repository root:

```sh
npm ci
npm test
npm run typecheck
npm run build
```

The regression suite uses temporary isolated SQLite databases and a mocked Neon HTTP response. It does not contact an OTP/payment provider or transfer money. It checks proof ownership/expiry/replay/races, null and pending cover, explicit consent, owner-bound routes, expired/tampered sessions, account revocation, disabled financial effects, atomic rollback, Neon affected-row counts and production fail-closed configuration.

Mobile browser verification covered phone request, local verification, work profile, real activity fields, explicit consent, successful uncovered registration, and dashboard/claims/policy uncovered states. No real identity, KYC or payment provider was used.

## Before production use

Choose and integrate a genuine phone-verification provider. Add authoritative event ingestion and documented eligibility/plan terms. Implement server-priced payment orders, signature/webhook verification, idempotent activation and payout reconciliation before restoring disabled financial endpoints. Review existing active/paid rows: this stage does not silently rewrite historical demo records. The existing ML, weather provenance, underwriting legal wording, rate-limit persistence and broader hardcoded product data remain later-stage work.

The project-wide lint baseline was repaired in a follow-up: strict lint, tests, typecheck and production build pass. Dependency advisories remain from the audit and are not claimed fixed by this stage.
