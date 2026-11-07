# ShiftSafe-DT: audit and proposed repair plan
October 5, 2026

## Recommendation
Keep the existing Next.js modular monolith, Neon and Firebase. Build one honest, complete food-delivery income-protection prototype, with real data and an explicitly separate no-money sandbox lifecycle. Do not add paid infrastructure or pretend to provide licensed insurance. Repair dependencies and the worker journey first, then evidence, pricing, event automation, fraud and analytics. Preserve all existing accounts. Require approval of this plan before code changes, and approval before each push.

## Verified current state
- Canonical main is ef5dffca8ca7ba516a2664c3f75554d19b467d45; fresh origin/main matches the clean local checkout.
- 14 open Dependabot PRs (#3-16); two older superseded PRs closed. No feature PRs. The earlier zero-PR finding was for the deleted fork, not Shift-Safe.
- Baseline: 26 tests pass; typecheck, lint and build pass. npm audit nevertheless reports 19 affected packages: 1 critical, 15 high, 2 moderate and 1 low. This is an advisory report, not proof of exploitation; applicability and dependency paths need review.
- Live health reports Neon up. Public homepage and registration were opened and visually inspected. The homepage is present, not deleted. /login and the Google-registration handler explicitly route an already-registered user to /dashboard. Signed-in behavior was code-inspected, not freshly replayed in this audit; no account was reset.
- Safety gates deliberately block payments, activation, direct client claims, scheduled financial claims and payout approval. Keep these gates until the appropriate isolated implementation is tested.

## Findings
1. Weather: frontend/app/api/weather/route.ts fabricates weather and AQI on failure and still returns source=live. backend/src/services/triggers.ts falls back to random rain and fixed AQI. These must become unavailable/stale states, never events.
2. Pricing: premium-engine.ts uses fixed city risk probabilities, multipliers and artificial confidence/fraud probabilities. A city catalogue or a disclosed policy threshold is valid configuration; invented observations, learned probabilities or model confidence are not.
3. Fraud: missing GPS speed/accuracy/device inputs become plausible values; battery becomes random. Trees are built over fixed feature bounds, not fitted samples, and every leaf is at depth 10, undermining meaningful path-length scoring. Stop claiming trained ML. Missing evidence should be unknown/review, not fabricated clean evidence.
4. Location: arbitrary city/zone falls back to city centres, and the GPS endpoint defaults to Mumbai/Andheri. A single client GPS point cannot prove spoof resistance. Require resolved work-zone coordinates, timestamps and accuracy; collect only with consent.
5. Monitoring: screenshot upload stores name/size in component state, not file bytes or verified server evidence, yet says attached successfully. A demo evidence button manufactures a file name. Website probes alone are not proof that a rider's delivery app was unavailable or that income was lost.
6. Flow: registration has account/email, persona, profile and calculating screens, then immediately enters dashboard. There is no explicit review/terms/quote decision journey or persisted resumable onboarding state. Existing-user routing is normal session behavior but needs visible Home/Profile/Quote/How it works navigation, not account resets or repeated verification.
7. Alignment: README selects food delivery but UI allows food, grocery and e-commerce. The statement requires choosing one subcategory. Use the already-documented food-delivery focus (Zomato/Swiggy) unless Atul changes it. The statement is income-loss-only and weekly pricing. Its simulated payment path is explicitly allowed.
8. Analytics: analytics/page.tsx has fallback income 4200 and chart arrays [35,35,35,35] and [0,300,0,500]; actuarial pages substitute BCR 0.65. Remove invented numbers; undefined ratios when denominator is zero must read insufficient data, not healthy.
9. Eligibility: underwriting cites a 90/120-day Social Security Code requirement without supplied legal verification. Do not present this as a legal insurance eligibility mandate. Review it against actual sources; keep only clearly documented product rules appropriate to the prototype.
10. Documentation/CI: README still says production-ready, an old demo link and Python microservices. CI ignores lint and npm audit failures. The old cron claims zero-touch payouts and has unsafe fallback assumptions. Those are stale claims, not instructions to execute.

## Staged implementation
### 1. Dependencies, PRs and build controls
Audit each PR diff and current advisories; use a coherent supported dependency set, not blind merges. Pair Next.js with eslint-config-next, React with react-dom/types, Tailwind with its PostCSS plugin. Existing PR #13 only targets Next 16.2.6; the current advisory scan includes later affected ranges, so this PR alone is not an adequate fix. Review major ESLint and Actions updates separately. Replace stale PRs with tested updates; close only after the replacement is actually verified. Pin workflow dependencies, remove ignored lint/audit failures, add route and end-to-end tests. No automatic bulk merge.

### 2. Complete worker journey
Home -> account sign-in -> existing email-link gate for new accounts -> work profile and permissions -> resolved work zone/activity inputs -> eligibility result -> explained weekly quote -> explicit review -> sandbox policy -> dashboard. Persist stage server-side and resume incomplete steps. Existing complete accounts retain their data and can review profile/quote through clear navigation. Add unauthorized/deep-link/reload/back-button tests. Do not force established users through signup or reset them.

### 3. Real evidence and shared rules
Replace all fabricated API fallbacks with typed provider results carrying value, units, location, observation time, retrieval time, source and quality. Cache by zone/time bucket. Prefer keyless Open-Meteo for this noncommercial prototype; include attribution and quota checks. Its India air quality is a coarse global model, not a street sensor and not automatically Indian AQI. Use provider-specific AQI scales. Fail closed on missing/stale sources. Put documented thresholds/durations/payout fractions in a versioned shared configuration used by UI and server. Curfew and platform events stay unsupported until trustworthy evidence exists, or are explicitly user-entered sandbox events.

### 4. Evidence-based weekly pricing
Fetch historical weather for selected work zones, derive event frequency over the actual schedule, and combine with stated earnings/exposure to produce an explained weekly expected-loss quote. Train/evaluate a small risk model only on a real documented dataset, with holdout metrics, dataset date and model version. Weather events are proxy labels, not observed worker losses: disclose this limitation. With inadequate history, return insufficient data rather than city guesses. Configured expense/load/cap assumptions must be displayed. Do not call rule outputs trained AI or show invented confidence.

### 5. Isolated end-to-end sandbox automation and fraud
Introduce a separate sandbox ledger/state machine: quote -> simulated premium confirmation -> sandbox active policy -> evidenced event -> one automatic sandbox claim per worker/policy/event -> fraud review -> simulated settlement receipt. No real money, no fake UPI bank reference, no live insurance status. Server derives dates, price, limits and claim eligibility; financial operations are transactional and idempotent. Keep live financial routes blocked. Bind location checks to authenticated worker and zone/time, cross-check weather history, enforce duplicates, and treat missing data as review. Use a correctly fitted anomaly model only when genuine suitable activity/claim samples exist; until then label rules as rules and ML unavailable. Synthetic scenarios belong in tests, not live observations or claimed training data.

For a best-effort free demo event sweep, GitHub standard hosted Actions for a public repository is a candidate after current account settings are checked. Schedule away from the hour boundary, authenticate it, enforce replay/idempotency and display last successful run. GitHub schedules can be delayed or dropped; do not promise real-time/instant service. Vercel Hobby cron is once per day, not hourly. No new recurring workflow is enabled during this audit.

### 6. Truthful analytics, documentation and acceptance
Every metric comes from persisted records, with separate sandbox totals and explicit empty/loading/error states. Remove obsolete simulation controls and false setup instructions. Correct README, architecture and links. Test mobile and desktop pixels and keyboard navigation. Run signup/resume, quote, sandbox event, duplicate prevention, missing/stale data, unauthorized access, fraud-review and settlement-retry tests, plus a fresh dependency scan. Report evidence and remaining gaps before push; recheck the live deployment after an approved push.

## Scope and remaining decisions
Approval needed: the staged plan, retaining food-delivery focus, and an explicitly no-money sandbox policy/claim/payout demonstration. Real insurance issuance, actual payment collection or payouts, public unrestricted SMS and platform activity/KYC integrations are not delivered by free prototypes and are not authorized. No paid account, card, trial conversion, trial SMS, code edit, PR mutation or push occurred in this audit.

## Sources
- Official organizer summary: https://www.guidewire.com/resources/blog/developers/guidewire-devtrails-turns-a-university-hackathon-into-a-real-world-build . Confirms local-condition pricing, real data, fraud and meaningful ML evaluation.
- Public copy of detailed challenge document (secondary host, not authenticated organizer original): https://studylib.net/doc/28358590/devtrails-2026-usecase-document . Weekly income-loss coverage, one delivery subcategory, sandbox payments and simulated disruptions permitted. Obtain Atul's original document if its requirements differ.
- Open-Meteo terms: https://open-meteo.com/en/terms . Free API noncommercial only; fewer than 10,000/day, 5,000/hour, 600/minute; attribution required.
- Air quality sources and resolution: https://open-meteo.com/en/docs/air-quality-api . Global CAMS model roughly 45 km, 3-hourly; not hyperlocal ground observation.
- Historical weather: https://open-meteo.com/en/docs/historical-weather-api . Model/reanalysis provenance and hourly variables for retrospective analysis.
- Isolation Forest reference: https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.IsolationForest.html . Fitted samples, actual data bounds and shorter isolation paths distinguish anomalies.
- Browser geolocation: https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition . Secure context, permission and accuracy handling.
- Vercel cron limits: https://vercel.com/docs/cron-jobs/usage-and-pricing . Hobby once/day.
- GitHub scheduling: https://docs.github.com/actions/reference/workflows-and-actions/events-that-trigger-workflows . Schedule delay/drop caveat.
- GitHub Actions billing: https://docs.github.com/en/billing/concepts/product-billing/github-actions . Standard hosted runners free on public repositories; other runners/storage may cost.
- Current repo and PR evidence: https://github.com/atul-upadhyay-7/Shift-Safe , https://github.com/atul-upadhyay-7/Shift-Safe/pull/13 , https://github.com/atul-upadhyay-7/Shift-Safe/pull/16 .
- Live inspected pages: https://shift-safe-dt.vercel.app/ and https://shift-safe-dt.vercel.app/register .
