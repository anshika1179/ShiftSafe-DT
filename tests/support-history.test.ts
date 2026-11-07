import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
process.env.SQLITE_DB_PATH = join(mkdtempSync(join(tmpdir(), "support-history-")), "db.sqlite");
process.env.SEED_DEMO_DATA = "false";
process.env.ADMIN_EMAIL = "history-fixture@test.invalid";
process.env.ADMIN_SESSION_SECRET = "isolated-history-admin-session-secret";
process.env.WORKER_SESSION_SECRET = "isolated-history-worker-session-secret";

test("support change history is atomic, scoped and revision-safe", async (t) => {
  const { getDb } = await import("../backend/src/models/db");
  const auth = await import("../frontend/lib/server/admin-auth");
  const workerAuth = await import("../frontend/lib/server/worker-auth");
  const admin = await import("../frontend/app/api/admin/service-requests/route");
  const history = await import("../frontend/app/api/admin/service-requests/history/route");
  const worker = await import("../frontend/app/api/service-requests/route");
  const db = getDb();
  const cookie = `${auth.ADMIN_SESSION_COOKIE}=${auth.createAdminSessionToken(process.env.ADMIN_EMAIL!)}`;
  const workerCookie = `${workerAuth.WORKER_SESSION_COOKIE}=${workerAuth.createWorkerSessionToken("worker", "9000000001")}`;
  await db.prepare("INSERT INTO workers (id,name,phone,platform,city,zone) VALUES (?,?,?,?,?,?)").run("worker", "Local history fixture", "9000000001", "Zomato", "Mumbai", "Andheri");
  await db.prepare("INSERT INTO service_requests (id,worker_id,category,subject,description,priority,updated_at) VALUES (?,?,?,?,?,?,?)").run("ticket", "worker", "general_inquiry", "Local history test", "Local history test only", "medium", "2026-10-07 00:00:00+00");
  const row = () => db.prepare("SELECT * FROM service_requests WHERE id='ticket'").get();
  const read = (query = "requestId=ticket", c = cookie) => history.GET(new NextRequest(`http://localhost/api/admin/service-requests/history?${query}`, { headers: { cookie: c } }));
  async function update(status: string, notes?: string, revision?: { updated_at: string; last_change_id: string }) {
    const current = revision || await row();
    return admin.PATCH(new NextRequest("http://localhost/api/admin/service-requests", { method: "PATCH", headers: { origin: "http://localhost", cookie, "content-type": "application/json" }, body: JSON.stringify({ requestId: "ticket", status, ...(notes === undefined ? {} : { adminNotes: notes }), expectedUpdatedAt: current.updated_at, expectedRevision: current.last_change_id }) }));
  }
  await t.test("history is admin-only and pre-existing tickets have no invented changes", async () => {
    assert.equal((await read("requestId=ticket", "")).status, 401);
    assert.equal((await read("requestId=ticket", workerCookie)).status, 401);
    assert.equal((await read("requestId=missing")).status, 404);
    assert.equal((await read("")).status, 400);
    const response = await read();
    assert.equal(response.headers.get("cache-control"), "no-store");
    const data = await response.json(); assert.equal(data.total, 0); assert.deepEqual(data.events, []);
  });
  await t.test("unchanged save creates no event or revision", async () => {
    const before = await row();
    assert.equal((await (await update("open", "")).json()).unchanged, true);
    assert.deepEqual(await row(), before);
    assert.equal((await (await read()).json()).total, 0);
  });
  await t.test("resolve, note-only edit, clear and reopen retain genuine old/new values", async () => {
    assert.equal((await update("resolved", "Fixture note, no payout.")).status, 200);
    const resolved = await row(); assert.ok(resolved.resolved_at);
    assert.equal((await update("resolved", "Changed local fixture note.")).status, 200);
    assert.equal((await row()).resolved_at, resolved.resolved_at);
    assert.equal((await update("open", "")).status, 200);
    assert.equal((await row()).resolved_at, null);
    const events = await db.prepare("SELECT * FROM service_request_history ORDER BY rowid").all();
    assert.equal(events.length, 3);
    assert.deepEqual(events.map(e => Number(e.revision)), [1, 2, 3]);
    assert.deepEqual(events.map(e => [e.old_status, e.new_status]), [["open", "resolved"], ["resolved", "resolved"], ["resolved", "open"]]);
    assert.deepEqual(events.map(e => [e.old_notes, e.new_notes]), [[null, "Fixture note, no payout."], ["Fixture note, no payout.", "Changed local fixture note."], ["Changed local fixture note.", ""]]);
    assert.ok(events.every(e => e.actor_email === process.env.ADMIN_EMAIL && Number.isFinite(Date.parse(e.changed_at))));
    assert.equal((await (await read()).json()).total, 3);
  });
  await t.test("stale save and concurrent revisions cannot leave phantom history", async () => {
    const before = await row();
    const results = await Promise.all([update("in_progress", "Concurrent A", before), update("closed", "Concurrent B", before)]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    assert.equal((await (await read()).json()).total, 4);
    assert.equal((await update("resolved", "Stale note", before)).status, 409);
    assert.equal((await (await read()).json()).total, 4);
  });
  await t.test("unique token guards even if timestamps collide", async () => {
    const before = await row();
    assert.equal((await update("open", "token-fixture", before)).status, 200);
    await db.prepare("UPDATE service_requests SET updated_at = ? WHERE id = 'ticket'").run(before.updated_at);
    assert.equal((await update("resolved", "must not save", before)).status, 409);
    assert.equal((await row()).admin_notes, "token-fixture");
  });
  await t.test("omitted notes are preserved and worker API does not disclose audit identity or old notes", async () => {
    assert.equal((await update("in_progress")).status, 200);
    assert.equal((await row()).admin_notes, "token-fixture");
    const data = await (await worker.GET(new NextRequest("http://localhost/api/service-requests", { headers: { cookie: workerCookie } }))).json();
    assert.equal(data.requests[0].admin_notes, "token-fixture");
    assert.equal(data.requests[0].history, undefined);
    assert.equal(data.requests[0].actor_email, undefined);
  });
  await t.test("history truncation and total are explicit", async () => {
    for (let i = 0; i < 101; i++) await db.prepare("INSERT INTO service_request_history (id,request_id,actor_email,revision,old_status,new_status,changed_at) VALUES (?,?,?,?,?,?,?)").run(`fixture-${i}`, "ticket", "fixture@test.invalid", i + 100, "open", "open", "2026-10-06T00:00:00.000Z");
    const data = await (await read()).json(); assert.equal(data.events.length, 100); assert.equal(data.total, 107); assert.equal(data.limit, 100);
  });
  await t.test("failed history write rolls back status, note, timestamp and token", async () => {
    const before = await row();
    await db.exec("DROP TABLE service_request_history");
    assert.equal((await update("resolved", "must roll back")).status, 500);
    assert.deepEqual(await row(), before);
    assert.equal((await read()).status, 503);
  });
});
