# Historical quote provenance (Stage4)

This is a prototype, not binding insurance pricing. Money, activation, claims and payouts stay disabled.

## Inputs and formula

Authenticated quote requests use stored platform, city, zone and weekly income, never client-provided income/city. The worker supplies weekdays and one same-day integer-hour IST window. Variable or overnight shifts are not represented. The selected usual schedule may differ from last week's reported activity; both remain self-reported, not platform-verified.

ERA5 via Open-Meteo supplies365 historical days ending six UTC calendar days before retrieval, allowing its documented five-day lag. One additional day is fetched for the midnight endpoint. Rain is the preceding-hour sum, temperature sampled at the hour end. Historical timestamp9:00 belongs to8:00-9:00 exposure. A midnight endpoint belongs to the previous date's23:00-24:00 exposure. Scheduled valid hours must cover98% of expected hours. Null, duplicate, incompatible units/timezone, malformed arrays and failures do not become reassuring zeros.

Configured threshold: rain >=30 mm in that hour OR temperature >=42°C. Union prevents double-counting. Quote = historical scheduled threshold-hour fraction * reported weekly income *0.50 assumed loss fraction *1.15 expense loading. Weekly limit =50% reported income. Zero historical crossings yields zero for this limited proxy, not zero risk. No minimum city tier is substituted.

Version weather-proxy-2026-10-06, source URL, history dates, schedule, sample counts, retrieval time, coordinate source/precision, attribution and limitations are persisted in quote_snapshots. Profile corrections delete the current snapshot; mismatching snapshot inputs/version are not returned. Existing financial/policy records are not repriced. New registration creates only an unpriced unpaid pending record (if prototype participation checks pass).

## What this cannot establish

No worker-loss/claims training dataset exists in this project. Weather threshold counts are not measured worker losses;50% loss and15% loading are product assumptions, not calibrated actuarial parameters. No trained model, confidence score, fraud probability, holdout result, KYC, legal eligibility or next-week forecast is claimed. City-center ERA5 is roughly0.25° resolution, not ward/street measurement. Historical AQI, app outage and curfew are excluded. Source-to-claim evidence and full sandbox lifecycle are remaining stages.

The lifetime90/120 legal gate, hardcoded ward risks and2025 disaster windows were removed from participation underwriting. Government benefits depend on onboarded schemes and scheme-specific conditions. Final applicability of the draft90/120 last-financial-year rule was not verified and is not used in this private product. Recorded consent is not a certificate of DPDP compliance.

## Sources and limits

- https://open-meteo.com/en/docs/historical-weather-api : ERA5 reanalysis, hourly variables,0.25°, five-day lag, rain preceding-hour semantics.
- https://open-meteo.com/en/terms : free use is noncommercial. This route is for the noncommercial prototype, not commercial launch. Per-worker process-local6/hour limit and provider cache do not guarantee global quotas on multi-instance hosting.
- https://www.labour.gov.in/static/uploads/2026/01/6822c50fd310c60d9eb14f59ee4d9b2b.pdf : Ministry FAQ2, registration does not automatically grant benefits; scheme-specific conditions apply.
- https://taxguru.in/corporate-law/draft-code-social-security-central-rules-2025.html : draft reproduction, not proof of final notification.
- https://www.thehindu.com/news/national/labour-ministry-proposes-90-day-annual-work-threshold-for-gig-worker-social-security/article70470596.ece : reporting on proposed90/120 last-financial-year thresholds, not lifetime counts.

Analytics parameter-only simulation is retired and routes users to journey. Unused legacy pricing source is retained for later cleanup, not used by registration/current quote. Analytics/ML summary audit is Stage6, not certified here.
