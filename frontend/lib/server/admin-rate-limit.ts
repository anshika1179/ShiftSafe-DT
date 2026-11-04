import { createHmac } from "node:crypto";
import { getDb } from "@/backend/models/db";
import { getAdminSessionSecret } from "./env";
import type { RateLimitResult } from "./rate-limit";

const WINDOW_MS = 15 * 60 * 1000;
export const ADMIN_IP_ATTEMPTS = 8;
export const ADMIN_TOTAL_ATTEMPTS = 32;

export async function consumeAdminLoginLimit(ip: string): Promise<RateLimitResult> {
  const db = getDb();
  const now = Date.now();
  // No raw IPs or submitted email addresses are stored. The shared bucket bounds
  // distributed or spoofed-IP attempts against this single-administrator app.
  const ipKey = createHmac("sha256", getAdminSessionSecret()).update(`admin-ip:${ip}`).digest("hex");
  await db.prepare("DELETE FROM admin_login_limits WHERE reset_at <= ?").run(now);
  async function consume(key: string, limit: number): Promise<RateLimitResult> {
    const row = await db.prepare(`INSERT INTO admin_login_limits (key, attempts, reset_at)
      VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET
      attempts = CASE WHEN admin_login_limits.reset_at <= ? THEN 1
        WHEN admin_login_limits.attempts < ? THEN admin_login_limits.attempts + 1
        ELSE admin_login_limits.attempts END,
      reset_at = CASE WHEN admin_login_limits.reset_at <= ? THEN excluded.reset_at
        ELSE admin_login_limits.reset_at END
      RETURNING attempts, reset_at`).get(key, now + WINDOW_MS, now, limit + 1, now);
    if (!row) throw new Error("Admin rate limit did not persist");
    const attempts = Number(row.attempts), resetAt = Number(row.reset_at);
    if (!Number.isFinite(attempts) || !Number.isFinite(resetAt)) throw new Error("Invalid admin rate limit state");
    return { allowed: attempts <= limit, remaining: Math.max(0, limit - attempts), resetAt };
  }
  const shared = await consume("admin-global", ADMIN_TOTAL_ATTEMPTS);
  if (!shared.allowed) return shared;
  const client = await consume(`ip:${ipKey}`, ADMIN_IP_ATTEMPTS);
  return client.allowed ? { ...client, remaining: Math.min(client.remaining, shared.remaining) } : client;
}
