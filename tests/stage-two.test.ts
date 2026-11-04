import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { canAdvanceJourney, journeyDestination } from "../frontend/lib/shared/journey";
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
process.env.SQLITE_DB_PATH = join(mkdtempSync(join(tmpdir(), "shiftsafe-stage-two-")), "ledger.db");
process.env.SEED_DEMO_DATA = "false";
process.env.WORKER_SESSION_SECRET = "stage-two-local-test-only-secret-12345678";
function request(path: string, body?: unknown, cookie?: string, origin = "http://localhost") {
  return new NextRequest(`http://localhost${path}`, { method: body ? "POST" : "GET", headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
test("Stage 2 persisted journey, private drafts and profile corrections", async t => {
  const { getDb } = await import("../backend/src/models/db");
  const { createWorkerSessionToken, WORKER_SESSION_COOKIE } = await import("../frontend/lib/server/worker-auth");
  const journey = await import("../frontend/app/api/journey/route");
  const drafts = await import("../frontend/app/api/onboarding/draft/route");
  const gps = await import("../frontend/app/api/gps/verify/route");
  const profile = await import("../frontend/app/api/profile/route");
  const db = getDb();
  await db.prepare("INSERT INTO workers (id, name, phone, platform, city, zone, avg_weekly_income, active_delivery_days, days_worked_this_week) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("a", "Fixture Worker", "9000000001", "Zomato", "Mumbai", "Andheri", 7000, 125, 0);
  await db.prepare("INSERT INTO workers (id, name, phone, platform, city, zone) VALUES (?, ?, ?, ?, ?, ?)").run("b", "Other Fixture", "9000000002", "Swiggy", "Delhi", "Dwarka");
  const cookie = `${WORKER_SESSION_COOKIE}=${createWorkerSessionToken("a", "9000000001")}`;
  const other = `${WORKER_SESSION_COOKIE}=${createWorkerSessionToken("b", "9000000002")}`;
  await t.test("authentication, origin and legacy account are fail-closed", async () => {
    assert.equal((await journey.GET(request("/api/journey"))).status, 401);
    assert.equal((await journey.POST(request("/api/journey", { step: "eligibility" }, cookie, "https://other.invalid"))).status, 403);
    const data = await (await journey.GET(request("/api/journey", undefined, cookie))).json();
    assert.equal(data.step, "profile"); assert.equal(data.eligibility.eligible, false); assert.equal(data.quote, null);
    assert.equal(data.worker.days_worked_this_week, 0); assert.equal(data.financialServicesEnabled, false);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM workers").get()).n, 2);
  });
  await t.test("ordered steps persist, repeats are idempotent, accounts isolated", async () => {
    assert.equal(canAdvanceJourney("profile", "complete"), false);
    assert.equal(journeyDestination("complete"), "/dashboard");
    assert.equal((await journey.POST(request("/api/journey", { step: "complete" }, cookie))).status, 409);
    for (const step of ["eligibility", "quote", "review", "complete"]) {
      assert.equal((await journey.POST(request("/api/journey", { step }, cookie))).status, 200);
      assert.equal((await journey.POST(request("/api/journey", { step }, cookie))).status, 200);
      assert.equal((await (await journey.GET(request("/api/journey", undefined, cookie))).json()).step, step);
    }
    assert.equal((await (await journey.GET(request("/api/journey", undefined, other))).json()).step, "profile");
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM policies").get()).n, 0);
  });
  await t.test("email grant scopes drafts; bank details, proof and tokens are not retained", async () => {
    const proof = "stage-two-proof", hash = createHash("sha256").update(proof).digest("hex");
    await db.prepare("INSERT INTO google_registration_proofs (id, subject, email, expires_at, email_link_verified) VALUES (?, ?, ?, ?, ?)").run(hash, "fixture-subject", "fixture@example.invalid", Date.now() + 60000, 1);
    assert.equal((await drafts.POST(request("/api/onboarding/draft", { action: "save", registrationProof: proof, draft: { step: "profile", form: { name: "Worker", daysWorkedThisWeek: "0", bankAccount: "sensitive", idToken: "secret", consentGps: true } } }))).status, 200);
    const data = await (await drafts.POST(request("/api/onboarding/draft", { action: "read", registrationProof: proof }))).json();
    assert.deepEqual(data.draft.form, { name: "Worker", daysWorkedThisWeek: "0", consentGps: true });
    assert.equal((await drafts.POST(request("/api/onboarding/draft", { action: "read", registrationProof: "wrong" }))).status, 401);
    await db.prepare("UPDATE google_registration_proofs SET consumed = 1 WHERE id = ?").run(hash);
    assert.equal((await drafts.POST(request("/api/onboarding/draft", { action: "read", registrationProof: proof }))).status, 401);
  });
  await t.test("GPS requires identity, fresh timestamp and real accuracy; city center never verifies a zone", async () => {
    await db.prepare("INSERT INTO registration_consents (worker_id,gps_location,bank_upi,platform_activity) VALUES (?,?,?,?)").run("a",1,0,0);
    const body={workerLocation:{lat:19.076,lon:72.8777},gpsAccuracyMeters:10,observedAt:Date.now()};
    assert.equal((await gps.POST(request("/api/gps/verify",body))).status,401);
    assert.equal((await gps.POST(request("/api/gps/verify",{...body,observedAt:Date.now()-900001},cookie))).status,400);
    assert.equal((await gps.POST(request("/api/gps/verify",{...body,gpsAccuracyMeters:null},cookie))).status,400);
    const result=await (await gps.POST(request("/api/gps/verify",body,cookie))).json();
    assert.equal(result.verified,false);assert.equal(result.zoneContext.precision,"city_center");
  });
  await t.test("profile corrections invalidate old assessment without touching identity or policy", async () => {
    await db.prepare("INSERT INTO policies (id, worker_id, weekly_premium, status) VALUES (?, ?, ?, ?)").run("policy-a", "a", 42, "pending");
    await db.prepare("INSERT INTO premium_calculations (id, worker_id, base_premium, final_premium, factors_json) VALUES (?, ?, ?, ?, ?)").run("calc-a", "a", 42, 42, JSON.stringify({ pricingBreakdown: {} }));
    const body = { name: "Corrected Worker", platform: "Swiggy", city: "Delhi", zone: "Dwarka", avgWeeklyIncome: "8000", daysWorkedThisWeek: "0", totalActiveDeliveryDays: "130" };
    assert.equal((await profile.POST(request("/api/profile", { ...body, daysWorkedThisWeek: "" }, cookie))).status, 400);
    assert.equal((await profile.POST(request("/api/profile", body, cookie))).status, 200);
    const saved = await (await journey.GET(request("/api/journey", undefined, cookie))).json();
    assert.equal(saved.step, "profile"); assert.equal(saved.quote, null); assert.match(saved.eligibility.reason,/not been verified/);
    assert.equal(saved.worker.days_worked_this_week, 0);
    assert.equal((await db.prepare("SELECT status FROM policies WHERE id = ?").get("policy-a")).status, "pending");
    assert.equal((await db.prepare("SELECT phone FROM workers WHERE id = ?").get("a")).phone, "9000000001");
  });
});
