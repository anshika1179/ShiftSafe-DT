// GET /api/premium?workerId=...&zone=...&shift=...&forecast=...&city=...
import { NextRequest, NextResponse } from 'next/server';
import { calculateDynamicPremium } from '@/backend/engines/premium-engine';
import { getDb } from '@/backend/models/db';

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
  const workerId = sp.get('workerId');
  const zone = sp.get('zone') || 'Andheri West';
  const shift = sp.get('shift') || 'full_day';
  const forecast = (sp.get('forecast') || 'clear') as string;
  const income = parseFloat(sp.get('income') || '4000');
  const city = sp.get('city') || 'Mumbai';

  let pastClaims = 0;
  let workerCity = city;
  let daysWorked = 6;
  let activeDays = 14;
  let platform = 'Zomato';

  if (workerId) {
    const db = getDb();
    const row = await db.prepare('SELECT COUNT(*) as cnt FROM claims WHERE worker_id = ?').get(workerId) as { cnt: number } | undefined;
    pastClaims = row?.cnt || 0;

    // Get worker details for accurate pricing
    const worker = await db.prepare('SELECT avg_weekly_income, city, zone, days_worked_this_week, active_delivery_days, platform FROM workers WHERE id = ?')
      .get(workerId) as WorkerRow | undefined;
    if (worker) {
      workerCity = worker.city;
      daysWorked = worker.days_worked_this_week || 6;
      activeDays = worker.active_delivery_days || 14;
      platform = worker.platform || 'Zomato';
    }
  }

  const result = await calculateDynamicPremium(
    income, zone, shift, pastClaims, forecast,
    platform, workerCity, daysWorked, activeDays,
  );

  return NextResponse.json(result);
}
