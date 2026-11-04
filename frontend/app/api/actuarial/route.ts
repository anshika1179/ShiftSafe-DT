import {NextRequest,NextResponse} from "next/server";
import {authorizeAdmin} from "@/lib/server/authorization";
import {recordMetrics} from "@/backend/services/record-metrics";
export async function GET(req:NextRequest){const unauthorized=authorizeAdmin(req);if(unauthorized)return unauthorized;return NextResponse.json({...await recordMetrics(),status:"unvalidated",forecast:null,stressTests:null,reason:"No calibrated loss dataset or validated actuarial model. Recorded ratio only."});}
export async function POST(req:NextRequest){const unauthorized=authorizeAdmin(req);if(unauthorized)return unauthorized;return NextResponse.json({error:"Unvalidated stress simulations are retired. No synthetic results will be persisted as actual metrics."},{status:503});}
