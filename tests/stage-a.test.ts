import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
process.env.SQLITE_DB_PATH = join(mkdtempSync(join(tmpdir(), "shiftsafe-stage-a-")), "ledger.db");
process.env.SEED_DEMO_DATA = "false";
process.env.WORKER_SESSION_SECRET = "worker-test-secret-not-for-deployment-1234";
process.env.ADMIN_SESSION_SECRET = "admin-test-secret-not-for-deployment-1234";
process.env.ADMIN_EMAIL = "operator@example.invalid";
process.env.ADMIN_DEV_PASSWORD = "test-password-only";
process.env.CRON_SECRET = "cron-test-secret-not-for-deployment-1234";
process.env.OTP_MODE = "local_test";
process.env.OTP_DEMO_CODE = "654321";

function request(path: string, method = "GET", body?: unknown, cookie?: string) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

// One parent test keeps process-global environment and DB state sequential.
test("Stage A trust boundaries and honest onboarding", async (t) => {
  const { getDb } = await import("../backend/src/models/db");
  const auth = await import("../frontend/lib/server/worker-auth");
  const admin = await import("../frontend/lib/server/admin-auth");
  const register = await import("../frontend/app/api/register/route");
  const otp = await import("../frontend/app/api/auth/otp/verify/route");
  const otpRequest = await import("../frontend/app/api/auth/otp/request/route");
  const session = await import("../frontend/app/api/auth/session/route");
  const claims = await import("../frontend/app/api/claims/route");
  const policies = await import("../frontend/app/api/policies/route");
  const exportClaims = await import("../frontend/app/api/claims/export/route");
  const premium = await import("../frontend/app/api/premium/route");
  const dashboard = await import("../frontend/app/api/dashboard/route");
  const actuarial = await import("../frontend/app/api/actuarial/route");
  const triggers = await import("../frontend/app/api/triggers/route");
  const cron = await import("../frontend/app/api/triggers/cron/route");
  const orders = await import("../frontend/app/api/razorpay/order/route");
  const adminClaims = await import("../frontend/app/api/admin/claims/route");
  const db = getDb();
  const base = { name: "Test Worker", phone: "9000000001", platform: "Zomato", city: "Mumbai", zone: "Andheri East", avgWeeklyIncome: 4200, daysWorkedThisWeek: 6, totalActiveDeliveryDays: 14, daysActiveInLast30: 14, consents: { gpsLocation: true, bankUpi: true, platformActivity: true } };
  async function proof(phone: string) {
    const res = await otp.POST(request("/api/auth/otp/verify", "POST", { phone, otp: "654321" }));
    assert.equal(res.status, 200);
    return (await res.json()).registrationProof as string;
  }
  let workerId = "";
  let cookie = "";
  let eligibleId = "";
  let eligibleCookie = "";
  let policyId = "";
  await t.test("no implicit sample records or shared default OTP", async () => {
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM workers").get()).n, 0);
    assert.equal((await otp.POST(request("/api/auth/otp/verify", "POST", { phone: base.phone, otp: "123456" }))).status, 401);
    const local = await otpRequest.POST(request("/api/auth/otp/request", "POST", { phone: base.phone }));
    assert.match((await local.json()).message, /No SMS was sent/);
  });
  await t.test("food-delivery scope and actual activity fields", async () => {
    assert.equal((await register.POST(request("/api/register", "POST", { ...base, platform: "Blinkit" }))).status, 400);
    assert.equal((await register.POST(request("/api/register", "POST", { ...base, daysWorkedThisWeek: "" }))).status, 400);
    assert.equal((await register.POST(request("/api/register", "POST", { ...base, daysActiveInLast30: "" }))).status, 400);
  });
  await t.test("registration requires proof bound to the same phone", async () => {
    assert.equal((await register.POST(request("/api/register", "POST", base))).status, 401);
    const token = await proof(base.phone);
    assert.equal((await register.POST(request("/api/register", "POST", { ...base, phone: "9000000002", registrationProof: token }))).status, 401);
    const res = await register.POST(request("/api/register", "POST", { ...base, wantInsurance:false, registrationProof: token }));
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.policyId, null);
    assert.equal(data.underwriting.eligible, true);
    workerId = data.workerId;
    cookie = `${auth.WORKER_SESSION_COOKIE}=${auth.createWorkerSessionToken(workerId, base.phone)}`;
    assert.ok(res.headers.get("set-cookie")?.includes("HttpOnly"));
    assert.equal((await register.POST(request("/api/register", "POST", { ...base, registrationProof: token }))).status, 401);
  });
  await t.test("proof replay race creates only one account", async () => {
    const phone = "9000000005";
    const token = await proof(phone);
    const results = await Promise.all([1, 2].map(() => register.POST(request("/api/register", "POST", { ...base, phone, registrationProof: token }))));
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM workers WHERE phone = ?").get(phone)).n, 1);
  });
  await t.test("explicit consent is not inferred and opt-out creates no policy", async () => {
    for (const [phone, extra] of [["9000000006", { consents: {} }], ["9000000007", { wantInsurance: false }]] as const) {
      const res = await register.POST(request("/api/register", "POST", { ...base, phone, totalActiveDeliveryDays: 150, daysActiveInLast30: 25, ...extra, registrationProof: await proof(phone) }));
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.policyId, null);
      const row = await db.prepare("SELECT gps_location FROM registration_consents WHERE worker_id = ?").get(data.workerId);
      assert.equal(row.gps_location, phone === "9000000006" ? 0 : 1);
    }
  });
  await t.test("expired proof fails without creating an account", async () => {
    const token = await proof("9000000003");
    await db.prepare("UPDATE registration_proofs SET expires_at = 0 WHERE id = ?").run(token);
    assert.equal((await register.POST(request("/api/register", "POST", { ...base, phone: "9000000003", registrationProof: token }))).status, 401);
    assert.equal(await db.prepare("SELECT id FROM workers WHERE phone = ?").get("9000000003"), undefined);
  });
  await t.test("uncovered session stays null and does not fabricate payout details", async () => {
    const res = await session.GET(request("/api/auth/session", "GET", undefined, cookie));
    const data = await res.json();
    assert.equal(data.authenticated, true);
    assert.equal(data.policy, null);
    assert.equal(data.worker.upiId, "");
    assert.equal(data.totalEarningsProtected, 0);
  });
  await t.test("prototype participation creates an unpriced pending record, not active cover", async () => {
    const phone = "9000000004";
    const res = await register.POST(request("/api/register", "POST", { ...base, phone, totalActiveDeliveryDays: 150, daysActiveInLast30: 25, registrationProof: await proof(phone) }));
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.policyId);
    assert.equal(data.premium,null);
    assert.equal(data.quoteStatus,"schedule_required");
    eligibleId = data.workerId;
    policyId = data.policyId;
    eligibleCookie = `${auth.WORKER_SESSION_COOKIE}=${auth.createWorkerSessionToken(eligibleId, phone)}`;
    assert.equal((await db.prepare("SELECT status FROM policies WHERE id = ?").get(policyId)).status, "pending");
    const stored = await session.GET(request("/api/auth/session", "GET", undefined, eligibleCookie));
    const projection = await stored.json();
    assert.equal(projection.policy.status, "pending");
    assert.equal(projection.policy.totalPremiumPaid, 0);
  });
  await t.test("private routes deny anonymous and cross-worker reads", async () => {
    for (const [path, handler] of [["claims", claims.GET], ["policies", policies.GET], ["claims/export", exportClaims.GET], ["premium", premium.GET]] as const) {
      assert.equal((await handler(request(`/api/${path}?workerId=${workerId}`))).status, 401, path);
      assert.equal((await handler(request(`/api/${path}?workerId=${eligibleId}`, "GET", undefined, cookie))).status, 403, path);
      assert.equal((await handler(request(`/api/${path}?workerId=${workerId}`, "GET", undefined, cookie))).status, 200, path);
    }
    assert.equal((await dashboard.GET(request("/api/dashboard", "GET", undefined, cookie))).status, 401);
    assert.equal((await actuarial.GET(request("/api/actuarial", "GET", undefined, cookie))).status, 401);
  });
  await t.test("client claims, orders, reactivation, cron and settlement cannot create financial success", async () => {
    const claimBody = { workerId: eligibleId, triggerType: "heavy_rain", severity: "severe" };
    assert.equal((await claims.POST(request("/api/claims", "POST", claimBody))).status, 401);
    assert.equal((await claims.POST(request("/api/claims", "POST", claimBody, cookie))).status, 403);
    assert.equal((await claims.POST(request("/api/claims", "POST", claimBody, eligibleCookie))).status, 503);
    assert.equal((await orders.POST(request("/api/razorpay/order", "POST", { workerId: eligibleId, amount: 1 }, eligibleCookie))).status, 503);
    assert.equal((await policies.PATCH(request("/api/policies", "PATCH", { workerId: eligibleId, policyId, action: "reactivate" }, eligibleCookie))).status, 503);
    assert.equal((await policies.PATCH(request("/api/policies", "PATCH", { workerId: eligibleId, policyId, action: "cancel" }, cookie))).status, 403);
    assert.equal((await triggers.POST(request("/api/triggers", "POST", { workerId: eligibleId, simulate: true, triggerType: "heavy_rain" }, eligibleCookie))).status, 403);
    assert.equal((await cron.GET(new Request("http://localhost/api/triggers/cron", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }))).status, 503);
    await db.prepare("INSERT INTO claims (id, worker_id, policy_id, trigger_type, amount, status) VALUES (?, ?, ?, ?, ?, ?)").run("fixture-review", eligibleId, policyId, "heavy_rain", 100, "review");
    const adminCookie = `${admin.ADMIN_SESSION_COOKIE}=${admin.createAdminSessionToken(process.env.ADMIN_EMAIL!)}`;
    for (let i = 0; i < 2; i++) assert.equal((await adminClaims.PATCH(request("/api/admin/claims", "PATCH", { claimId: "fixture-review", action: "approve" }, adminCookie))).status, 503);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM settlements").get()).n, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM premium_payments").get()).n, 0);
    assert.equal((await db.prepare("SELECT status FROM claims WHERE id = ?").get("fixture-review")).status, "review");
  });
  await t.test("atomic batch rolls back a partial ledger write", async () => {
    await assert.rejects(db.batch([
      { query: "UPDATE workers SET name = ? WHERE id = ?", params: ["SHOULD ROLLBACK", workerId] },
      { query: "INSERT INTO not_a_table (id) VALUES (?)", params: [1] },
    ]));
    assert.equal((await db.prepare("SELECT name FROM workers WHERE id = ?").get(workerId)).name, base.name);
    const updated = await db.prepare("UPDATE workers SET name = ? WHERE id = ?").run(base.name, workerId);
    assert.equal(updated.changes, 1);
  });
  await t.test("tampered and expired sessions are rejected", async () => {
    const valid = auth.createWorkerSessionToken(workerId, base.phone);
    assert.equal(auth.parseWorkerSessionToken(valid + "x"), null);
    assert.equal(auth.parseWorkerSessionToken(auth.createWorkerSessionToken(workerId, base.phone, -1)), null);
    assert.equal(admin.verifyAdminSessionToken(admin.createAdminSessionToken("wrong@example.invalid")), false);
  });
  await t.test("revoked worker cannot use an existing session", async () => {
    await db.prepare("UPDATE workers SET is_active = 0 WHERE id = ?").run(workerId);
    assert.equal((await claims.GET(request(`/api/claims?workerId=${workerId}`, "GET", undefined, cookie))).status, 401);
    assert.equal((await session.GET(request("/api/auth/session", "GET", undefined, cookie)).then((r) => r.json())).authenticated, false);
  });
});
