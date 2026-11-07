import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { NextRequest } from "next/server";
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
process.env.SQLITE_DB_PATH = join(mkdtempSync(join(tmpdir(), "admin-security-")), "db.sqlite");
process.env.SEED_DEMO_DATA = "false";
process.env.ADMIN_EMAIL = "security-fixture@test.invalid";
process.env.ADMIN_SESSION_SECRET = "isolated-admin-security-session-secret-only";
const password = "local-fixture-password-only";
const legacy = createHash("sha256").update(password).digest("hex");
process.env.ADMIN_PASSWORD_HASH = legacy;
delete process.env.ADMIN_DEV_PASSWORD;

test("admin credential migration and durable login limits", async (t) => {
  const { getDb } = await import("../backend/src/models/db");
  const auth = await import("../frontend/lib/server/admin-auth");
  const crypto = await import("../frontend/lib/server/admin-password");
  const limits = await import("../frontend/lib/server/admin-rate-limit");
  const login = await import("../frontend/app/api/admin/login/route");
  const env = await import("../frontend/lib/server/env");
  const db = getDb();
  const clearLimits = () => db.prepare("DELETE FROM admin_login_limits").run();
  const request = (body: unknown, ip = "local-test-client") => new NextRequest("http://localhost/api/admin/login", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });
  await t.test("wrong email/password never migrate", async () => {
    assert.equal(await auth.verifyAdminCredentials(process.env.ADMIN_EMAIL!, "wrong"), false);
    assert.equal(await auth.verifyAdminCredentials("other@test.invalid", password), false);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM admin_credentials").get()).n, 0);
  });
  await t.test("first successful legacy login atomically persists salted scrypt without a reset", async () => {
    const results = await Promise.all([auth.verifyAdminCredentials(process.env.ADMIN_EMAIL!, password), auth.verifyAdminCredentials(process.env.ADMIN_EMAIL!, password)]);
    assert.deepEqual(results, [true, true]);
    const row = await db.prepare("SELECT * FROM admin_credentials").get();
    assert.ok(crypto.isScryptPasswordHash(row.password_hash));
    assert.notEqual(row.config_id, legacy);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM admin_credentials").get()).n, 1);
    assert.equal(await auth.verifyAdminCredentials(process.env.ADMIN_EMAIL!.toUpperCase(), password), true);
    assert.equal(await auth.verifyAdminCredentials(process.env.ADMIN_EMAIL!, "wrong"), false);
  });
  await t.test("matching migrated record cannot fall back to the fast legacy verifier", async () => {
    const row = await db.prepare("SELECT * FROM admin_credentials").get();
    await db.prepare("UPDATE admin_credentials SET password_hash = ?").run(await crypto.hashAdminPassword("different-fixture-password"));
    assert.equal(await auth.verifyAdminCredentials(process.env.ADMIN_EMAIL!, password), false);
    await db.prepare("UPDATE admin_credentials SET password_hash = 'corrupt'").run();
    await assert.rejects(auth.verifyAdminCredentials(process.env.ADMIN_EMAIL!, password), /Invalid stored/);
    await db.prepare("UPDATE admin_credentials SET password_hash = ?").run(row.password_hash);
  });
  await t.test("intentional environment credential rotation replaces the prior migration", async () => {
    const rotated = "rotated-fixture-password";
    process.env.ADMIN_PASSWORD_HASH = createHash("sha256").update(rotated).digest("hex");
    assert.equal(await auth.verifyAdminCredentials(process.env.ADMIN_EMAIL!, password), false);
    assert.equal(await auth.verifyAdminCredentials(process.env.ADMIN_EMAIL!, rotated), true);
    assert.equal(await auth.verifyAdminCredentials(process.env.ADMIN_EMAIL!, password), false);
    process.env.ADMIN_PASSWORD_HASH = legacy;
    assert.equal(await auth.verifyAdminCredentials(process.env.ADMIN_EMAIL!, password), true);
  });
  await t.test("native scrypt config works and salts are unique", async () => {
    const first = await crypto.hashAdminPassword(password), second = await crypto.hashAdminPassword(password);
    assert.notEqual(first, second);
    process.env.ADMIN_PASSWORD_HASH = first;
    assert.equal(env.getAdminPasswordHash(), first);
    assert.equal(await auth.verifyAdminCredentials(process.env.ADMIN_EMAIL!, password), true);
    assert.equal(await auth.verifyAdminCredentials(process.env.ADMIN_EMAIL!, "wrong"), false);
    assert.equal(await auth.verifyAdminCredentials("other@test.invalid", password), false);
    process.env.ADMIN_PASSWORD_HASH = legacy;
  });
  await t.test("malformed and excessive-cost config fails closed, even with a dev password", async () => {
    process.env.ADMIN_DEV_PASSWORD = password;
    for (const invalid of ["garbage", "scrypt$99999999$8$3$" + "a".repeat(32) + "$" + "b".repeat(64)]) {
      process.env.ADMIN_PASSWORD_HASH = invalid;
      assert.throws(env.getAdminPasswordHash, /invalid format/);
    }
    process.env.ADMIN_PASSWORD_HASH = legacy;
    delete process.env.ADMIN_DEV_PASSWORD;
  });
  await t.test("concurrent attempts use atomic DB counters, not runtime-local memory", async () => {
    await clearLimits();
    const results = await Promise.all(Array.from({ length: 16 }, () => limits.consumeAdminLoginLimit("parallel-fixture")));
    assert.equal(results.filter((r) => r.allowed).length, limits.ADMIN_IP_ATTEMPTS);
    const rows = await db.prepare("SELECT * FROM admin_login_limits").all();
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => !r.key.includes("parallel-fixture")));
    assert.equal((await limits.consumeAdminLoginLimit("parallel-fixture")).allowed, false);
    await db.prepare("UPDATE admin_login_limits SET reset_at = ?").run(Date.now() - 1);
    assert.equal((await limits.consumeAdminLoginLimit("parallel-fixture")).allowed, true);
    assert.equal((await db.prepare("SELECT attempts FROM admin_login_limits WHERE key = 'admin-global'").get()).attempts, 1);
  });
  await t.test("new Node processes share stored migration and login limits", async () => {
    await clearLimits();
    for (let i = 0; i < 8; i++) await limits.consumeAdminLoginLimit("restart-fixture");
    async function child(mode: string) {
      return new Promise<string>((resolve, reject) => {
        const childEnv = { ...process.env };
        delete childEnv.NODE_TEST_CONTEXT;
        const proc = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "--tsconfig", "frontend/tsconfig.json", "tests/fixtures/admin-security-child.ts", mode], { env: childEnv, cwd: process.cwd() });
        let output = "", errors = "";
        proc.stdout.on("data", (chunk) => { output += chunk; });
        proc.stderr.on("data", (chunk) => { errors += chunk; });
        const timeout = setTimeout(() => { proc.kill("SIGKILL"); reject(new Error("Child process exceeded 10 seconds")); }, 10000);
        proc.on("error", (error) => { clearTimeout(timeout); reject(error); });
        proc.on("exit", (code) => { clearTimeout(timeout); return code === 0 ? resolve(output.trim()) : reject(new Error(errors)); });
      });
    }
    assert.equal(await child("limit"), "false");
    assert.equal(await child("credential"), "true");
  });
  await t.test("shared cap prevents rotating IPs bypassing slow-hash work limits", async () => {
    await clearLimits();
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => limits.consumeAdminLoginLimit(`rotating-fixture-${i}`)));
    assert.equal(results.filter((r) => r.allowed).length, limits.ADMIN_TOTAL_ATTEMPTS);
    assert.equal((await limits.consumeAdminLoginLimit("new-fixture")).allowed, false);
  });
  await t.test("route preserves login, cookie, session and retry response", async () => {
    await clearLimits();
    assert.equal((await login.POST(request({ email: process.env.ADMIN_EMAIL, password: "wrong" }))).status, 401);
    const success = await login.POST(request({ email: process.env.ADMIN_EMAIL, password }));
    assert.equal(success.status, 200);
    assert.equal(success.headers.get("cache-control"), "no-store");
    assert.match(success.headers.get("set-cookie")!, /HttpOnly/);
    for (let i = 0; i < 6; i++) assert.equal((await login.POST(request({ email: process.env.ADMIN_EMAIL, password: "wrong" }))).status, 401);
    const blocked = await login.POST(request({ email: process.env.ADMIN_EMAIL, password }));
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    assert.equal(blocked.headers.get("cache-control"), "no-store");
    assert.equal(auth.verifyAdminSessionToken(auth.createAdminSessionToken(process.env.ADMIN_EMAIL!)), true);
  });
  await t.test("input size/type validation bounds hashing and returns no cookie", async () => {
    await clearLimits();
    for (const body of [null, { email: {}, password }, { email: process.env.ADMIN_EMAIL, password: 12 }, { email: process.env.ADMIN_EMAIL, password: "x".repeat(1025) }, { email: "x".repeat(255), password }]) {
      const result = await login.POST(request(body));
      assert.equal(result.status, 400);
      assert.equal(result.headers.get("set-cookie"), null);
    }
  });
  await t.test("missing/corrupt database tables fail closed, never falling back to memory or SHA", async () => {
    await clearLimits();
    await db.exec("DROP TABLE admin_credentials");
    const migrationFailure = await login.POST(request({ email: process.env.ADMIN_EMAIL, password }));
    assert.equal(migrationFailure.status, 503);
    assert.equal(migrationFailure.headers.get("set-cookie"), null);
    await db.exec("DROP TABLE admin_login_limits");
    const limitFailure = await login.POST(request({ email: process.env.ADMIN_EMAIL, password }));
    assert.equal(limitFailure.status, 503);
    assert.equal(limitFailure.headers.get("set-cookie"), null);
  });
});
