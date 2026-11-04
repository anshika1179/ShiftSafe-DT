import { NextRequest, NextResponse } from "next/server";
import { fetchEnvironment, resolveEnvironmentLocation } from "@/backend/services/environment";
import { consumeRateLimit, getClientIp } from "@/lib/server/rate-limit";
export async function GET(req: NextRequest) {
  if (!consumeRateLimit(`weather:${getClientIp(req)}`,60,5*60000).allowed) return NextResponse.json({error:"Too many weather requests"},{status:429});
  const params=req.nextUrl.searchParams;
  const location=resolveEnvironmentLocation(params.get("city")||"",params.has("lat")?params.get("lat"):undefined,params.has("lon")?params.get("lon"):undefined);
  if (!location) return NextResponse.json({error:"Choose a supported city or provide valid latitude and longitude. Unknown places are never replaced with Mumbai."},{status:400});
  const data=await fetchEnvironment(location);
  return NextResponse.json(data,{status:data.status==="unavailable"?503:200});
}
