import {NextRequest,NextResponse} from "next/server";
import {authorizeWorker} from "@/lib/server/authorization";
import {recordMetrics} from "@/backend/services/record-metrics";
export async function GET(req:NextRequest){const auth=await authorizeWorker(req,req.nextUrl.searchParams.get("workerId"));if(auth.response)return auth.response;return NextResponse.json(await recordMetrics(auth.workerId),{headers:{"Cache-Control":"no-store"}});}
