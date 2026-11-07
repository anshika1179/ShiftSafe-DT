# Optional contact phone verification demo

Google is the account owner and sign-in route in this draft. SMS verifies a contact number; it does not link or merge accounts, prove delivery work, perform Aadhaar/insurance KYC, or activate coverage. No production fixed-code fallback exists. Existing /api/auth/otp local fixtures remain development-only and are not this flow.

## Twilio trial

Official terms checked October 5, 2026: no card, 30-day expiry, 100 shared SMS units, 40 approved verification checks, max five pre-verified recipients, signup-country restriction. This is a tester demo, not public worker onboarding. Trial API service SID comes from the Try out Verify page; do not upgrade or create a paid service. SMS requests consume quota even when delivery is uncertain. Sources: https://www.twilio.com/docs/usage/trials and https://www.twilio.com/docs/usage/trials/try-out-verify

## Server configuration

No variable uses NEXT_PUBLIC. Set only for approved deployment:

- PHONE_VERIFICATION_MODE=twilio_trial
- TWILIO_ACCOUNT_SID
- TWILIO_AUTH_TOKEN (private secret)
- TWILIO_VERIFY_SERVICE_SID (actual trial service)
- PHONE_TRIAL_EXPIRES_AT (app cutoff ISO timestamp no later than the confirmed trial window)
- PHONE_TRIAL_ALLOWED_NUMBERS (comma-separated Indian ten-digit numbers actually pre-verified in Twilio, max five)
- PHONE_TRIAL_SEND_LIMIT (integer 1-100, not greater than remaining shared SMS units; conservatively account for console testing)

No provider call without complete configuration, unexpired trial, valid Indian phone and allowlist membership. The budget counts attempts conservatively and is durable across instances, with a global 60-second cooldown. Provider failure or uncertain timeout never refunds quota automatically. Raising the configured cap does not erase existing counted sends. Twilio enforces its own remaining units/check limit too. App quota cannot see unrelated console or other-app sends; keep this service/account dedicated and cap below live remaining units.

## Ownership and proof

Request/check requires same-origin plus an unconsumed Google onboarding proof or an authorized worker session. The ten-minute challenge binds owner and phone, allows five checks and is single use. Twilio must return approved for the exact phone; a hashed, expiring phone proof is consumed once when registering the same Google owner/phone. Changing the input invalidates UI verification. An authenticated worker's verified contact is updated without changing their login identity. No lookup-by-phone account linking. Signed-in API exists; an in-profile UI remains a later enhancement.

UI labels trial limitations and keeps ordinary Google registration available for random users and after trial expiry. No fake verified badge appears on provider error. KYC, platform eligibility and payout status remain separate/unverified. Existing Google/Spark limits apply, not unlimited or guaranteed forever.

Tests use mocked provider and isolated SQLite only, never SMS or hosted records. Live provider delivery/Verify check requires account setup and an owner-approved tester run before completion is claimed.

## Configured trial

New trial account confirmed active October 5, 2026. Only the owner-approved signup number is allowlisted. The app send budget is 20, below the 100 unused shared SMS units observed at setup. The app cutoff is 2026-11-03T04:23:42Z, 29 days after API-confirmed account creation, one day earlier than the 30-day trial window. Console exposed days remaining only; this is a conservative app cutoff, not an asserted exact provider expiry. The built-in Try It Out Verify Service was read back successfully with six-digit codes. Seven Production variables were saved as Secret; a deployment and real tester send/check remain pending review. No SMS delivery was tested during config.
