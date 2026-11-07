import { getDb } from "../models/db";
export function safeRatio(numerator:number, denominator:number) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0 ? numerator / denominator : null;
}
// Aggregate at the owning ledger. Do not conflate face premiums, approval labels
// or sandbox amounts with paid records. All-time recorded status, not cashflow.
export async function recordMetrics(workerId?:string) {
  const db = getDb(), where = workerId ? " WHERE worker_id=?" : "", params = workerId ? [workerId] : [];
  const totals = async(table:string,fields:string) => db.prepare(`SELECT ${fields} FROM ${table}${where}`).get(...params);
  const policies = await totals("policies", "COUNT(*) n, COALESCE(SUM(CASE WHEN status='active' THEN 1 ELSE 0 END),0) active");
  const claims = await totals("claims", "COUNT(*) n, COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) paid");
  const payments = await totals("premium_payments", "COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) paid");
  const sandboxPolicies = await totals("sandbox_policies", "COUNT(*) n, COALESCE(SUM(premium_simulated),0) premium");
  const sandboxClaims = await totals("sandbox_claims", "COUNT(*) n, COALESCE(SUM(CASE WHEN status='review' THEN 1 ELSE 0 END),0) review");
  const receipts = await totals("sandbox_receipts", "COUNT(*) n, COALESCE(SUM(amount_simulated),0) amount");
  const paidPremium = Number(payments.paid), paidClaims = Number(claims.paid);
  return {
    scope: workerId ? "your account" : "all accounts - administrator only", period:"all-time recorded statuses", asOf:new Date().toISOString(), financialServicesEnabled:false,
    live:{policyRecords:Number(policies.n),activeStatusRecords:Number(policies.active),claimRecords:Number(claims.n),paidPremiumRecorded:paidPremium,paidClaimsRecorded:paidClaims,lossRatio:safeRatio(paidClaims,paidPremium)},
    sandbox:{policyRecords:Number(sandboxPolicies.n),claimRecords:Number(sandboxClaims.n),reviewRecords:Number(sandboxClaims.review),receiptRecords:Number(receipts.n),premiumsSimulated:Number(sandboxPolicies.premium),receiptsSimulated:Number(receipts.amount)},
    limitations:["These are persisted records, not independently verified bank transfers or insurance cover.","Paid premium uses payment ledger status, not policy face value. Loss ratio is unavailable when denominator is zero.","All-time recorded statuses are not a matched-period actuarial loss ratio or forecast.","Sandbox amounts never count as live money. No forecast, trained model accuracy or fraud confidence is supplied."]
  };
}
