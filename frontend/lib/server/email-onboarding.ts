import { createHash, randomUUID, randomBytes } from "node:crypto";
import { getDb } from "@/backend/models/db";
import { type GoogleIdentity } from "./google-auth";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export class EmailOnboardingError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export type FirebaseEmailCall = (action: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;
export const firebaseEmailCall: FirebaseEmailCall = async (action, body) => {
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!key) throw new EmailOnboardingError("Email verification is not configured.", 503);
  let response: Response;
  try {
    response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${action}?key=${encodeURIComponent(key)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000), redirect: "error", cache: "no-store",
    });
  } catch { throw new EmailOnboardingError("Email verification is unavailable. Try again later.", 503); }
  if (!response.ok) throw new EmailOnboardingError(action === "sendOobCode" ? "Firebase could not send the link. Check email setup or try later." : "This email link is invalid, expired or already used. Request a new link.", response.status === 429 ? 429 : 400);
  return await response.json();
};
export async function startEmailOnboarding(identity: GoogleIdentity, token: string, email: string, phone: string, origin: string, call: FirebaseEmailCall = firebaseEmailCall) {
  if (email.trim().toLowerCase() !== identity.email.toLowerCase()) throw new EmailOnboardingError("Enter the email of the Google account you just selected.");
  if (!/^[6-9]\d{9}$/.test(phone)) throw new EmailOnboardingError("Enter a valid Indian contact phone number.");
  const db = getDb();
  const existing = await db.prepare("SELECT worker_id FROM worker_identities WHERE provider = ? AND subject = ?").get("google", identity.subject);
  if (existing) throw new EmailOnboardingError("This Google account already has a profile. Sign in instead.", 409);
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const globalKey = `email:${day}`;
  const ownerKey = `email:${day}:${hash(identity.subject)}`;
  for (const key of [globalKey, ownerKey]) await db.prepare("INSERT INTO email_send_usage (id) VALUES (?) ON CONFLICT DO NOTHING").run(key);
  // Durable app caps sit below Firebase Spark's current quota. Failed/uncertain sends count.
  const owner = await db.prepare("UPDATE email_send_usage SET sends = sends + 1, last_send_at = ? WHERE id = ? AND sends < 5 AND last_send_at < ?").run(now, ownerKey, now - 60000);
  if (owner.changes !== 1) throw new EmailOnboardingError("Wait 60 seconds before resending. Each account can request up to 5 links per UTC day.", 429);
  const global = await db.prepare("UPDATE email_send_usage SET sends = sends + 1, last_send_at = ? WHERE id = ? AND sends < 100").run(now, globalKey);
  if (global.changes !== 1) throw new EmailOnboardingError("Today's app email limit is reached. Try tomorrow.", 429);
  const challenge = randomBytes(32).toString("hex");
  const continueUrl = new URL("/auth/email", origin);
  // Fragment keeps the email-only bearer out of HTTP request URLs and access logs.
  continueUrl.hash = new URLSearchParams({ nonce: challenge }).toString();
  await db.prepare("INSERT INTO email_onboarding_challenges (id, subject, email, name, phone, expires_at, state) VALUES (?, ?, ?, ?, ?, ?, ?)").run(hash(challenge), identity.subject, identity.email, identity.name, phone, now + 30 * 60 * 1000, "sending");
  try {
    const sent = await call("sendOobCode", { requestType: "VERIFY_EMAIL", idToken: token, continueUrl: continueUrl.toString(), canHandleCodeInApp: false });
    if (typeof sent.email !== "string" || sent.email.toLowerCase() !== identity.email.toLowerCase()) throw new EmailOnboardingError("Firebase did not accept the intended email recipient.", 503);
    await db.prepare("UPDATE email_onboarding_challenges SET state = 'email-link-pending' WHERE id = ? AND state = 'sending'").run(hash(challenge));
  } catch (error) {
    await db.prepare("UPDATE email_onboarding_challenges SET state = 'failed' WHERE id = ?").run(hash(challenge));
    throw error;
  }
  return { message: "Link requested. Check your inbox and spam folder. Open the email link to unlock Work Profile. Delivery is not guaranteed." };
}
export async function redeemEmailOnboarding(nonce: string) {
  if (!/^[0-9a-f]{64}$/.test(nonce)) throw new EmailOnboardingError("Invalid email link.");
  const db = getDb();
  const id = hash(nonce);
  // Only possession of the email-only bearer grants progress. Google email_verified
  // and hosted-widget redirect claims are not proof of fresh inbox access.
  const reserved = await db.prepare("UPDATE email_onboarding_challenges SET state = 'checking' WHERE id = ? AND state = 'email-link-pending' AND expires_at > ?").run(id, Date.now());
  if (reserved.changes !== 1) throw new EmailOnboardingError("This onboarding link expired, is already in use or has been used. Sign in and request a new link.", 401);
  try {
    const row = await db.prepare("SELECT subject, email, name, phone FROM email_onboarding_challenges WHERE id = ?").get(id) as { subject: string; email: string; name: string; phone: string };
    const proof = randomUUID();
    const expiresAt = Date.now() + 60 * 60 * 1000;
    await db.batch([
      { query: "UPDATE email_onboarding_challenges SET state = 'used' WHERE id = ? AND state = 'checking'", params: [id] },
      { query: "INSERT INTO google_registration_proofs (id, subject, email, expires_at, email_link_verified) VALUES (?, ?, ?, ?, 1)", params: [hash(proof), row.subject, row.email, expiresAt] },
    ]);
    return { registrationProof: proof, email: row.email, name: row.name, phone: row.phone, expiresAt };
  } catch (error) {
    // Fail closed on a database error. Never release a reserved bearer for reuse.
    await db.prepare("UPDATE email_onboarding_challenges SET state = 'failed' WHERE id = ? AND state = 'checking'").run(id);
    throw error;
  }
}
