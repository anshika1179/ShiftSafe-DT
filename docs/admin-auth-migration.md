# Admin authentication upgrade

No password reset, session-cookie change, worker-auth change, or UI change is required.

## Compatible migration

`ADMIN_PASSWORD_HASH` accepts either the existing 64-character SHA-256 hex bootstrap value or `scrypt$32768$8$3$<16-byte salt hex>$<32-byte key hex>`. Scrypt runs asynchronously with N=32768, r=8, p=3 and a 64 MiB memory ceiling. This is OWASP's 32 MiB profile; each encoded credential has its own random salt. Work factors and lengths are fixed, not taken from untrusted input.

With legacy configuration, the first correct email/password login writes a salted scrypt record to `admin_credentials` and reads it back before issuing a session. Later logins for that configuration use only the stored scrypt verifier. Incorrect credentials cannot create or replace a record. Concurrent successful migrations preserve the first record. A malformed stored record or database failure denies login rather than using SHA-256 or local memory as a fallback.

The record is bound to the configured email/password verifier and session secret through an HMAC identifier. An intentional change to those settings invalidates the old binding and permits a new successful migration. Existing sessions retain their current expiry; changing the session secret still invalidates them. Restarted processes read the same durable record.

**Staged limitation:** deploying the code does not remove the legacy fast hash from Vercel's secret configuration. Until an authorized follow-up replaces that setting with the matching salted verifier, someone who obtains the old configuration can still attack the fast hash offline. The first successful real login must be verified before that cleanup; never delete the setting first or paste either verifier into chat, logs or tickets. The compatible path is not a claim that a weak password has become strong. Rotate to a strong password separately when the owner wants a reset.

## Durable throttle

Login requests consume database counters before credential verification. Each IP bucket permits 8 requests in 15 minutes; the shared app bucket permits 32 in 15 minutes. Both count successful, invalid and failed requests; successes do not clear the counter. A single-statement UPSERT with RETURNING makes admission atomic across instances. Expired buckets are removed on the next login request. IP bucket keys are HMACs, not raw addresses; submitted emails and passwords are never saved in the throttle table.

The shared cap limits distributed attempts and protects scrypt work even if a client supplies spoofed forwarding headers. It also means repeated attacks can temporarily deny the owner login. This is a fixed-window throttle, not bot detection or a guarantee against denial of service. `429` includes `Retry-After`; database/configuration failure returns `503` and no session. Deployment uses the same required production database; no SQLite or process-memory failover in production. All existing same-origin, strict/HttpOnly cookie and session checks remain.

Only additive tables/indexes are created. No workers, tickets or financial records are modified by this upgrade. No new package is required.

## Validation

Regression tests cover wrong credentials, migration races, salted uniqueness, migrated-only verification, corruption, rotation, native scrypt config, cost validation, parallel rate admission, new-process persistence, expiry, shared-IP-rotation cap, bounded inputs, cookie/retry behavior and failed storage. A separate isolated PostgreSQL-engine check validates the exact UPSERT statements' first-wins and expiry behavior; SQLite is also covered. Neither substitutes for post-deployment verification of the real configured account.

Sources:
- https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- https://nodejs.org/api/crypto.html
