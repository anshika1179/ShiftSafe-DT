import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/backend/models/db";
import { authorizeWorker } from "@/lib/server/authorization";
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== req.nextUrl.origin) return NextResponse.json({ error: "Invalid profile origin" }, { status: 403 });
  const auth = await authorizeWorker(req);
  if (auth.response) return auth.response;
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid profile" }, { status: 400 }); }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const zone = typeof body.zone === "string" ? body.zone.trim() : "";
  const city = typeof body.city === "string" ? body.city.trim() : "";
  const income = Number(body.avgWeeklyIncome), days = Number(body.daysWorkedThisWeek), lifetime = Number(body.totalActiveDeliveryDays);
  if (name.length < 2 || name.length > 80 || city.length < 2 || city.length > 60 || zone.length < 2 || zone.length > 80 || !["Zomato", "Swiggy"].includes(body.platform) || body.avgWeeklyIncome === "" || !Number.isFinite(income) || income < 500 || income > 50000 || body.daysWorkedThisWeek === "" || !Number.isInteger(days) || days < 0 || days > 7 || body.totalActiveDeliveryDays === "" || !Number.isInteger(lifetime) || lifetime < 0 || lifetime > 36500) return NextResponse.json({ error: "Enter valid food-delivery work details, income (500-50000), weekly days (0-7) and lifetime days." }, { status: 400 });
  const db = getDb();
  const prior = await db.prepare("SELECT step, eligibility_json FROM worker_journeys WHERE worker_id = ?").get(auth.workerId);
  // Existing policy and financial records stay untouched. Their quote is no longer a current profile assessment.
  await db.batch([
    {query:"DELETE FROM quote_snapshots WHERE worker_id = ?",params:[auth.workerId]},
    { query: "UPDATE workers SET name = ?, platform = ?, city = ?, zone = ?, avg_weekly_income = ?, days_worked_this_week = ?, active_delivery_days = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", params: [name, body.platform, city, zone, income, days, lifetime, auth.workerId] },
    { query: "INSERT INTO worker_journeys (worker_id, step, eligibility_json) VALUES (?, ?, ?) ON CONFLICT (worker_id) DO UPDATE SET step = EXCLUDED.step, eligibility_json = EXCLUDED.eligibility_json, updated_at = CURRENT_TIMESTAMP", params: [auth.workerId, "profile", JSON.stringify({ eligible: false, assessmentUnavailable: true, quoteInvalidated: true, reason: "Work details changed. The prior eligibility and quote do not assess this profile. Calculate a new historical estimate with your actual schedule.", previousStep: prior?.step || null })] },
  ]);
  return NextResponse.json({ saved: true, step: "profile", financialServicesEnabled: false });
}
