// GET /api/premium?workerId=...&zone=...&shift=...&forecast=...&city=...
import { NextRequest, NextResponse } from "next/server";
import { calculateDynamicPremium } from "@/backend/engines/premium-engine";
import { getDb } from "@/backend/models/db";

interface WorkerRow {
  avg_weekly_income: number;
  city: string;
  zone: string;
  days_worked_this_week: number;
  active_delivery_days: number;
  platform: string;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const workerId = sp.get("workerId")?.trim() || null;
  const zone =
    (sp.get("zone") || "Andheri West").trim().slice(0, 80) || "Andheri West";
  const shift =
    (sp.get("shift") || "full_day").trim().slice(0, 32) || "full_day";
  const forecast = (sp.get("forecast") || "clear") as string;
  const parsedIncome = parseFloat(sp.get("income") || "4000");
  const income = Number.isFinite(parsedIncome)
    ? Math.max(500, Math.min(50000, parsedIncome))
    : 4000;
  const city = (sp.get("city") || "Mumbai").trim().slice(0, 60) || "Mumbai";
  const platformParam =
    (sp.get("platform") || "Zomato").trim().slice(0, 40) || "Zomato";
  const parsedClaimsHistory = Number.parseInt(
    sp.get("claimsHistory") || "0",
    10,
  );
  const parsedDaysWorked = Number.parseInt(sp.get("daysWorked") || "6", 10);
  const parsedActiveDays = Number.parseInt(sp.get("activeDays") || "14", 10);

  let pastClaims = Number.isFinite(parsedClaimsHistory)
    ? Math.max(0, Math.min(30, parsedClaimsHistory))
    : 0;
  let workerCity = city;
  let daysWorked = Number.isFinite(parsedDaysWorked)
    ? Math.max(1, Math.min(7, parsedDaysWorked))
    : 6;
  let activeDays = Number.isFinite(parsedActiveDays)
    ? Math.max(1, Math.min(365, parsedActiveDays))
    : 14;
  let platform = platformParam;

  if (workerId) {
    const db = getDb();
    const row = (await db
      .prepare("SELECT COUNT(*) as cnt FROM claims WHERE worker_id = ?")
      .get(workerId)) as { cnt: number } | undefined;
    pastClaims = row?.cnt || 0;

    // Get worker details for accurate pricing
    const worker = (await db
      .prepare(
        "SELECT avg_weekly_income, city, zone, days_worked_this_week, active_delivery_days, platform FROM workers WHERE id = ?",
      )
      .get(workerId)) as WorkerRow | undefined;
    if (worker) {
      workerCity = worker.city;
      daysWorked = worker.days_worked_this_week || 6;
      activeDays = worker.active_delivery_days || 14;
      platform = worker.platform || "Zomato";
    }
  }

  const result = await calculateDynamicPremium(
    income,
    zone,
    shift,
    pastClaims,
    forecast,
    platform,
    workerCity,
    daysWorked,
    activeDays,
  );

  return NextResponse.json(result);
}
