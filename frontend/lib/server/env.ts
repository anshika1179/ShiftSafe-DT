import { createHash, randomBytes } from "node:crypto";

export const isProduction = process.env.NODE_ENV === "production";

const devEntropy = randomBytes(24).toString("hex");

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function requireInProduction(name: string): string {
  const value = process.env[name];
  if (value && value.trim()) return value.trim();

  if (isProduction) {
    throw new Error(`${name} is required in production`);
  }

  return "";
}

export function getCronSecret(): string {
  const configured = requireInProduction("CRON_SECRET");
  return configured || `dev-cron-${devEntropy}`;
}

export function getAdminEmail(): string {
  const configured = requireInProduction("ADMIN_EMAIL");
  return (configured || "admin@localhost").toLowerCase();
}

export function getAdminPasswordHash(): string {
  const configured = requireInProduction("ADMIN_PASSWORD_HASH");
  const devPassword = process.env.ADMIN_DEV_PASSWORD || "local-dev-admin";
  return configured || sha256(devPassword);
}

export function getAdminSessionSecret(): string {
  const configured = requireInProduction("ADMIN_SESSION_SECRET");
  return configured || `dev-admin-session-${devEntropy}`;
}

export function getWorkerSessionSecret(): string {
  const configured = process.env.WORKER_SESSION_SECRET?.trim();
  if (configured) return configured;

  const legacySharedSecret = process.env.ADMIN_SESSION_SECRET?.trim();
  if (legacySharedSecret) return legacySharedSecret;

  // As a safety net, derive a deterministic secret from existing protected envs
  // so worker onboarding doesn't hard-fail when WORKER_SESSION_SECRET is missing.
  const derivedSource =
    process.env.ADMIN_PASSWORD_HASH?.trim() || process.env.CRON_SECRET?.trim();
  if (derivedSource) {
    return `derived-worker-session-${sha256(derivedSource).slice(0, 48)}`;
  }

  if (isProduction) {
    console.warn(
      "WORKER_SESSION_SECRET is missing in production; falling back to process-local emergency secret",
    );
  }

  return `dev-worker-session-${devEntropy}`;
}
