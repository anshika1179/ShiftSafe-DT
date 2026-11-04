import { createHash, randomUUID } from "node:crypto";
import { getDb } from "@/backend/models/db";
import { isValidIndianPhoneNumber, normalizePhone } from "./otp";

export const phoneProofHash = (value: string) => createHash("sha256").update(value).digest("hex");
export class PhoneVerificationError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}
function trialConfig(phone: string) {
  const account = process.env.TWILIO_ACCOUNT_SID || "";
  const token = process.env.TWILIO_AUTH_TOKEN || "";
  const service = process.env.TWILIO_VERIFY_SERVICE_SID || "";
  const expiry = Date.parse(process.env.PHONE_TRIAL_EXPIRES_AT || "");
  const budget = Number(process.env.PHONE_TRIAL_SEND_LIMIT || "");
  const allowed = (process.env.PHONE_TRIAL_ALLOWED_NUMBERS || "").split(",").map(normalizePhone).filter(Boolean);
  if (process.env.PHONE_VERIFICATION_MODE !== "twilio_trial" || !/^AC[0-9a-f]{32}$/i.test(account) || !token || !/^VA[0-9a-f]{32}$/i.test(service) || !Number.isFinite(expiry) || !Number.isInteger(budget) || budget < 1 || budget > 100 || allowed.length < 1 || allowed.length > 5 || allowed.some(p => !isValidIndianPhoneNumber(p))) throw new PhoneVerificationError("Phone trial verification is not configured. No SMS was sent.");
  if (Date.now() >= expiry) throw new PhoneVerificationError("Phone trial verification has expired. No SMS was sent.");
  if (!isValidIndianPhoneNumber(phone) || !allowed.includes(phone)) throw new PhoneVerificationError("Phone verification is in trial and this number is not an approved tester. Continue with Google registration without SMS verification.", 403);
  return { account, token, service, budget };
}
async function provider(path: string, phone: string, fields: Record<string, string>) {
  const config = trialConfig(phone);
  let response: Response;
  try {
    response = await fetch(`https://verify.twilio.com/v2/Services/${config.service}/${path}`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${config.account}:${config.token}`).toString("base64")}` },
      body: new URLSearchParams({ To: `+91${phone}`, ...fields }), signal: AbortSignal.timeout(10000), redirect: "error",
    });
  } catch { throw new PhoneVerificationError("Phone verification provider is unavailable. Do not assume an SMS was delivered."); }
  if (!response.ok) throw new PhoneVerificationError(response.status === 429 ? "Phone trial verification is rate limited. Try later." : "Phone trial verification failed. Check the trial limits and approved tester number.", response.status === 429 ? 429 : 503);
  try { return await response.json() as { status?: string; to?: string; channel?: string }; }
  catch { throw new PhoneVerificationError("Phone verification provider returned an invalid result."); }
}
export async function startPhoneVerification(ownerKey: string, rawPhone: unknown) {
  const phone = normalizePhone(rawPhone);
  const config = trialConfig(phone);
  const db = getDb();
  const quotaKey = phoneProofHash(`${config.account}:${config.service}`);
  await db.prepare("INSERT INTO phone_trial_usage (id) VALUES (?) ON CONFLICT DO NOTHING").run(quotaKey);
  // One durable row serializes the budget across instances. Failed or uncertain sends also count.
  const reserved = await db.prepare("UPDATE phone_trial_usage SET sends = sends + 1, last_send_at = ? WHERE id = ? AND sends < ? AND last_send_at < ?").run(Date.now(), quotaKey, config.budget, Date.now() - 60000);
  if (reserved.changes !== 1) throw new PhoneVerificationError("Trial send limit or 60-second cooldown reached. Try later or ask the owner.", 429);
  const result = await provider("Verifications", phone, { Channel: "sms" });
  if (result.status !== "pending" || result.to !== `+91${phone}` || result.channel !== "sms") throw new PhoneVerificationError("Provider did not accept the requested phone verification.");
  const challenge = randomUUID();
  await db.prepare("INSERT INTO phone_verification_challenges (id, owner_key, phone, expires_at) VALUES (?, ?, ?, ?)").run(phoneProofHash(challenge), ownerKey, phone, Date.now() + 10 * 60 * 1000);
  return { challenge, mode: "twilio_trial", message: "Trial SMS verification requested. Delivery is not guaranteed. Enter the code you receive." };
}
export async function checkPhoneVerification(ownerKey: string, challenge: string, rawPhone: unknown, code: string) {
  const phone = normalizePhone(rawPhone);
  trialConfig(phone);
  if (!/^\d{6}$/.test(code)) throw new PhoneVerificationError("Enter the 6-digit SMS code.", 400);
  const db = getDb();
  const id = phoneProofHash(challenge);
  const allowed = await db.prepare("UPDATE phone_verification_challenges SET attempts = attempts + 1 WHERE id = ? AND owner_key = ? AND phone = ? AND expires_at > ? AND consumed = 0 AND attempts < 5").run(id, ownerKey, phone, Date.now());
  if (allowed.changes !== 1) throw new PhoneVerificationError("Verification expired, used or attempt limit reached. Request a new code.", 401);
  const result = await provider("VerificationCheck", phone, { Code: code });
  if (result.status !== "approved" || result.to !== `+91${phone}`) throw new PhoneVerificationError("Incorrect or expired SMS code.", 401);
  const used = await db.prepare("UPDATE phone_verification_challenges SET consumed = 1 WHERE id = ? AND consumed = 0 AND owner_key = ? AND expires_at > ?").run(id, ownerKey, Date.now());
  if (used.changes !== 1) throw new PhoneVerificationError("Verification already used or expired.", 401);
  const proof = randomUUID();
  await db.prepare("INSERT INTO contact_phone_proofs (id, owner_key, phone, expires_at) VALUES (?, ?, ?, ?)").run(phoneProofHash(proof), ownerKey, phone, Date.now() + 10 * 60 * 1000);
  return { phoneProof: proof, phoneVerified: true, mode: "twilio_trial" };
}
export async function consumeContactPhoneProof(ownerKey: string, phone: string, proof: string) {
  const used = await getDb().prepare("UPDATE contact_phone_proofs SET consumed = 1 WHERE id = ? AND owner_key = ? AND phone = ? AND expires_at > ? AND consumed = 0").run(phoneProofHash(proof), ownerKey, phone, Date.now());
  return used.changes === 1;
}
