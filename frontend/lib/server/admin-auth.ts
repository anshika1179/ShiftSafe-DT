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

export function verifyAdminCredentials(
  email: string,
  password: string,
): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  const emailOk = safeEqual(normalizedEmail, getAdminEmail());
  const hashOk = safeEqual(sha256(password), getAdminPasswordHash());
  return emailOk && hashOk;
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

    if (!email || !Number.isFinite(expiresAt) || !nonce) return false;
    if (Date.now() > expiresAt) return false;

    return true;
  } catch {
    return false;
  }
}
