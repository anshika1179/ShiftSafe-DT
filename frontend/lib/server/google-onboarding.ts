import { randomUUID, createHash } from "node:crypto";
import { getDb } from "@/backend/models/db";
import { type GoogleIdentity } from "./google-auth";
import { createWorkerSessionToken } from "./worker-auth";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export async function finishGoogleSignIn(identity: GoogleIdentity) {
  const db = getDb();
  const worker = await db.prepare("SELECT w.id, w.phone, w.is_active FROM worker_identities i JOIN workers w ON w.id = i.worker_id WHERE i.provider = ? AND i.subject = ?").get("google", identity.subject) as { id: string; phone: string | null; is_active: number } | undefined;
  if (worker) {
    if (!worker.is_active) throw new Error("This account is inactive");
    return { registered: true as const, token: createWorkerSessionToken(worker.id, worker.phone || "", undefined, identity.subject) };
  }
  await db.prepare("DELETE FROM google_registration_proofs WHERE expires_at < ?").run(Date.now() - 24 * 60 * 60 * 1000);
  const proof = randomUUID();
  await db.prepare("INSERT INTO google_registration_proofs (id, subject, email, expires_at) VALUES (?, ?, ?, ?)").run(hash(proof), identity.subject, identity.email, Date.now() + 10 * 60 * 1000);
  return { registered: false as const, registrationProof: proof, name: identity.name, email: identity.email };
}
export async function consumeGoogleProof(proof: string) {
  const db = getDb();
  const id = hash(proof);
  const row = await db.prepare("SELECT subject, email FROM google_registration_proofs WHERE id = ? AND consumed = 0 AND expires_at > ? AND email_link_verified = 1").get(id, Date.now()) as { subject: string; email: string } | undefined;
  if (!row) return null;
  const updated = await db.prepare("UPDATE google_registration_proofs SET consumed = 1 WHERE id = ? AND consumed = 0 AND expires_at > ? AND email_link_verified = 1").run(id, Date.now());
  return updated.changes === 1 ? row : null;
}
