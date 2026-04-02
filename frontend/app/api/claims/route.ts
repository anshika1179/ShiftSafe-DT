// GET /api/claims?workerId=...  — Get claims for a worker
// POST /api/claims — Create claim from trigger (with settlement)
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/backend/models/db';
import { detectFraudForDemo } from '@/backend/engines/fraud-engine';
import { processSettlement } from '@/backend/engines/settlement-engine';

interface ClaimRow {
  id: string;
  policy_id: string;
  worker_id: string;
  trigger_type: string;
  trigger_description: string;
  amount: number;
  status: string;
  zone: string;
  payout_method: string;
  payout_channel: string;
  settlement_status: string;
  created_at: string;
  processed_at: string | null;
}

export async function GET(req: NextRequest) {
  const workerId = req.nextUrl.searchParams.get('workerId');
  const db = getDb();

  let rows: ClaimRow[];
  if (workerId) {
    rows = await db.prepare('SELECT * FROM claims WHERE worker_id = ? ORDER BY created_at DESC').all(workerId) as ClaimRow[];
  } else {
    rows = await db.prepare('SELECT * FROM claims ORDER BY created_at DESC LIMIT 100').all() as ClaimRow[];
  }

  return NextResponse.json({ claims: rows });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { workerId, triggerType, severity, zone } = body;

    if (!workerId || !triggerType) {
      return NextResponse.json({ error: 'workerId and triggerType required' }, { status: 400 });
    }

    const db = getDb();

    // Get active policy for this worker
    const policy = await db.prepare(
      'SELECT id, max_coverage_per_week, max_payout_percent, weekly_premium FROM policies WHERE worker_id = ? AND status = ? LIMIT 1'
    ).get(workerId, 'active') as { id: string; max_coverage_per_week: number; max_payout_percent: number; weekly_premium: number } | undefined;

    if (!policy) {
      return NextResponse.json({ error: 'No active policy found' }, { status: 404 });
    }

    // Get worker info
    const worker = await db.prepare('SELECT avg_weekly_income, insurance_opted_out FROM workers WHERE id = ?')
      .get(workerId) as { avg_weekly_income: number; insurance_opted_out: number } | undefined;

    if (!worker || worker.insurance_opted_out) {
      return NextResponse.json({ error: 'Worker has opted out of insurance' }, { status: 403 });
    }

    // Check weekly claim limit
    const weekClaims = await db.prepare(
      `SELECT COALESCE(SUM(amount), 0) as total FROM claims 
       WHERE worker_id = ? AND created_at >= datetime('now', '-7 days')`
    ).get(workerId) as { total: number };

    const PAYOUT_TABLE: Record<string, Record<string, number>> = {
      heavy_rain: { moderate: 100, high: 200, severe: 350 },
      heatwave: { moderate: 80, high: 150, severe: 250 },
      pollution: { moderate: 60, high: 120, severe: 200 },
      platform_outage: { moderate: 100, high: 200, severe: 300 },
      curfew: { moderate: 200, high: 350, severe: 500 },
    };

    const sev = severity || 'high';
    let amount = PAYOUT_TABLE[triggerType]?.[sev] || 100;

    // Apply 50% maximum payout cap
    const maxPayout = Math.round(worker.avg_weekly_income * 0.50);
    amount = Math.min(amount, maxPayout);

    if (weekClaims.total + amount > policy.max_coverage_per_week) {
      return NextResponse.json({
        error: 'Weekly coverage limit reached',
        weeklyUsed: weekClaims.total,
        maxCoverage: policy.max_coverage_per_week,
      }, { status: 422 });
    }

    // fraud check (before payment, not after)
    const fraudResult = detectFraudForDemo(1);

    if (fraudResult.decision === 'BLOCKED') {
      return NextResponse.json({
        error: 'Claim blocked by fraud detection',
        fraudScore: fraudResult.score,
        fraudLabel: fraudResult.label,
        flags: fraudResult.flags,
      }, { status: 403 });
    }

    const claimId = crypto.randomUUID();
    const description = `${triggerType.replace(/_/g, ' ')} — ${sev} severity — auto-triggered in ${zone || 'zone'}`;

    // process settlement
    const settlement = processSettlement({
      claimId,
      workerId,
      amount,
      maxPayoutCap: maxPayout,
      upiId: 'worker@upi', // in production, fetch from worker profile
    });

    // Save claim
    await db.prepare(`INSERT INTO claims (id, policy_id, worker_id, trigger_type, trigger_description, amount, status, zone, payout_method, payout_channel, settlement_status, evidence_data, processed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`).run(
      claimId, policy.id, workerId, triggerType, description,
      settlement.cappedAmount,
      fraudResult.decision === 'REVIEW' ? 'review' : 'auto_approved',
      zone || 'Andheri West',
      settlement.channel,
      settlement.channel,
      settlement.status,
      JSON.stringify({ fraudScore: fraudResult.score, fraudLabel: fraudResult.label, settlement: settlement.settlementId }),
    );

    // Save settlement record
    await db.prepare(`INSERT INTO settlements (id, claim_id, worker_id, amount, channel, upi_id, status, completed_at, transaction_ref)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`).run(
      settlement.settlementId, claimId, workerId,
      settlement.cappedAmount, settlement.channel,
      'worker@upi', settlement.status, settlement.transactionRef,
    );

    return NextResponse.json({
      success: true,
      claimId,
      amount: settlement.cappedAmount,
      maxPayoutCap: maxPayout,
      status: 'auto_approved',
      message: `₹${settlement.cappedAmount} payout auto-approved and sent via ${settlement.channel}`,
      settlement: {
        id: settlement.settlementId,
        channel: settlement.channel,
        transactionRef: settlement.transactionRef,
        estimatedTime: settlement.estimatedTime,
        timeline: settlement.timeline,
      },
      fraud: {
        score: fraudResult.score,
        label: fraudResult.label,
        decision: fraudResult.decision,
      },
    });
  } catch (err) {
    console.error('Claim creation error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
