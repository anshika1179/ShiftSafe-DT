import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/backend/models/db";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "@/lib/server/admin-auth";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token || !verifyAdminSessionToken(token)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const requestId = req.nextUrl.searchParams.get("requestId")?.trim();
  if (!requestId || requestId.length > 200) return NextResponse.json({ error: "requestId is required" }, { status: 400 });
  try {
    const db = getDb();
    if (!await db.prepare("SELECT id FROM service_requests WHERE id = ?").get(requestId)) return NextResponse.json({ error: "Service request not found" }, { status: 404 });
    const events = await db.prepare("SELECT * FROM service_request_history WHERE request_id = ? ORDER BY revision DESC LIMIT 100").all(requestId);
    const total = Number((await db.prepare("SELECT COUNT(*) AS n FROM service_request_history WHERE request_id = ?").get(requestId)).n);
    return NextResponse.json({ events, total, limit: 100 }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Change history could not load. Retry." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
