# Email-link-only onboarding

New Google users confirm the same Google email and a contact phone, then open a link delivered to that mailbox to unlock Work Profile. Google sign-in, an existing email_verified flag, or client-side state cannot authorize registration. Existing registered workers can sign in normally.

## Firebase setup

Keep Spark and the deployment domain in Authentication > Settings > Authorized domains. No custom Action URL template change is required. The built-in Firebase handler stays in place. The app requests VERIFY_EMAIL with a per-request continueUrl to `/auth/email`, carrying an email-only nonce in its URL fragment, and canHandleCodeInApp=false. Normally Firebase applies its code and offers Continue back to the app; the person then explicitly confirms the emailed nonce to open Work Profile.

Production console check on October 5, 2026 found shift-safe-dt.vercel.app already authorized. Saving a custom template Action URL was rejected with "An error occurred updating action URL". Do not upgrade billing or repeatedly retry to work around it.

Keep NEXT_PUBLIC_FIREBASE_API_KEY and FIREBASE_PROJECT_ID on the same project as Google sign-in. Test real new-user Google sign-in, received email, hosted handler, Continue (including fragment preservation), nonce confirmation and registration before calling production delivery verified. The emulator proves request/link mechanics, not production delivery or hosted UI behavior.

## What the gate proves

This fallback proves possession of the fresh emailed bearer link. It does NOT independently prove successful Firebase OOB redemption. Someone who possesses the emailed link can extract its continueUrl and open it without using Firebase's hosted handler. That person still needs the secret available only in the email. Never treat an untrusted redirect claim, email_verified or Google login alone as fresh inbox proof.

The previous server-consumed-OOB-code implementation is replaced, not claimed equivalent. Old pending UUID challenges cannot redeem through the new endpoint. Firebase's custom Action URL is shared across all email templates; leaving it at default also leaves other templates on Firebase's handler. The project currently enables Google only.

## Security and expiry

A 256-bit random bearer binds the exact Firebase subject, email, name and contact phone, expires in 30 minutes and is single-use. Only its SHA-256 hash is stored. The send API NEVER returns the bearer or continueUrl to the requesting browser. Do not log tokens, bearers, full outgoing Firebase request bodies, or email links. A fragment keeps the bearer out of HTTP request URLs/access logs. The app reads and immediately removes the fragment from browser history, does not store it, and does not redeem on GET, preview or mount. Confirmation uses a same-origin POST. The page has no-referrer and no-store headers.

Only a successfully accepted send becomes email-link-pending. Failed/uncertain sends stay unusable and still consume budget. Atomic reservation prevents concurrent redemption; database errors fail closed rather than releasing a reserved bearer. A one-use registration grant lasts 60 minutes, is bound to the stored identity, and can hand off on another device. sessionStorage holds that grant for refresh recovery and clears it after registration. Closing the session or an expired/failed link requires requesting a new link, never bypassing the gate.

The app caps sends at 100/day total, 5/account/day and a 60-second per-account cooldown, using UTC days. Firebase's documented Spark address-verification limit at implementation is 1,000/day, not a forever guarantee. VERIFY_EMAIL is not EMAIL_SIGNIN. Do not raise caps or billing without owner approval.

Inbox access does not establish unique-human identity, delivery work, insurance KYC or payout ownership. Optional trial phone verification remains separate. Payments, active cover and payouts remain disabled.

Sources:
- https://firebase.google.com/docs/auth/web/passing-state-in-email-actions
- https://cloud.google.com/identity-platform/docs/reference/rest/v1/accounts/sendOobCode
- https://firebase.google.com/docs/auth/custom-email-handler
- https://firebase.google.com/docs/auth/limits
