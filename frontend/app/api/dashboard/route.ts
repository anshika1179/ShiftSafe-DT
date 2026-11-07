import {NextRequest,NextResponse} from "next/server";
import {authorizeAdmin} from "@/lib/server/authorization";
import {recordMetrics} from "@/backend/services/record-metrics";
export async function GET(req:NextRequest){const unauthorized=authorizeAdmin(req);if(unauthorized)return unauthorized;return NextResponse.json(await recordMetrics(),{headers:{"Cache-Control":"no-store"}});}
