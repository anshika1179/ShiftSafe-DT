# Google sign-in setup (free personal prototype)

This is not active insurance. Payment, activation, automatic claims and payout approval remain off. Google verifies a Google account, never a phone or work eligibility. A Google account is owned by its Firebase subject, not by matching a phone or email to an older worker record. Phone-only accounts are not automatically linked. A separate verified migration would be needed for those users.

## Setup and deployment checklist

1. Create a Firebase project on **Spark**. Do not link Cloud Billing, upgrade to Blaze or enable paid products. Enable Authentication > Google provider with the project's support email. Register a Web app and copy its web config. Authorize the app's exact production domain in Authentication settings. localhost may need explicit addition for development. Avoid broad preview-domain authorization.
2. Create a fresh Neon project in a permanent **Free** organization, not a paid plan/credits trial. Copy its Connect connection string for the chosen database/role with TLS options intact. Never use an upstream database. The initial role needs permission to create/alter tables; deployment schema setup should be checked before live registrations.
3. In the Vercel project's environment variables set, for the next Production deployment:
   - `DATABASE_URL`: Neon connection string. Private.
   - `WORKER_SESSION_SECRET`: private unique >=32 characters. Generate locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and paste directly into Vercel, not chat/Git.
   - `FIREBASE_PROJECT_ID`: exact Firebase project ID used for server issuer/audience verification.
   - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`: same project ID.
   - `NEXT_PUBLIC_FIREBASE_API_KEY`: Firebase web API key.
   - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`: Firebase web config auth domain.
   Firebase browser config is intentionally client-visible. Restrict the web API key appropriately and authorize only required domains. No Firebase service-account private key is needed here: the server verifies Firebase Google ID tokens using Google's public signing keys.
4. Redeploy after saving. Public config is bundled at build time. Existing deployments do not receive changed variables.
5. Verify /api/health returns database up; confirm tables were created with no demo rows. Use a real Google account in the production UI; create a profile, sign out/in, inspect its pending/null policy and explicitly unverified phone. Confirm another Google subject cannot retrieve it even if it enters the same contact phone/email. This live provider/database check has not yet been performed.

Optional admin config is separate: `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH` (salted scrypt preferred; legacy SHA-256 supports compatible migration, see [admin migration](admin-auth-migration.md)) and independent `ADMIN_SESSION_SECRET`. Cron auth uses a separate `CRON_SECRET`. Do not enable these unless needed. `OTP_MODE=local_test`, `OTP_DEMO_CODE` and demo seeding do not enable production SMS. Never add private secrets with NEXT_PUBLIC prefixes.

## Schema and compatibility

`backend/src/models/db.ts` auto-initializes tables on first DB use. New worker records authenticated with Google store no phone in the legacy unique auth phone column; unverified contact phone goes in `worker_contacts`. `worker_identities` has a unique provider/subject and worker binding, and `google_registration_proofs` stores hashed, expiring, atomically single-use proofs. Neon migration makes the legacy phone column nullable, preserving its existing unique constraint. A partial unique index preserves uniqueness for legacy non-null auth phones on fresh schemas.

Use a fresh SQLite database for local Google tests. A legacy SQLite NOT NULL UNIQUE phone schema is deliberately blocked instead of attempting a destructive in-place table rebuild. Production is Neon only, with no SQLite failover. Fresh-schema and legacy-constraint migration SQL were exercised on a local PostgreSQL-compatible PGlite engine. On October 5, the actual application initialized all 19 public tables in the fresh hosted Neon database successfully, with zero workers and identities. Live provider/profile flows remain to be tested after the approved deployment.

## Limits and sources (checked October 5, 2026)

- Firebase Spark social sign-in is no-cost, no payment information. Identity Platform instrumentless Tier-1 limit is 3,000 daily active users. Phone SMS requires billing-enabled Blaze and is not part of this plan. Stay Spark and do not attach billing: https://firebase.google.com/pricing and https://firebase.google.com/docs/auth/limits and https://firebase.google.com/docs/projects/billing/firebase-pricing-plans
- Google Web setup: https://firebase.google.com/docs/auth/web/google-signin
- Server ID-token verification: https://firebase.google.com/docs/auth/admin/verify-id-tokens
- Neon Free is permanent/no-card: 100 CU-hours/project/month, 0.5 GB/project storage, 5 GB/project/month public transfer, scale-to-zero after 5 idle minutes. Limits stop service/writes, not automatic billing. Documentation varies on exact storage-cap suspension behavior. https://neon.com/pricing and https://neon.com/docs/introduction/plans
- Neon connection string: https://neon.com/docs/connect/connect-from-any-app
- Vercel Hobby is personal/non-commercial only; quotas may pause service. Not suitable for a commercial insurance operation: https://vercel.com/docs/plans/hobby
- Vercel variables require redeploy: https://vercel.com/docs/environment-variables/managing-environment-variables

## Remaining limitations

Firebase Spark project `shiftsafe-dt`, Web app `ShiftSafe-Web`, Google provider, and production domain `shift-safe-dt.vercel.app` are configured. Fresh Neon project `shiftsafe-google-free` is on Free in Singapore; the existing database was not reused. All six variables are saved for Vercel Production, with DATABASE_URL and WORKER_SESSION_SECRET as private Secrets. No deployment has been started for these changes. Real provider popup/authorized-domain behavior still requires live testing after deployment. Signing-key availability is an external dependency. Tokens must be Google-provider, verified email, correct project/issuer/algorithm, unexpired and recently authenticated. Sessions last seven days and are revoked locally by worker inactivity or identity-binding change; Firebase-side account revocation is not yet polled continuously. In-memory per-instance rate limiting needs durable distributed enforcement before broader public use. Proofs expire after ten minutes; failed registration after proof consumption requires signing in again. Limits, free plans and vendor policies can change.
