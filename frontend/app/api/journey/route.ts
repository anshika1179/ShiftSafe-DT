import { NextRequest, NextResponse } from "next/server";
import { quoteFingerprint } from "@/backend/engines/historical-quote";
import { getDb } from "@/backend/models/db";
import { authorizeWorker } from "@/lib/server/authorization";
import { isJourneyStep, canAdvanceJourney, type JourneyStep } from "@/lib/shared/journey";

export async function GET(req: NextRequest) {
  const auth = await authorizeWorker(req);
  if (auth.response) return auth.response;
  const db = getDb();
  await db.prepare("INSERT INTO worker_journeys (worker_id, step) VALUES (?, ?) ON CONFLICT DO NOTHING").run(auth.workerId, "profile");
  const journey = await db.prepare("SELECT step, eligibility_json FROM worker_journeys WHERE worker_id = ?").get(auth.workerId);
  const worker = await db.prepare("SELECT name, platform, city, zone, avg_weekly_income, active_delivery_days, days_worked_this_week, insurance_opted_out FROM workers WHERE id = ?").get(auth.workerId);
  const consents = await db.prepare("SELECT gps_location, bank_upi, platform_activity, recorded_at FROM registration_consents WHERE worker_id = ?").get(auth.workerId);
  const contact = await db.prepare("SELECT phone_verified FROM worker_contacts WHERE worker_id = ?").get(auth.workerId);
  const policy = await db.prepare("SELECT id, weekly_premium, max_coverage_per_week, status FROM policies WHERE worker_id = ? ORDER BY created_at DESC LIMIT 1").get(auth.workerId);
  const snapshot = await db.prepare("SELECT result_json, created_at FROM quote_snapshots WHERE worker_id = ?").get(auth.workerId);
  let quote = null;
  try {
    const result=snapshot?.result_json?JSON.parse(snapshot.result_json):null;
    if(result?.assumptions?.version === "weather-proxy-2026-10-06" && result?.inputs && quoteFingerprint({...result.inputs,city:worker.city,zone:worker.zone,platform:worker.platform,income:Number(worker.avg_weekly_income)})===quoteFingerprint(result.inputs)) quote={...result,calculatedAt:snapshot.created_at};
  }catch { /* Invalid/stale snapshots are never priced by fallback. */ }
  const eligibility={eligible:false,reason:worker.insurance_opted_out?"You chose not to request insurance.":"Food-delivery prototype participation only. Government scheme eligibility and insurer underwriting have not been verified.",warnings:["Lifetime delivery days do not establish 90/120 financial-year eligibility. No legal entitlement or insurance offer is made."]};
  return NextResponse.json({ step: isJourneyStep(journey?.step) ? journey.step : "profile", worker, consents: consents || null, phoneVerified: contact?.phone_verified === 1, eligibility, quote, policy: policy || null, mode: "prototype", financialServicesEnabled: false }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== req.nextUrl.origin) return NextResponse.json({ error: "Invalid journey origin" }, { status: 403 });
  const auth = await authorizeWorker(req);
  if (auth.response) return auth.response;
  let next: unknown;
  try { next = (await req.json()).step; } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  if (!isJourneyStep(next)) return NextResponse.json({ error: "Unknown journey step" }, { status: 400 });
  const db = getDb();
  await db.prepare("INSERT INTO worker_journeys (worker_id, step) VALUES (?, ?) ON CONFLICT DO NOTHING").run(auth.workerId, "profile");
  const row = await db.prepare("SELECT step FROM worker_journeys WHERE worker_id = ?").get(auth.workerId);
  const current: JourneyStep = isJourneyStep(row.step) ? row.step : "profile";
  if (next === current) return NextResponse.json({ step: current });
  if (!canAdvanceJourney(current, next)) return NextResponse.json({ error: "Review each step in order before continuing", step: current }, { status: 409 });
  const update = await db.prepare("UPDATE worker_journeys SET step = ?, updated_at = CURRENT_TIMESTAMP WHERE worker_id = ? AND step = ?").run(next, auth.workerId, current);
  if (update.changes !== 1) return NextResponse.json({ error: "Journey changed in another window. Reload to continue." }, { status: 409 });
  return NextResponse.json({ step: next, financialServicesEnabled: false });
}
