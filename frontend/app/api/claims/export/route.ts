// GET /api/claims/export?workerId=...&format=csv
// Server-side claim history export from the database.
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/backend/models/db';

interface ClaimExportRow {
  id: string;
  worker_id: string;
  trigger_type: string;
  trigger_description: string;
  amount: number;
  status: string;
  zone: string;
  payout_channel: string;
  settlement_status: string;
  evidence_data: string | null;
  created_at: string;
  processed_at: string | null;
}

interface WorkerRow {
  name: string;
  phone: string;
  platform: string;
  city: string;
}

export async function GET(req: NextRequest) {
  const workerId = req.nextUrl.searchParams.get('workerId');
  if (!workerId) {
    return NextResponse.json(
      { error: 'workerId query parameter is required' },
      { status: 400 },
    );
  }

  const db = getDb();

  // get worker info for the header
  const worker = (await db
    .prepare('SELECT name, phone, platform, city FROM workers WHERE id = ?')
    .get(workerId)) as WorkerRow | undefined;

  const rows = (await db
    .prepare(
      'SELECT id, worker_id, trigger_type, trigger_description, amount, status, zone, payout_channel, settlement_status, evidence_data, created_at, processed_at FROM claims WHERE worker_id = ? ORDER BY created_at DESC',
    )
    .all(workerId)) as ClaimExportRow[];

  const totalPaid = rows
    .filter((r) => r.status === 'paid' || r.status === 'auto_approved')
    .reduce((s, r) => s + r.amount, 0);

  const headers = [
    'Claim ID',
    'Date',
    'Trigger Type',
    'Description',
    'Amount (INR)',
    'Status',
    'Zone',
    'Payout Channel',
    'Settlement Status',
    'Fraud Score',
    'Processed At',
  ];

  const csvRows = rows.map((r) => {
    let fraudScore = '—';
    try {
      if (r.evidence_data) {
        const parsed = JSON.parse(r.evidence_data);
        if (typeof parsed.fraudScore === 'number') {
          fraudScore = `${parsed.fraudScore}/100`;
        }
      }
    } catch {
      // ignore parse errors
    }

    return [
      r.id,
      r.created_at,
      r.trigger_type,
      `"${(r.trigger_description || '').replace(/"/g, '""')}"`,
      String(r.amount),
      r.status,
      r.zone,
      r.payout_channel || '—',
      r.settlement_status || '—',
      fraudScore,
      r.processed_at || '—',
    ].join(',');
  });

  const csvContent = [
    `# ShiftSafe-DT — Claim History Export (Server)`,
    `# Worker: ${worker?.name || 'Unknown'} (${worker?.platform || '—'}, ${worker?.city || '—'})`,
    `# Generated: ${new Date().toISOString()}`,
    `# Total Claims: ${rows.length}`,
    `# Total Paid: INR ${totalPaid}`,
    '',
    headers.join(','),
    ...csvRows,
  ].join('\n');

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ShiftSafe-Claims-${workerId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
