import test from "node:test";
import assert from "node:assert/strict";
process.env.NODE_ENV = "production";
process.env.OTP_MODE = "local_test";
process.env.OTP_DEMO_CODE = "123456";
process.env.DATABASE_URL = "";
process.env.SEED_DEMO_DATA = "true";
process.env.ALLOW_SQLITE_FAILOVER = "true";
for (const key of ["ADMIN_EMAIL", "ADMIN_PASSWORD_HASH", "ADMIN_SESSION_SECRET", "WORKER_SESSION_SECRET", "CRON_SECRET"]) delete process.env[key];

test("production cannot use local OTP, missing secrets or SQLite", async () => {
  const { verifyOtpCode } = await import("../frontend/lib/server/otp");
  const env = await import("../frontend/lib/server/env");
  const { getDb } = await import("../backend/src/models/db");
  assert.equal(verifyOtpCode("123456").status, 503);
  for (const getter of [env.getAdminEmail, env.getAdminPasswordHash, env.getAdminSessionSecret, env.getWorkerSessionSecret, env.getCronSecret]) assert.throws(getter, /not configured/);
  process.env.WORKER_SESSION_SECRET = "replace_with_long_random_secret_not_safe";
  assert.throws(env.getWorkerSessionSecret, /unique secret/);
  await assert.rejects(getDb().prepare("SELECT 1").get(), /DATABASE_URL is required/);
});
