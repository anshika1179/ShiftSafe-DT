# ShiftSafe

Personal food-delivery income-protection prototype for Zomato/Swiggy. This is not an insurer, a binding insurance offer or a production payment service. Payment collection, real activation, automated real claims and payout approval remain blocked.

## What works
- Google subject-owned sign-in. New-user email-link gate. Optional restricted trial phone verification is separate from login and is not delivery/KYC verification.
- Saved work profile, editable city/zone/earnings and a resumable account journey. Existing accounts are not reset.
- Current Open-Meteo modelled weather and US AQI with units, source times and explicit unknown/stale states. India air-quality data is coarse model output, not a street sensor.
- Historical quote from 365 days of ERA5 rain/temperature history over the worker's explicitly entered usual weekdays and hours (IST). Income is self-reported. Threshold frequency is a weather-exposure proxy, not measured lost earnings.
- Separate no-money sandbox: explained quote -> simulated premium confirmation -> sandbox policy -> evidenced threshold review or labelled synthetic fixture -> capped simulated receipt. Missing work-zone/activity/loss evidence stays review and cannot settle.
- Scoped persisted-record analytics with live and sandbox totals separated. A ratio with no denominator reads insufficient data. Legacy records are preserved and labelled, not silently promoted to real cover or transfers.
- Support requests with the priority the user selects. No unvalidated NLP confidence or trained-fraud verdict.

## Limits that matter
No trained loss/fraud model, documented claim training dataset, holdout evaluation, prediction accuracy or actuarial forecast exists. Historical rules are explained assumptions. No authoritative delivery-platform activity, KYC, precise observed work-zone loss or bank reconciliation is connected. Platform outage/curfew inputs are unsupported as real observations. There is no hourly sweep or instant payout promise. Sandbox synthetic complete-evidence fixtures are not real events or training samples; fixture event hours may be future-dated and are labelled.

The challenge alignment is one delivery subcategory, weekly income loss, real-data provenance and an explicit simulated payment/claim path. Genuine learned risk/fraud evaluation is an open gap, not claimed complete.

## App routes
- `/journey`: profile, permissions, schedule, explained history quote, review
- `/dashboard` and `/analytics`: your persisted ledger metrics
- `/sandbox`: isolated no-money policy/event/claim/receipt lifecycle
- `/monitoring`: on-demand modelled environment and optional device-location check
- `/claims`, `/policies`: read-only legacy records, no fabricated fraud findings or receipt reference
- `/service-requests`: account support
- `/actuarial`: recorded ratio and explicit absence of validated actuarial model
- `/admin`: authenticated administrator records and support resolution

## Architecture
TypeScript monorepo with Next.js/React frontend (`frontend/`) and shared server modules (`backend/`). Next route handlers own API/auth. Neon serverless PostgreSQL is required in production; isolated SQLite is local/test only. Firebase/Google setup and sender-domain email gate are retained. No Python ML service is running.

Provider failures do not become demo observations. Production DB failure does not silently select SQLite. Sandbox policies/events/claims/receipts are separate tables and use transaction/replay/cap guards. Live financial routes and bonus creation/approval stay 503. All private analytics are authenticated and worker-scoped; public model health exposes capability status only.

## Local development
Use Node 22 and npm workspaces:
```sh
npm ci
cp .env.example .env.local
npm run dev
```
Configure secrets through your hosting/secret manager, never commit them. Local DB is SQLite if DATABASE_URL is absent; SEED_DEMO_DATA defaults false. Production requires DATABASE_URL, worker/admin session secrets and configured account providers. Refer to the setup documents for the Google/email onboarding variables rather than assuming passwordless authentication is enabled by copying the base example.

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run security:check
```
Strict CI gates quality, tests, build and audit. Runtime dependency audit must be clean. A known development-only braces advisory has a documented time-bounded exception expiring October 12, 2026; this is not a claim that all dependencies are vulnerability-free.

## Evidence and project notes
- [Running change/issue log](docs/WORK-LOG.md)
- [Approved repair stages and source ledger](docs/REPAIR-PLAN.md)
- [Historical quote provenance](docs/QUOTE-PROVENANCE.md)
- [Sandbox lifecycle and limitations](docs/SANDBOX-LIFECYCLE.md)
- [Analytics contract](docs/ANALYTICS.md)
- [Google sign-in setup](docs/google-signin-setup.md)
- [Email onboarding](docs/EMAIL_ONBOARDING.md)
- [Restricted trial phone verification](docs/phone-trial-setup.md)
- [Financial safety foundation](docs/stage-a-safety.md)
- [Security exception](docs/SECURITY-EXCEPTIONS.json)

Verification uses temporary SQLite fixtures plus isolated PostgreSQL-engine sandbox transaction tests. It is not a replay of a real production worker, live payment, real loss or unrestricted SMS. Mobile/desktop UI checks and final test outcomes are recorded in the work log. Hosted CI/deployment must be checked after each approved push; local success is not deployment proof.

## Data attribution
Weather/reanalysis: [Open-Meteo historical API](https://open-meteo.com/en/docs/historical-weather-api). Air quality: [Open-Meteo CAMS data](https://open-meteo.com/en/docs/air-quality-api). [Provider terms](https://open-meteo.com/en/terms) apply. This project uses the noncommercial free interface and sends no card/paid upgrade request. [Guidewire DevTrails organizer context](https://www.guidewire.com/resources/blog/developers/guidewire-devtrails-turns-a-university-hackathon-into-a-real-world-build).

Legacy pricing, fraud, actuarial simulation modules and fixture seed data remain as unvalidated historical code, not active product functionality. They must not be reinstated as trained-model or observed-data evidence without new source-backed validation.
