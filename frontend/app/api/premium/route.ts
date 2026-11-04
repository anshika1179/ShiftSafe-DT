import { NextRequest, NextResponse } from "next/server";
import { authorizeWorker } from "@/lib/server/authorization";
import { quoteFingerprint } from "@/backend/engines/historical-quote";
import { getDb } from "@/backend/models/db";
// Legacy parameter-pricing is removed. Only an authenticated persisted quote is returned.
export async function GET(req: NextRequest) {
 const auth=await authorizeWorker(req,req.nextUrl.searchParams.get("workerId")||undefined);if(auth.response)return auth.response;
 const row=await getDb().prepare("SELECT result_json,created_at FROM quote_snapshots WHERE worker_id = ?").get(auth.workerId);
 const w=await getDb().prepare("SELECT city,zone,platform,avg_weekly_income FROM workers WHERE id = ?").get(auth.workerId);
 let quote=null;try{const result=row?JSON.parse(row.result_json):null;if(result?.assumptions?.version === "weather-proxy-2026-10-06"&&result?.inputs&&quoteFingerprint({...result.inputs,city:w.city,zone:w.zone,platform:w.platform,income:Number(w.avg_weekly_income)})===quoteFingerprint(result.inputs))quote=result;}catch{}
 return NextResponse.json({status:quote?.status||"schedule_required",quote,calculatedAt:row?.created_at||null,reason:"Parameter-only pricing and fixed city tiers have been retired. Calculate a historical weather proxy estimate in your journey.",financialEffect:false},{headers:{"Cache-Control":"no-store"}});
}
