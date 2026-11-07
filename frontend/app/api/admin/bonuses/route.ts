// GET /api/admin/bonuses — List all risk bonuses
// POST /api/admin/bonuses — Create a new risk bonus for a worker
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/backend/models/db";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-auth";

function isAdminAuthenticated(req: NextRequest): boolean {
  const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  return token ? verifyAdminSessionToken(token) : false;
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthenticated(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();

  const bonuses = await db
    .prepare(
      `SELECT rb.*, w.name as worker_name, w.phone as worker_phone, w.platform, w.city, w.zone
       FROM risk_bonuses rb
       JOIN workers w ON w.id = rb.worker_id
       ORDER BY rb.created_at DESC
       LIMIT 100`,
    )
    .all();

  const totalPaid = (await db
    .prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM risk_bonuses WHERE status = 'paid'",
    )
    .get()) as { total: number };

  const totalPending = (await db
    .prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM risk_bonuses WHERE status = 'pending'",
    )
    .get()) as { total: number };

  const totalCount = (await db
    .prepare("SELECT COUNT(*) as cnt FROM risk_bonuses")
    .get()) as { cnt: number };

  return NextResponse.json({
    bonuses,
    summary: {
      totalPaid: totalPaid.total,
      totalPending: totalPending.total,
      count: Number(totalCount.cnt || 0),
    },
  });
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthenticated(req)) return NextResponse.json({error:"Unauthorized"},{status:401});
  return NextResponse.json({error:"Live bonus creation is disabled. No priced commitment or payment was created."},{status:503});
}
export async function PATCH(req: NextRequest) {
  if (!isAdminAuthenticated(req)) return NextResponse.json({error:"Unauthorized"},{status:401});
  return NextResponse.json({error:"Bonus payment approval is disabled until verified settlement is configured. No paid status was written."},{status:503});
}
