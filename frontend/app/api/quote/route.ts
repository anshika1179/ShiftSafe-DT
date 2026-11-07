import {NextRequest,NextResponse} from "next/server";
import {authorizeWorker} from "@/lib/server/authorization";
import {getDb} from "@/backend/models/db";
import {historicalQuote,quoteFingerprint,validQuoteInputs} from "@/backend/engines/historical-quote";
import {consumeRateLimit} from "@/lib/server/rate-limit";
export async function POST(req:NextRequest){
 if(req.headers.get("origin")!==req.nextUrl.origin)return NextResponse.json({error:"Invalid quote origin"},{status:403});
 const auth=await authorizeWorker(req);if(auth.response)return auth.response;
 if(!consumeRateLimit(`quote:${auth.workerId}`,6,3600000).allowed)return NextResponse.json({error:"Quote limit reached. Try later."},{status:429});
 let body;try{body=await req.json();}catch{return NextResponse.json({error:"Invalid schedule"},{status:400});}
 const db=getDb(),w=await db.prepare("SELECT city,zone,platform,avg_weekly_income FROM workers WHERE id = ?").get(auth.workerId);
 const input={city:w.city,zone:w.zone,platform:w.platform,income:Number(w.avg_weekly_income),weekdays:body.weekdays,startHour:body.startHour,endHour:body.endHour};
 if(!validQuoteInputs(input))return NextResponse.json({error:"Select actual weekdays and a valid same-day work-hour window"},{status:400});
 const fingerprint=quoteFingerprint(input),result=await historicalQuote(input);
 // Recheck profile after slow provider call. Never save a quote against changed work details.
 const latest=await db.prepare("SELECT city,zone,platform,avg_weekly_income FROM workers WHERE id = ?").get(auth.workerId);
 if(quoteFingerprint({...input,city:latest.city,zone:latest.zone,platform:latest.platform,income:Number(latest.avg_weekly_income)})!==fingerprint)return NextResponse.json({error:"Profile changed while calculating. Retry."},{status:409});
 await db.prepare("INSERT INTO quote_snapshots (worker_id,input_fingerprint,result_json) VALUES (?,?,?) ON CONFLICT (worker_id) DO UPDATE SET input_fingerprint=EXCLUDED.input_fingerprint,result_json=EXCLUDED.result_json,created_at=CURRENT_TIMESTAMP").run(auth.workerId,fingerprint,JSON.stringify(result));
 return NextResponse.json(result);
}
