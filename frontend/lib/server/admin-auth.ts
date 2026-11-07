import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  getAdminEmail,
  getAdminPasswordHash,
  getAdminSessionSecret,
} from "@/lib/server/env";

import { getDb } from "@/backend/models/db";
import { hashAdminPassword, isScryptPasswordHash, verifyScryptPassword } from "./admin-password";

export const ADMIN_SESSION_COOKIE = "shiftsafe_admin_session";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftHash = Buffer.from(sha256(left));
  const rightHash = Buffer.from(sha256(right));
  return timingSafeEqual(leftHash, rightHash);
}

function sign(input: string): string {
  return createHmac("sha256", getAdminSessionSecret())
    .update(input)
    .digest("hex");
}

export async function verifyAdminCredentials(
  email: string,
  password: string,
): Promise<boolean> {
  const configuredEmail = getAdminEmail();
  const configuredHash = getAdminPasswordHash();
  const emailOk = safeEqual(email.trim().toLowerCase(), configuredEmail);
  if (isScryptPasswordHash(configuredHash)) {
    const passwordOk = await verifyScryptPassword(password, configuredHash);
    return emailOk && passwordOk;
  }

  // A configuration-bound record permits intentional credential rotation without
  // keeping the fast legacy verifier active after migration. Never log either hash.
  const configId = createHmac("sha256", getAdminSessionSecret())
    .update(`admin-credential:${configuredEmail}:${configuredHash}`).digest("hex");
  const db = getDb();
  const stored = await db.prepare("SELECT config_id, password_hash FROM admin_credentials WHERE email = ?").get(configuredEmail);
  if (stored && safeEqual(stored.config_id, configId)) {
    const passwordOk = await verifyScryptPassword(password, stored.password_hash);
    return emailOk && passwordOk;
  }
  if (!emailOk || !safeEqual(sha256(password), configuredHash)) return false;

  const upgraded = await hashAdminPassword(password);
  // First successful login wins. Concurrent successful migrations cannot replace
  // one another; a changed configuration replaces only the previous config row.
  await db.prepare(`INSERT INTO admin_credentials (email, config_id, password_hash)
    VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET
      config_id = excluded.config_id, password_hash = excluded.password_hash,
      migrated_at = CURRENT_TIMESTAMP
    WHERE admin_credentials.config_id <> excluded.config_id`)
    .run(configuredEmail, configId, upgraded);
  const committed = await db.prepare("SELECT config_id, password_hash FROM admin_credentials WHERE email = ?").get(configuredEmail);
  if (!committed || !safeEqual(committed.config_id, configId)) throw new Error("Admin credential migration did not persist");
  return verifyScryptPassword(password, committed.password_hash);
}

export function createAdminSessionToken(
  email: string,
  expiresInSeconds: number = 8 * 60 * 60,
): string {
  const expiresAt = Date.now() + expiresInSeconds * 1000;
  const nonce = randomBytes(16).toString("hex");
  const payloadJson = JSON.stringify({
    email: email.toLowerCase(),
    expiresAt,
    nonce,
  });
  const payload = Buffer.from(payloadJson).toString("base64url");
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

export function verifyAdminSessionToken(token: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return false;

    const payload = parts[0] || "";
    const signature = parts[1] || "";
    if (!payload || !signature) return false;

    const expected = sign(payload);
    if (!safeEqual(signature, expected)) return false;

    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    const session = JSON.parse(decoded) as {
      email?: string;
      expiresAt?: number;
      nonce?: string;
    };

    const email = String(session.email || "").toLowerCase();
    const expiresAt = Number(session.expiresAt);
    const nonce = String(session.nonce || "");

    if (!email || email !== getAdminEmail() || !Number.isFinite(expiresAt) || !nonce) return false;
    if (Date.now() > expiresAt) return false;

    return true;
  } catch {
    return false;
  }
}
