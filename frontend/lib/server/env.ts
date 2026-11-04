import { createHash } from "node:crypto";
import { isScryptPasswordHash } from "./admin-password";

export const isProduction = process.env.NODE_ENV === "production";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function secret(name: string): string {
  const value = required(name);
  if (value.length < 32 || /replace_with|your_secret|shiftsafe-demo/i.test(value)) {
    throw new Error(`${name} must be a unique secret of at least 32 characters`);
  }
  return value;
}

export function getCronSecret(): string { return secret("CRON_SECRET"); }
export function getAdminEmail(): string { return required("ADMIN_EMAIL").toLowerCase(); }
export function getAdminPasswordHash(): string {
  const hash = process.env.ADMIN_PASSWORD_HASH?.trim();
  if (hash) {
    if (isScryptPasswordHash(hash)) return hash;
    if (/^[a-f0-9]{64}$/i.test(hash)) return hash.toLowerCase();
    throw new Error("ADMIN_PASSWORD_HASH has an invalid format");
  }
  if (!isProduction && process.env.ADMIN_DEV_PASSWORD?.trim()) {
    return createHash("sha256").update(process.env.ADMIN_DEV_PASSWORD).digest("hex");
  }
  throw new Error("ADMIN_PASSWORD_HASH is not configured");
}
export function getAdminSessionSecret(): string { return secret("ADMIN_SESSION_SECRET"); }
export function getWorkerSessionSecret(): string { return secret("WORKER_SESSION_SECRET"); }
