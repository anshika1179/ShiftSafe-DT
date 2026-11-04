# Stage5 no-money sandbox

/sandbox is an authenticated separate simulation area. Existing policies, claims, trigger_events, premium_payments and settlements are not changed. No real insurance status, UPI/bank reference, payment collection or transfer is created. The browser explicitly confirms that premium is simulated.

Server uses a current persisted versioned historical quote bound to saved profile. It derives price, limit and a seven-day window. Same quote replays create one deterministic policy; a different quote cannot open overlapping cover. Worker-row transaction lock plus exact snapshot/profile guards serialize activation. Profile changes block further event assessment against old profiles.

Events and claims are inserted in one transaction. Unique deterministic keys prevent duplicate claims per policy/source/peril/time. All fetched city-center Open-Meteo crossings remain rule review with zero eligible amount: precise work zone, platform activity and measured income loss are unverified. No client GPS alone can prove spoof resistance. Missing evidence is review, not fraud/no fraud. There is no trained anomaly model without suitable samples. Rain must be a complete preceding hour within schedule/window; temperature must be fresh, in-schedule and in-window. Provider failure creates no fabricated event. AQI/outage/curfew claims are excluded because the quote covers only rain/heat.

Manual scenarios are separately stamped USER-SELECTED SYNTHETIC SCENARIO, NOT OBSERVED WEATHER. Server chooses a scheduled hour in the sandbox window, which can be future-dated only for these synthetic scenarios. Missing-evidence scenario cannot settle. Complete-fixture scenario demonstrates receipt handling, not approval of a real loss. Review cannot be bypassed with a client status/amount.

Receipt creation first updates/locks the parent policy, then inserts a unique receipt with remaining weekly limit, then updates claim status, in one transaction. A retry returns the same receipt, concurrent claims cannot exceed the shared cap, partial failure rolls back. Receipts say SIMULATED - NO MONEY TRANSFERRED, carry sandbox IDs only and never fake external payment references.

## Acceptance and limits

54 project tests: auth/origin/worker isolation, quote guards, concurrent replay, duplicate events, missing evidence, in-window model event review, out-of-window readings, provider outage, cross-worker receipts, concurrent cap, partial receipt failure/rollback/retry, profile changes, old quote and overlap prevention. Mobile390px/desktop1280px actual ERA5 quote → simulated premium/policy → missing-evidence review → complete synthetic fixture → receipt → reload persisted; pixels inspected and no browser errors/horizontal overflow. Dedicated local fixture ledger only. Additional isolated PostgreSQL-engine (PGlite) test exercised actual SQL via the Neon adapter; not a hosted-Neon concurrency test.

No recurring event sweep, scheduler, alerts or automatic external monitoring enabled. User clicks a model check; claims are derived server-side on that check. Evidence ingestion, trusted precise zones, platform income verification, live payouts, legal/insurer approval and global quotas remain unavailable. Full analytics/ML truthfulness is Stage6. Free provider terms remain noncommercial prototype only.
