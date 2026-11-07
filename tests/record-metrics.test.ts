import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {NextRequest} from "next/server";
process.env.NODE_ENV="test";process.env.DATABASE_URL="";process.env.SQLITE_DB_PATH=join(mkdtempSync(join(tmpdir(),"metrics-")),"ledger.db");process.env.SEED_DEMO_DATA="false";process.env.WORKER_SESSION_SECRET="metrics-isolated-worker-session-secret";
test("truthful record analytics, zero denominators, isolation, unavailable ML",async(t)=>{
 const {getDb}=await import("../backend/src/models/db"),db=getDb();const {recordMetrics,safeRatio}=await import("../backend/src/services/record-metrics");const api=await import("../frontend/app/api/analytics/route");const ml=await import("../frontend/app/api/ml/health/route");const health=await import("../frontend/app/api/health/route");const {WORKER_SESSION_COOKIE,createWorkerSessionToken}=await import("../frontend/lib/server/worker-auth");
 for(const id of ["a","b"])await db.prepare("INSERT INTO workers (id,name,phone,platform,city,zone) VALUES (?,?,?,?,?,?)").run(id,"Test worker",id==="a"?"9000000001":"9000000002","Zomato","Mumbai","Andheri");
 const cookie=`${WORKER_SESSION_COOKIE}=${createWorkerSessionToken("a","9000000001")}`,req=(suffix="",c=cookie)=>new NextRequest("http://localhost/api/analytics"+suffix,{headers:{cookie:c}});
 await t.test("empty means no records and ratio unavailable",async()=>{const m=await recordMetrics("a");assert.equal(m.live.policyRecords,0);assert.equal(m.live.lossRatio,null);assert.equal(safeRatio(20,0),null);assert.equal(safeRatio(20,40),0.5);assert.equal(safeRatio(NaN,20),null);});
 await t.test("auth and cross owner gates",async()=>{assert.equal((await api.GET(req("",""))).status,401);assert.equal((await api.GET(req("?workerId=b"))).status,403);});
 await t.test("face premiums are not collected, sandbox not real money",async()=>{
 await db.prepare("INSERT INTO policies (id,worker_id,weekly_premium) VALUES (?,?,?)").run("pa","a",999);
 await db.prepare("INSERT INTO premium_payments (id,worker_id,policy_id,amount,status) VALUES (?,?,?,?,?)").run("pay","a","pa",20,"paid");
 await db.prepare("INSERT INTO premium_payments (id,worker_id,policy_id,amount,status) VALUES (?,?,?,?,?)").run("unpaid","a","pa",100,"created");
 await db.prepare("INSERT INTO policies (id,worker_id,weekly_premium) VALUES (?,?,?)").run("pb","b",900);
 await db.prepare("INSERT INTO claims (id,worker_id,policy_id,trigger_type,amount,status) VALUES (?,?,?,?,?,?)").run("c","a","pa","heavy_rain",5,"paid");
 await db.prepare("INSERT INTO sandbox_policies (id,worker_id,quote_hash,quote_json,premium_simulated,weekly_limit,starts_at,ends_at) VALUES (?,?,?,?,?,?,?,?)").run("s","a","h","{}",10,50,0,100);
 await db.prepare("INSERT INTO sandbox_receipts (id,worker_id,policy_id,claim_id,amount_simulated) VALUES (?,?,?,?,?)").run("r","a","s","fixture",40);
 const m=await (await api.GET(req())).json();assert.equal(m.live.policyRecords,1);assert.equal(m.live.paidPremiumRecorded,20);assert.equal(m.live.paidClaimsRecorded,5);assert.equal(m.live.lossRatio,0.25);assert.equal(m.sandbox.receiptsSimulated,40);assert.equal(m.financialServicesEnabled,false);assert.equal((await recordMetrics("b")).sandbox.receiptRecords,0);});
 await t.test("public model health exposes no private aggregates or invented accuracy",async()=>{const m=await (await ml.GET()).json();assert.equal(m.status,"unavailable");assert.equal(m.accuracy,null);assert.equal(m.trainedModel,false);assert.equal(m.claims,undefined);const h=await(await health.GET()).json();assert.equal(h.ml.trainedModel,false);assert.equal(h.ml.passRate,undefined);});
 await t.test("support priority is user selected; admin update and revoked worker gate",async()=>{
 const sr=await import("../frontend/app/api/service-requests/route"),ar=await import("../frontend/app/api/admin/service-requests/route");
 const r=await sr.POST(new NextRequest("http://localhost/api/service-requests",{method:"POST",headers:{cookie,origin:"http://localhost","content-type":"application/json"},body:JSON.stringify({category:"technical_issue",subject:"Test request",description:"Fixture technical issue",priority:"low"})}));assert.equal(r.status,201);const b=await r.json();assert.equal(b.priority,"low");assert.equal(b.aiClassification,null);
 process.env.ADMIN_EMAIL="fixture@test.invalid";process.env.ADMIN_SESSION_SECRET="isolated-admin-metrics-secret-123456";const {ADMIN_SESSION_COOKIE,createAdminSessionToken}=await import("../frontend/lib/server/admin-auth");const ac=`${ADMIN_SESSION_COOKIE}=${createAdminSessionToken("fixture@test.invalid")}`;
 const bonus=await import("../frontend/app/api/admin/bonuses/route");for(const call of [bonus.POST,bonus.PATCH])assert.equal((await call(new NextRequest("http://localhost/api/admin/bonuses",{method:"POST",headers:{cookie:ac}}))).status,503);assert.equal((await db.prepare("SELECT COUNT(*) n FROM risk_bonuses").get()).n,0);
 const rr=await ar.PATCH(new NextRequest("http://localhost/api/admin/service-requests",{method:"PATCH",headers:{cookie:ac,origin:"http://localhost","content-type":"application/json"},body:JSON.stringify({requestId:b.requestId,status:"resolved"})}));assert.equal(rr.status,200);assert.equal((await db.prepare("SELECT status FROM service_requests WHERE id=?").get(b.requestId)).status,"resolved");
 await db.prepare("UPDATE workers SET is_active=0 WHERE id='a'").run();assert.equal((await api.GET(req())).status,401);assert.equal((await sr.GET(new NextRequest("http://localhost/api/service-requests",{headers:{cookie}}))).status,401);await db.prepare("UPDATE workers SET is_active=1 WHERE id='a'").run();
 });
 await t.test("retired exposed simulation/chart/model claims stay retired",()=>{for(const file of ["dashboard","analytics","actuarial","claims","policies","admin"]){const s=readFileSync(`frontend/app/${file}/page.tsx`,"utf8");assert.doesNotMatch(s,/Isolation Forest|Math.random|0\.65|4200|runMlSelfTest/);}assert.doesNotMatch(readFileSync("frontend/app/api/dashboard/route.ts","utf8"),/HISTORICAL_RISK|detectFraudAdvanced|runMlSelfTest/);});
});
