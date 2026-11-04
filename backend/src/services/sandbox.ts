import {createHash} from "node:crypto";
import {getDb} from "../models/db";
import {databaseTimestampMs} from "../utils/database-time";
import {quoteFingerprint,QUOTE_ASSUMPTIONS,validQuoteInputs} from "../engines/historical-quote";
import {fetchEnvironment,resolveEnvironmentLocation} from "./environment";
import {TRIGGER_RULES} from "../config/trigger-rules";
const normalizePolicy=(p:any)=>p?{...p,starts_at:Number(p.starts_at),ends_at:Number(p.ends_at),premium_simulated:Number(p.premium_simulated),weekly_limit:Number(p.weekly_limit)}:p;
const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
export const SANDBOX_RULES={version:"sandbox-2026-10-06",durationDays:7,claimHours:1,lossFraction:0.5,financialEffect:false,ml:"unavailable - no training samples"};
export class SandboxError extends Error {constructor(message:string,public status=409){super(message);}}
async function workerProfile(workerId:string){return await getDb().prepare("SELECT city,zone,platform,avg_weekly_income FROM workers WHERE id=?").get(workerId);}
export async function sandboxSnapshot(workerId:string){const db=getDb();return {mode:"sandbox",financialEffect:false,rules:SANDBOX_RULES,asOf:Date.now(),policies:await db.prepare("SELECT * FROM sandbox_policies WHERE worker_id=? ORDER BY created_at DESC").all(workerId),claims:await db.prepare("SELECT c.*,e.source,e.peril,e.observed_at,e.evidence_json FROM sandbox_claims c JOIN sandbox_events e ON e.id=c.event_id WHERE c.worker_id=? ORDER BY c.created_at DESC").all(workerId),receipts:await db.prepare("SELECT * FROM sandbox_receipts WHERE worker_id=? ORDER BY created_at DESC").all(workerId)};}
export async function activateSandbox(workerId:string,now=Date.now()){
 const db=getDb(),row=await db.prepare("SELECT input_fingerprint,result_json,created_at FROM quote_snapshots WHERE worker_id=?").get(workerId),w=await workerProfile(workerId);
 let q;try{q=JSON.parse(row?.result_json||"null");}catch{throw new SandboxError("Calculate a valid historical estimate first");}
 if(!q||q.status!=="estimated"||q.assumptions?.version!==QUOTE_ASSUMPTIONS.version||!q.inputs||!validQuoteInputs(q.inputs)||!Number.isFinite(q.weeklyPremium)||q.weeklyPremium<0||!Number.isFinite(q.coverageAmount)||q.coverageAmount<=0||!Number.isFinite(q.calculation?.hourlyIncome)||q.calculation.hourlyIncome<=0)throw new SandboxError("A current valid historical estimate is required");
 const fingerprint=quoteFingerprint({...q.inputs,city:w.city,zone:w.zone,platform:w.platform,income:Number(w.avg_weekly_income)});
 if(fingerprint!==quoteFingerprint(q.inputs)||fingerprint!==row.input_fingerprint)throw new SandboxError("Quote no longer matches your work profile. Recalculate.");
 const quoteTime=databaseTimestampMs(row.created_at);if(!Number.isFinite(quoteTime)||now-quoteTime>7*86400000||now<quoteTime)throw new SandboxError("Quote is old or has an invalid timestamp. Recalculate.");
 const existing=await db.prepare("SELECT * FROM sandbox_policies WHERE worker_id=? AND ends_at>? ORDER BY starts_at DESC LIMIT 1").get(workerId,now);if(existing){if(existing.quote_json===row.result_json)return normalizePolicy(existing);throw new SandboxError("A seven-day sandbox policy already exists. Review it before starting another quote.");}
 const quoteHash=hash(row.result_json),id=`sbp_${hash(workerId+quoteHash).slice(0,32)}`;
 // Exact snapshot guard and unique hash make concurrent/replayed confirmations one policy.
 await db.batch([{query:"UPDATE workers SET updated_at=updated_at WHERE id=?",params:[workerId]},{query:"INSERT INTO sandbox_policies (id,worker_id,quote_hash,quote_json,premium_simulated,weekly_limit,starts_at,ends_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM quote_snapshots WHERE worker_id=? AND result_json=?) AND EXISTS (SELECT 1 FROM workers WHERE id=? AND city=? AND zone=? AND platform=? AND avg_weekly_income=?) AND NOT EXISTS (SELECT 1 FROM sandbox_policies WHERE worker_id=? AND ends_at>?) ON CONFLICT DO NOTHING",params:[id,workerId,quoteHash,row.result_json,q.weeklyPremium,q.coverageAmount,now,now+7*86400000,workerId,row.result_json,workerId,w.city,w.zone,w.platform,w.avg_weekly_income,workerId,now]}]);
 const policy=await db.prepare("SELECT * FROM sandbox_policies WHERE id=? AND worker_id=?").get(id,workerId);if(!policy)throw new SandboxError("Quote or profile changed. Retry.");return normalizePolicy(policy);
}
function scheduled(policy:any,time:number){const q=JSON.parse(policy.quote_json),d=new Date(time+19800000);return q.inputs.weekdays.includes(d.getUTCDay())&&d.getUTCHours()>=q.inputs.startHour&&d.getUTCHours()<q.inputs.endHour;}
async function ownedActive(workerId:string,id:string,now:number){const p=await getDb().prepare("SELECT * FROM sandbox_policies WHERE id=? AND worker_id=?").get(id,workerId);if(!p)throw new SandboxError("Sandbox policy not found",404);if(p.starts_at>now||p.ends_at<=now)throw new SandboxError("Sandbox policy is outside its seven-day window");const w=await workerProfile(workerId),q=JSON.parse(p.quote_json);if(quoteFingerprint({...q.inputs,city:w.city,zone:w.zone,platform:w.platform,income:Number(w.avg_weekly_income)})!==quoteFingerprint(q.inputs))throw new SandboxError("Profile changed. This sandbox policy cannot assess the new profile.");return normalizePolicy(p);}
async function recordEvent(workerId:string,policy:any,peril:string,source:string,observedAt:number,evidence:Record<string,unknown>,review:string[],now:number){
 const db=getDb();const exposureStart=peril==="heavy_rain"?observedAt-3600000:observedAt;
 if(exposureStart<policy.starts_at||observedAt>=policy.ends_at)throw new SandboxError("Event is outside policy time window");
 if(!scheduled(policy,exposureStart)||(peril==="heavy_rain"&&!scheduled(policy,observedAt-1)))throw new SandboxError("Event is outside the saved work schedule");
 const eventId=`sbe_${hash(`${policy.id}:${source}:${peril}:${observedAt}`).slice(0,32)}`,claimId=`sbc_${hash(eventId).slice(0,32)}`,q=JSON.parse(policy.quote_json);
 const proposed=Math.min(Number(policy.weekly_limit),Math.round(q.calculation.hourlyIncome*SANDBOX_RULES.claimHours*SANDBOX_RULES.lossFraction*100)/100);
 const status=review.length?"review":"scenario_approved";
 const guard="EXISTS (SELECT 1 FROM sandbox_policies WHERE id=? AND worker_id=? AND starts_at<=? AND ends_at>?) AND EXISTS (SELECT 1 FROM workers WHERE id=? AND city=? AND zone=? AND platform=? AND avg_weekly_income=?)";
 await db.batch([
  {query:"UPDATE workers SET updated_at=updated_at WHERE id=?",params:[workerId]},
  {query:`INSERT INTO sandbox_events (id,worker_id,policy_id,source,peril,observed_at,evidence_json) SELECT ?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT DO NOTHING`,params:[eventId,workerId,policy.id,source,peril,observedAt,JSON.stringify({...evidence,rulesVersion:SANDBOX_RULES.version,realLossVerified:false,financialEffect:false}),policy.id,workerId,exposureStart,now,workerId,q.inputs.city,q.inputs.zone,q.inputs.platform,q.inputs.income]},
  {query:"INSERT INTO sandbox_claims (id,worker_id,policy_id,event_id,status,review_json,amount_simulated) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM sandbox_events WHERE id=? AND worker_id=?) ON CONFLICT DO NOTHING",params:[claimId,workerId,policy.id,eventId,status,JSON.stringify(review),review.length?0:proposed,eventId,workerId]}
 ]);
 const claim=await db.prepare("SELECT * FROM sandbox_claims WHERE id=? AND worker_id=?").get(claimId,workerId);if(!claim)throw new SandboxError("Event could not be saved. Retry.");return claim;
}
export async function scenarioEvent(workerId:string,policyId:string,peril:unknown,evidenceCase:unknown,now=Date.now()){
 if(!["heavy_rain","heatwave"].includes(String(peril))||!["missing_evidence","synthetic_complete"].includes(String(evidenceCase)))throw new SandboxError("Choose a labelled scenario and evidence case",400);
 const p=await ownedActive(workerId,policyId,now);
 // One deterministic scenario of each peril per policy. Replaying never creates a new claim.
 let exposureStart=Math.ceil(p.starts_at/3600000)*3600000;while(exposureStart+3600000<p.ends_at&&!scheduled(p,exposureStart))exposureStart+=3600000;if(exposureStart+3600000>=p.ends_at)throw new SandboxError("No full scheduled hour remains in this policy");const observedAt=String(peril)==="heavy_rain"?exposureStart+3600000:exposureStart,review=evidenceCase==="synthetic_complete"?[]:["Work-zone/activity evidence is missing. Rule review, not a fraud verdict."];
 return await recordEvent(workerId,p,String(peril),`manual_simulation:${evidenceCase}`,observedAt,{label:"USER-SELECTED SYNTHETIC SCENARIO, NOT OBSERVED WEATHER",evidenceCase,workZone:evidenceCase==="synthetic_complete"?"synthetic fixture only":"unknown",activity:evidenceCase==="synthetic_complete"?"synthetic fixture only":"unknown",ml:"unavailable"},review,now);
}
export async function checkSandboxWeather(workerId:string,policyId:string,now=Date.now(),fetcher:typeof fetch=fetch){
 const p=await ownedActive(workerId,policyId,now),q=JSON.parse(p.quote_json),location=resolveEnvironmentLocation(q.inputs.city);if(!location)throw new SandboxError("Supported city coordinates unavailable",422);
 const data=await fetchEnvironment(location,fetcher,now),claims=[];const w=data.weather;
 if(w?.rainfall1h!=null&&w.rainfall1h>=TRIGGER_RULES.rainfallHourlyMm&&typeof w.rainObservedAt==="string"&&Date.parse(w.rainObservedAt)-3600000>=p.starts_at&&Date.parse(w.rainObservedAt)<p.ends_at&&scheduled(p,Date.parse(w.rainObservedAt)-3600000)&&scheduled(p,Date.parse(w.rainObservedAt)-1))claims.push(await recordEvent(workerId,p,"heavy_rain","open-meteo-modelled",Date.parse(w.rainObservedAt),data,["City-center model cannot verify precise work zone.","Platform activity and actual income-loss evidence are unavailable.","Client GPS alone does not prove spoof resistance. ML unavailable."],now));
 if(w?.temperature!=null&&w.temperature>=TRIGGER_RULES.temperatureC&&typeof w.observedAt==="string"&&Date.parse(w.observedAt)>=p.starts_at&&Date.parse(w.observedAt)<p.ends_at&&scheduled(p,Date.parse(w.observedAt)))claims.push(await recordEvent(workerId,p,"heatwave","open-meteo-modelled",Date.parse(w.observedAt),data,["City-center model cannot verify precise work zone.","Platform activity and actual income-loss evidence are unavailable.","Client GPS alone does not prove spoof resistance. ML unavailable."],now));
 return {status:data.status,claims,environment:data,message:claims.length?"Sandbox claims require evidence review, no automatic approval.":"No in-window rain/heat threshold claim. Unknown data is not proof of no disruption.",financialEffect:false};
}
export async function settleSandbox(workerId:string,claimId:string){const db=getDb(),c=await db.prepare("SELECT c.*,e.source FROM sandbox_claims c JOIN sandbox_events e ON e.id=c.event_id WHERE c.id=? AND c.worker_id=?").get(claimId,workerId);if(!c)throw new SandboxError("Sandbox claim not found",404);if(!["scenario_approved","simulated_settled"].includes(c.status)||c.source!=="manual_simulation:synthetic_complete")throw new SandboxError("Missing/real-world evidence cannot be bypassed. Only the labelled synthetic complete scenario can settle.");
 const id=`sbr_${hash(claimId).slice(0,32)}`;
 // Updating parent row first locks/serializes the per-policy limit on Postgres and SQLite.
 await db.batch([
  {query:"UPDATE sandbox_policies SET status=status WHERE id=? AND worker_id=?",params:[c.policy_id,workerId]},
  {query:"INSERT INTO sandbox_receipts (id,worker_id,policy_id,claim_id,amount_simulated) SELECT ?,?,?,?,CASE WHEN p.weekly_limit-COALESCE((SELECT SUM(amount_simulated) FROM sandbox_receipts WHERE policy_id=p.id),0)<=0 THEN 0 WHEN p.weekly_limit-COALESCE((SELECT SUM(amount_simulated) FROM sandbox_receipts WHERE policy_id=p.id),0)<? THEN p.weekly_limit-COALESCE((SELECT SUM(amount_simulated) FROM sandbox_receipts WHERE policy_id=p.id),0) ELSE ? END FROM sandbox_policies p WHERE p.id=? AND p.worker_id=? AND EXISTS (SELECT 1 FROM sandbox_claims WHERE id=? AND worker_id=? AND status='scenario_approved') ON CONFLICT DO NOTHING",params:[id,workerId,c.policy_id,claimId,c.amount_simulated,c.amount_simulated,c.policy_id,workerId,claimId,workerId]},
  {query:"UPDATE sandbox_claims SET status='simulated_settled' WHERE id=? AND worker_id=? AND EXISTS (SELECT 1 FROM sandbox_receipts WHERE claim_id=?)",params:[claimId,workerId,claimId]}
 ]);const receipt=await db.prepare("SELECT * FROM sandbox_receipts WHERE claim_id=? AND worker_id=?").get(claimId,workerId);if(!receipt)throw new SandboxError("Receipt not saved. Retry the same claim.");return receipt;
}
