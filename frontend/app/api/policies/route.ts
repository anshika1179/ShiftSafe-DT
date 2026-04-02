// GET /api/policies?workerId=...  — Get worker's policies
// POST /api/policies — not used (created during registration)
// PATCH /api/policies — update auto_renew status or cancel policy (opt-out)
// DELETE /api/policies — cancel/opt-out of insurance
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/backend/models/db';

interface PolicyRow {
  id: string;
  worker_id: string;
  plan_name: string;
  coverage_type: string;
  premium_tier: string;
  weekly_premium: number;
  max_coverage_per_week: number;
  max_payout_percent: number;
  coverage_events: string;
  status: string;
  start_date: string;
  end_date: string | null;
  auto_renew: number;
  city_pool: string;
  created_at: string;
}

export async function GET(req: NextRequest) {
  const workerId = req.nextUrl.searchParams.get('workerId');

  const db = getDb();

  let rows: PolicyRow[];
  if (workerId) {
    rows = await db.prepare('SELECT * FROM policies WHERE worker_id = ? ORDER BY created_at DESC').all(workerId) as PolicyRow[];
  } else {
    rows = await db.prepare('SELECT * FROM policies ORDER BY created_at DESC LIMIT 50').all() as PolicyRow[];
  }

  const policies = rows.map((r) => ({
    ...r,
    coverageEvents: JSON.parse(r.coverage_events),
    autoRenew: !!r.auto_renew,
    premiumTier: r.premium_tier || 'standard',
    maxPayoutPercent: r.max_payout_percent || 50,
    cityPool: r.city_pool || 'mumbai_rain',
  }));

  return NextResponse.json({ policies });
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { policyId, autoRenew, action } = body;

    if (!policyId) {
      return NextResponse.json({ error: 'Policy ID required' }, { status: 400 });
    }

    const db = getDb();

    // cancel / opt-out action
    if (action === 'cancel' || action === 'opt_out') {
      const stmt = await db.prepare('UPDATE policies SET status = ?, auto_renew = 0, end_date = date(\'now\') WHERE id = ?');
      const result = stmt.run('cancelled', policyId);

      if (result.changes === 0) {
        return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
      }

      // Also mark worker as opted out
      const policy = await db.prepare('SELECT worker_id FROM policies WHERE id = ?').get(policyId) as { worker_id: string } | undefined;
      if (policy) {
        await db.prepare('UPDATE workers SET insurance_opted_out = 1 WHERE id = ?').run(policy.worker_id);
      }

      return NextResponse.json({
        success: true,
        policyId,
        status: 'cancelled',
        message: 'Insurance coverage cancelled. Worker can re-enroll at any time.',
      });
    }

    // re-activate action
    if (action === 'reactivate') {
      const stmt = await db.prepare('UPDATE policies SET status = ?, auto_renew = 1, end_date = NULL WHERE id = ?');
      const result = stmt.run('active', policyId);

      if (result.changes === 0) {
        return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
      }

      const policy = await db.prepare('SELECT worker_id FROM policies WHERE id = ?').get(policyId) as { worker_id: string } | undefined;
      if (policy) {
        await db.prepare('UPDATE workers SET insurance_opted_out = 0 WHERE id = ?').run(policy.worker_id);
      }

      return NextResponse.json({
        success: true,
        policyId,
        status: 'active',
        message: 'Insurance coverage reactivated.',
      });
    }

    // toggle auto-renew
    if (autoRenew !== undefined) {
      const stmt = await db.prepare('UPDATE policies SET auto_renew = ? WHERE id = ?');
      const result = stmt.run(autoRenew ? 1 : 0, policyId);

      if (result.changes === 0) {
        return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
      }

      return NextResponse.json({ success: true, policyId, autoRenew });
    }

    return NextResponse.json({ error: 'No valid action specified' }, { status: 400 });
  } catch (error) {
    console.error('Failed to update policy:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
