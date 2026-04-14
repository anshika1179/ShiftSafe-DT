import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { getWorkerSessionSecret } from "@/lib/server/env";

export const WORKER_SESSION_COOKIE = "shiftsafe_worker_session";

export interface WorkerSessionPayload {
  workerId: string;
  phone: string;
  expiresAt: number;
  nonce: string;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftHash = Buffer.from(sha256(left));
  const rightHash = Buffer.from(sha256(right));
  return timingSafeEqual(leftHash, rightHash);
}

function sign(input: string): string {
  return createHmac("sha256", getWorkerSessionSecret())
    .update(input)
    .digest("hex");
}

export function createWorkerSessionToken(
  workerId: string,
  phone: string,
  expiresInSeconds: number = 7 * 24 * 60 * 60,
): string {
  const expiresAt = Date.now() + expiresInSeconds * 1000;
  const nonce = randomBytes(16).toString("hex");
  const payloadJson = JSON.stringify({
    workerId,
    phone,
    expiresAt,
    nonce,
  });
  const payload = Buffer.from(payloadJson).toString("base64url");
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

export function parseWorkerSessionToken(
  token: string,
): WorkerSessionPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;

    const payload = parts[0] || "";
    const signature = parts[1] || "";
    if (!payload || !signature) return null;

    const expected = sign(payload);
    if (!safeEqual(signature, expected)) return null;

    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    const session = JSON.parse(decoded) as Partial<WorkerSessionPayload>;

    const workerId = String(session.workerId || "").trim();
    const phone = String(session.phone || "").replace(/\D/g, "");
    const expiresAt = Number(session.expiresAt);
    const nonce = String(session.nonce || "").trim();

    if (!workerId || !nonce || phone.length !== 10) return null;
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;

    return { workerId, phone, expiresAt, nonce };
  } catch {
    return null;
  }
}
