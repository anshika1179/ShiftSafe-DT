import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {NextRequest} from "next/server";
process.env.NODE_ENV="test";process.env.DATABASE_URL="";process.env.SQLITE_DB_PATH=join(mkdtempSync(join(tmpdir(),"quote-route-")),"test.db");process.env.SEED_DEMO_DATA="false";process.env.WORKER_SESSION_SECRET="isolated-quote-test-secret-never-deploy";
test("quote auth, real stored input, persistence, edits, no financial write",async()=>{
 const {getDb}=await import("../backend/src/models/db"),db=getDb();const {createWorkerSessionToken,WORKER_SESSION_COOKIE}=await import("../frontend/lib/server/worker-auth");const quote=await import("../frontend/app/api/quote/route"),premium=await import("../frontend/app/api/premium/route"),journey=await import("../frontend/app/api/journey/route"),profile=await import("../frontend/app/api/profile/route");
 await db.prepare("INSERT INTO workers (id,name,phone,city,zone,platform,avg_weekly_income,days_worked_this_week) VALUES (?,?,?,?,?,?,?,?)").run("quote-a","Fixture","9000000001","Mumbai","Actual zone","Zomato",7000,0);
 const cookie=`${WORKER_SESSION_COOKIE}=${createWorkerSessionToken("quote-a","9000000001")}`;
 const req=(path:string,body?:unknown,c=cookie,origin="http://localhost")=>new NextRequest(`http://localhost${path}`,{method:body?"POST":"GET",headers:{cookie:c,origin,"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await quote.POST(req("/api/quote",{},""))).status,401);assert.equal((await quote.POST(req("/api/quote",{},cookie,"http://other.invalid"))).status,403);assert.equal((await quote.POST(req("/api/quote",{weekdays:[]}))).status,400);
 const prior=global.fetch;global.fetch=(async()=>{throw Error("provider fixture outage")}) as typeof fetch;
 try{const response=await quote.POST(req("/api/quote",{weekdays:[1],startHour:8,endHour:10,income:1,city:"Delhi"}));assert.equal(response.status,200);assert.equal((await response.json()).status,"insufficient_data");}finally{global.fetch=prior;}
 const row=await db.prepare("SELECT result_json FROM quote_snapshots WHERE worker_id = ?").get("quote-a");assert.ok(row);assert.match(row.result_json,/Historical provider unavailable/);
 // Synthetic persisted history result solely for API contract testing.
 const {quoteFingerprint}=await import("../backend/src/engines/historical-quote");const inputs={city:"Mumbai",zone:"Actual zone",platform:"Zomato",income:7000,weekdays:[1],startHour:8,endHour:10};
 await db.prepare("UPDATE quote_snapshots SET result_json=?,input_fingerprint=? WHERE worker_id=?").run(JSON.stringify({status:"estimated",assumptions:{version:"weather-proxy-2026-10-06"},inputs,weeklyPremium:0}),quoteFingerprint(inputs),"quote-a");
 const p=await (await premium.GET(req("/api/premium?income=1&city=Delhi"))).json();assert.equal(p.quote.inputs.income,7000);assert.equal(p.quote.inputs.city,"Mumbai");assert.equal((await premium.GET(req("/api/premium?workerId=another"))).status,403);
 assert.equal((await (await journey.GET(req("/api/journey"))).json()).quote.weeklyPremium,0);
 await profile.POST(req("/api/profile",{name:"Fixture",city:"Mumbai",zone:"Updated zone",platform:"Zomato",avgWeeklyIncome:8000,daysWorkedThisWeek:0,totalActiveDeliveryDays:0}));
 assert.equal(await db.prepare("SELECT worker_id FROM quote_snapshots WHERE worker_id=?").get("quote-a"),undefined);assert.equal((await (await journey.GET(req("/api/journey"))).json()).quote,null);
 for(const table of ["policies","claims","premium_payments","settlements"])assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).n,0);
});
