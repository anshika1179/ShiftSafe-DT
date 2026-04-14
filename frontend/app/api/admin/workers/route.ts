// GET /api/admin/workers — List all workers with policy/claim stats for admin
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

  const workers = await db
    .prepare(
      `SELECT 
         w.id, w.name, w.phone, w.email, w.platform, w.city, w.zone,
         w.avg_weekly_income, w.vehicle_type, w.risk_score, w.status,
         w.insurance_opted_out, w.active_delivery_days, w.days_worked_this_week,
         w.activity_tier, w.created_at,
         p.id as policy_id, p.plan_name, p.premium_tier, p.weekly_premium,
         p.max_coverage_per_week, p.status as policy_status,
         (SELECT COUNT(*) FROM claims c WHERE c.worker_id = w.id) as total_claims,
         (SELECT COUNT(*) FROM claims c WHERE c.worker_id = w.id AND c.status IN ('auto_approved','paid')) as approved_claims,
         (SELECT COALESCE(SUM(c.amount), 0) FROM claims c WHERE c.worker_id = w.id AND c.status IN ('auto_approved','paid')) as total_payouts,
         (SELECT COALESCE(SUM(rb.amount), 0) FROM risk_bonuses rb WHERE rb.worker_id = w.id AND rb.status = 'paid') as total_bonuses
       FROM workers w
       LEFT JOIN policies p ON p.worker_id = w.id AND p.status = 'active'
       ORDER BY w.created_at DESC
       LIMIT 200`,
    )
    .all();

  return NextResponse.json({ workers });
}
