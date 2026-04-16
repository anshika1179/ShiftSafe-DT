/*
 * Receipt Generator — Client-side PDF receipt for payout claims.
 *
 * Generates a branded ShiftSafe-DT payout receipt as a downloadable PDF
 * using the Canvas API and PDF blob construction (zero external dependencies).
 *
 * Each receipt contains: claim ID, trigger details, payout amount,
 * settlement channel, fraud score, worker info, and ShiftSafe branding.
 */

import type { ClaimData, WorkerProfile, PolicyData } from '@/backend/utils/store';

interface ReceiptData {
  claim: ClaimData;
  worker: WorkerProfile | null;
  policy: PolicyData | null;
}

/**
 * Draw a branded payout receipt on a canvas and return it as a PDF-like
 * downloadable blob (PNG wrapped for maximum compatibility without libs).
 */
export function downloadReceipt({ claim, worker, policy }: ReceiptData): void {
  const canvas = document.createElement('canvas');
  const scale = 2; // retina
  const W = 420 * scale;
  const H = 640 * scale;
  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.scale(scale, scale);
  const w = 420;
  const h = 640;

  // ─── Background ───
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, w, h);

  // Accent gradient strip at top
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#f97316');
  grad.addColorStop(1, '#ef4444');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, 6);

  // ─── Header ───
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px Inter, system-ui, sans-serif';
  ctx.fillText('🛡️ ShiftSafe-DT', 24, 44);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '11px Inter, system-ui, sans-serif';
  ctx.fillText('AI-Powered Income Protection · Payout Receipt', 24, 64);

  // Divider
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(24, 80);
  ctx.lineTo(w - 24, 80);
  ctx.stroke();

  // ─── Receipt Title ───
  ctx.fillStyle = '#f97316';
  ctx.font = 'bold 15px Inter, system-ui, sans-serif';
  ctx.fillText('PAYOUT RECEIPT', 24, 104);

  const statusColor = claim.status === 'paid' ? '#34d399'
    : claim.status === 'review' ? '#f59e0b'
    : claim.status === 'blocked' ? '#ef4444'
    : '#94a3b8';
  ctx.fillStyle = statusColor;
  ctx.font = 'bold 12px Inter, system-ui, sans-serif';
  ctx.fillText(claim.status.toUpperCase(), w - 24 - ctx.measureText(claim.status.toUpperCase()).width, 104);

  // ─── Amount ───
  ctx.fillStyle = '#34d399';
  ctx.font = 'bold 36px Inter, system-ui, sans-serif';
  ctx.fillText(`₹${claim.amount.toLocaleString('en-IN')}`, 24, 152);

  ctx.fillStyle = '#64748b';
  ctx.font = '12px Inter, system-ui, sans-serif';
  ctx.fillText('Payout Amount (after 50% cap)', 24, 172);

  // ─── Claim Details Section ───
  ctx.strokeStyle = '#1e293b';
  ctx.beginPath();
  ctx.moveTo(24, 190);
  ctx.lineTo(w - 24, 190);
  ctx.stroke();

  const drawRow = (label: string, value: string, y: number, valueColor?: string) => {
    ctx.fillStyle = '#64748b';
    ctx.font = '12px Inter, system-ui, sans-serif';
    ctx.fillText(label, 24, y);

    ctx.fillStyle = valueColor || '#e2e8f0';
    ctx.font = '12px Inter, system-ui, sans-serif';
    // Right-align value
    const textW = ctx.measureText(value).width;
    ctx.fillText(value, w - 24 - textW, y);
  };

  let y = 214;
  const rowGap = 26;

  drawRow('Claim ID', claim.id, y);
  y += rowGap;

  drawRow('Trigger Type', `${claim.triggerEmoji} ${claim.triggerName}`, y);
  y += rowGap;

  drawRow('Trigger Value', claim.triggerValue, y);
  y += rowGap;

  drawRow('Fraud Score', claim.fraudLabel, y, claim.fraudColor);
  y += rowGap;

  drawRow('Payout Reference', claim.payoutRef, y, '#f97316');
  y += rowGap;

  drawRow('Settlement Channel', claim.payoutRef.startsWith('UPI') ? 'UPI Transfer' : claim.payoutRef.startsWith('IMPS') ? 'IMPS Bank Transfer' : 'Razorpay Sandbox', y);
  y += rowGap;

  const claimDate = new Date(claim.timestamp);
  drawRow('Date', claimDate.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }), y);
  y += rowGap;

  drawRow('Zone', claim.zone, y);
  y += rowGap;

  // ─── Worker Details Section ───
  ctx.strokeStyle = '#1e293b';
  ctx.beginPath();
  ctx.moveTo(24, y + 8);
  ctx.lineTo(w - 24, y + 8);
  ctx.stroke();
  y += 30;

  ctx.fillStyle = '#f97316';
  ctx.font = 'bold 13px Inter, system-ui, sans-serif';
  ctx.fillText('WORKER DETAILS', 24, y);
  y += 24;

  drawRow('Name', worker?.name || 'Delivery Partner', y);
  y += rowGap;

  drawRow('Phone', worker?.phone ? `${worker.phone.slice(0, 3)}****${worker.phone.slice(-3)}` : '—', y);
  y += rowGap;

  drawRow('Platform', worker?.platform || '—', y);
  y += rowGap;

  drawRow('Policy ID', policy?.id || '—', y);
  y += rowGap;

  drawRow('Weekly Premium', policy ? `₹${policy.weeklyPremium}/week` : '—', y);
  y += rowGap;

  // ─── Footer ───
  ctx.strokeStyle = '#1e293b';
  ctx.beginPath();
  ctx.moveTo(24, h - 72);
  ctx.lineTo(w - 24, h - 72);
  ctx.stroke();

  ctx.fillStyle = '#475569';
  ctx.font = '10px Inter, system-ui, sans-serif';
  ctx.fillText('This is a system-generated payout receipt from ShiftSafe-DT.', 24, h - 50);
  ctx.fillText('Parametric insurance — zero-touch settlement for gig workers.', 24, h - 36);

  ctx.fillStyle = '#334155';
  ctx.font = '9px Inter, system-ui, sans-serif';
  ctx.fillText(`Generated: ${new Date().toISOString()}`, 24, h - 16);
  ctx.fillText('shift-safe-dt-frontend-livid.vercel.app', w - 24 - ctx.measureText('shift-safe-dt-frontend-livid.vercel.app').width, h - 16);

  // ─── Trigger Download ───
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ShiftSafe-Receipt-${claim.id}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 'image/png');
}

/**
 * Export all claims as a CSV file and trigger download.
 */
export function downloadClaimsCSV(claims: ClaimData[], workerName?: string): void {
  const headers = [
    'Claim ID',
    'Date',
    'Trigger Type',
    'Trigger Name',
    'Trigger Value',
    'Amount (₹)',
    'Status',
    'Fraud Score',
    'Fraud Decision',
    'Payout Reference',
    'Zone',
  ];

  const rows = claims.map((c) => [
    c.id,
    new Date(c.timestamp).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }),
    c.triggerType,
    c.triggerName,
    `"${c.triggerValue}"`,
    String(c.amount),
    c.status,
    String(c.fraudScore),
    c.fraudLabel,
    c.payoutRef,
    c.zone,
  ]);

  const csvContent = [
    `# ShiftSafe-DT Claim History Export`,
    `# Worker: ${workerName || 'Delivery Partner'}`,
    `# Generated: ${new Date().toISOString()}`,
    `# Total Claims: ${claims.length}`,
    `# Total Paid: ₹${claims.filter(c => c.status === 'paid').reduce((s, c) => s + c.amount, 0).toLocaleString('en-IN')}`,
    '',
    headers.join(','),
    ...rows.map((r) => r.join(',')),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ShiftSafe-Claims-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
