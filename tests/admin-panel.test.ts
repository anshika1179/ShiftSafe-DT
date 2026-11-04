import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
process.env.NODE_ENV="test";process.env.DATABASE_URL="";process.env.SQLITE_DB_PATH=join(mkdtempSync(join(tmpdir(),"admin-panel-")),"db.sqlite");process.env.SEED_DEMO_DATA="false";
process.env.ADMIN_EMAIL="fixture@test.invalid";process.env.ADMIN_DEV_PASSWORD="isolated-local-fixture-only";process.env.ADMIN_SESSION_SECRET="isolated-admin-panel-test-secret-only";
test("administrator access and support revision lifecycle",async(t)=>{
 const api=await import("../frontend/app/api/admin/service-requests/route"),login=await import("../frontend/app/api/admin/login/route"),session=await import("../frontend/app/api/admin/session/route"),auth=await import("../frontend/lib/server/admin-auth"),{getDb}=await import("../backend/src/models/db"),db=getDb();
 const cookie=`${auth.ADMIN_SESSION_COOKIE}=${auth.createAdminSessionToken(process.env.ADMIN_EMAIL!)}`;
 const req=(body:unknown,origin="http://localhost",c=cookie)=>new NextRequest("http://localhost/api/admin/service-requests",{method:"PATCH",headers:{cookie:c,origin,"content-type":"application/json"},body:JSON.stringify(body)});
 await db.prepare("INSERT INTO workers (id,name,phone,platform,city,zone) VALUES (?,?,?,?,?,?)").run("a","Local fixture","9000000001","Zomato","Mumbai","Andheri");
 await db.prepare("INSERT INTO service_requests (id,worker_id,category,subject,description,priority,updated_at) VALUES (?,?,?,?,?,?,?)").run("r","a","general_inquiry","Test only","Local fixture request","medium","2026-10-06 12:00:00+00");
 await t.test("unauthorized, cross-origin, invalid input and missing ID gates",async()=>{
 assert.equal((await api.PATCH(req({requestId:"r",status:"resolved"},"http://localhost",""))).status,401);
 assert.equal((await api.PATCH(req({requestId:"r",status:"resolved"},"https://outside.invalid"))).status,403);
 assert.equal((await api.PATCH(req(null))).status,400);
 assert.equal((await api.PATCH(req({requestId:"missing",status:"resolved"}))).status,404);
 assert.equal((await api.PATCH(req({requestId:"r",status:"paid"}))).status,400);
 assert.equal((await api.PATCH(req({requestId:"r",status:"resolved",adminNotes:"x".repeat(1001)}))).status,400);
 assert.equal((await api.GET(new NextRequest("http://localhost/api/admin/service-requests?status=paid",{headers:{cookie}}))).status,400);
 });
 await t.test("resolve notes, stale revision denial, reopen and clear notes",async()=>{
 const original="2026-10-06 12:00:00+00";
 assert.equal((await api.PATCH(req({requestId:"r",status:"resolved",adminNotes:"Fixture resolved, no payout",expectedUpdatedAt:original}))).status,200);
 let row=await db.prepare("SELECT * FROM service_requests WHERE id='r'").get();assert.equal(row.status,"resolved");assert.ok(row.resolved_at);assert.equal(row.admin_notes,"Fixture resolved, no payout");
 assert.equal((await api.PATCH(req({requestId:"r",status:"open",expectedUpdatedAt:original}))).status,409);
 assert.equal((await api.PATCH(req({requestId:"r",status:"open",adminNotes:"",expectedUpdatedAt:row.updated_at}))).status,200);
 row=await db.prepare("SELECT * FROM service_requests WHERE id='r'").get();assert.equal(row.resolved_at,null);assert.equal(row.admin_notes,"");
 const response=await api.GET(new NextRequest("http://localhost/api/admin/service-requests?status=open",{headers:{cookie}})),data=await response.json();assert.equal(data.summary.total,1);assert.equal(data.matchedTotal,1);assert.equal(data.limit,100);assert.equal(response.headers.get("cache-control"),"no-store");assert.equal(data.requests[0].ai,null);
 });
 await t.test("login credentials, expiry, origin and private session responses",async()=>{
 const request=(password:string,origin="http://localhost")=>new NextRequest("http://localhost/api/admin/login",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify({email:"fixture@test.invalid",password})});
 assert.equal((await login.POST(request("wrong"))).status,401);const r=await login.POST(request("isolated-local-fixture-only"));assert.equal(r.status,200);assert.match(r.headers.get("set-cookie")||"",/HttpOnly/i);
 assert.equal((await login.POST(request("isolated-local-fixture-only","https://outside.invalid"))).status,403);
 assert.equal((await login.DELETE(new NextRequest("http://localhost/api/admin/login",{method:"DELETE",headers:{origin:"https://outside.invalid"}}))).status,403);
 assert.equal(auth.verifyAdminSessionToken(auth.createAdminSessionToken(process.env.ADMIN_EMAIL!,-1)),false);
 const s=await session.GET(new NextRequest("http://localhost/api/admin/session",{headers:{cookie}}));assert.equal((await s.json()).authenticated,true);assert.equal(s.headers.get("cache-control"),"no-store");
 });
});

test("admin entry is separate from worker navigation", async () => {
 const {readFileSync}=await import("node:fs");
 const nav=readFileSync("frontend/src/components/ui/Navigation.tsx","utf8"),home=readFileSync("frontend/app/page.tsx","utf8");
 assert.doesNotMatch(nav,/href="\/admin"/);
 assert.match(nav,/pathname === "\/admin"/);
 assert.match(home,/!isLoggedIn && \(/);
});
