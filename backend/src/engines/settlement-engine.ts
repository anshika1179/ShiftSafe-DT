/*
 * Settlement & Payout Engine
 *
 * Settlement Architecture Pipeline:
 *   1. Trigger confirmed → 2. Worker eligibility check → 3. Payout calculated
 *   → 4. Transfer initiated → 5. Record updated
 *
 * Payout channels:
 *   - UPI transfer (primary, instant) — worker already uses it
 *   - IMPS to bank (fallback if UPI not linked)
 *   - Razorpay / Stripe sandbox (for demo / hackathon simulation)
 *
 * Key points:
 *   - Zero-touch: worker does nothing to receive payout
 *   - Rollback logic: what if transfer fails mid-way?
 *   - Fraud check BEFORE, not after payment
 *   - Defined settlement time — minutes not hours
 *   - 50% maximum payout cap
 */

export type PayoutChannel = 'UPI' | 'IMPS' | 'RAZORPAY_SANDBOX';
export type SettlementStatus = 'initiated' | 'processing' | 'completed' | 'failed' | 'rolled_back';

export interface SettlementInput {
  claimId: string;
  workerId: string;
  amount: number;
  upiId?: string;
  bankAccount?: string;
  maxPayoutCap: number;     // 50% of weekly income
}

export interface SettlementResult {
  settlementId: string;
  channel: PayoutChannel;
  fallbackChannel: PayoutChannel | null;
  amount: number;
  cappedAmount: number;     // after 50% cap applied
  status: SettlementStatus;
  transactionRef: string;
  estimatedTime: string;
  timeline: SettlementStep[];
  rollbackAvailable: boolean;
}

export interface SettlementStep {
  step: number;
  name: string;
  status: 'completed' | 'in_progress' | 'pending' | 'failed';
  timestamp: string;
  details: string;
}

function generateTransactionRef(channel: PayoutChannel): string {
  const prefix = channel === 'UPI' ? 'UPI-TXN' : channel === 'IMPS' ? 'IMPS-TXN' : 'RZP-TXN';
  return `${prefix}-${Math.floor(1000000 + Math.random() * 9000000)}`;
}

/**
 * Determine the best payout channel
 * Priority: UPI → IMPS → Razorpay Sandbox
 */
function selectChannel(upiId?: string, bankAccount?: string): { primary: PayoutChannel; fallback: PayoutChannel | null } {
  if (upiId && upiId.includes('@')) {
    return { primary: 'UPI', fallback: bankAccount ? 'IMPS' : 'RAZORPAY_SANDBOX' };
  }
  if (bankAccount) {
    return { primary: 'IMPS', fallback: 'RAZORPAY_SANDBOX' };
  }
  return { primary: 'RAZORPAY_SANDBOX', fallback: null };
}

/**
 * Process a settlement — the main entry point
 * This is called AFTER fraud check passes
 */
export function processSettlement(input: SettlementInput): SettlementResult {
  const now = new Date().toISOString();

  // Apply 50% maximum payout cap
  const cappedAmount = Math.min(input.amount, input.maxPayoutCap);

  // Select channel
  const { primary, fallback } = selectChannel(input.upiId, input.bankAccount);

  // Generate refs
  const transactionRef = generateTransactionRef(primary);
  const settlementId = `SET-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  // Build the 5-step settlement timeline
  const timeline: SettlementStep[] = [
    {
      step: 1,
      name: 'Trigger Confirmed',
      status: 'completed',
      timestamp: now,
      details: 'Oracle / weather API confirms event threshold crossed',
    },
    {
      step: 2,
      name: 'Worker Eligibility Check',
      status: 'completed',
      timestamp: now,
      details: `Active policy verified, correct zone, no duplicate claim`,
    },
    {
      step: 3,
      name: 'Payout Calculated',
      status: 'completed',
      timestamp: now,
      details: `Fixed amount ₹${cappedAmount} (50% cap: ₹${input.maxPayoutCap}). ${cappedAmount < input.amount ? 'Amount capped from ₹' + input.amount : 'Within cap'}`,
    },
    {
      step: 4,
      name: 'Transfer Initiated',
      status: 'completed',
      timestamp: now,
      details: `${primary} transfer of ₹${cappedAmount} to ${input.upiId || input.bankAccount || 'sandbox'}. Ref: ${transactionRef}`,
    },
    {
      step: 5,
      name: 'Record Updated',
      status: 'completed',
      timestamp: now,
      details: `PolicyCenter logs payout, BillingCenter reconciles. SMS confirmation sent.`,
    },
  ];

  // Estimate settlement time based on channel
  let estimatedTime = '< 2 minutes';
  if (primary === 'IMPS') estimatedTime = '< 5 minutes';
  if (primary === 'RAZORPAY_SANDBOX') estimatedTime = '< 1 minute (sandbox)';

  return {
    settlementId,
    channel: primary,
    fallbackChannel: fallback,
    amount: input.amount,
    cappedAmount,
    status: 'completed',
    transactionRef,
    estimatedTime,
    timeline,
    rollbackAvailable: true,
  };
}

/**
 * Simulate a failed settlement with rollback
 * For demo purposes — shows the rollback logic
 */
export function simulateFailedSettlement(input: SettlementInput): SettlementResult {
  const now = new Date().toISOString();
  const cappedAmount = Math.min(input.amount, input.maxPayoutCap);
  const { primary, fallback } = selectChannel(input.upiId, input.bankAccount);
  const transactionRef = generateTransactionRef(primary);
  const settlementId = `SET-FAIL-${Date.now()}`;

  const timeline: SettlementStep[] = [
    {
      step: 1, name: 'Trigger Confirmed', status: 'completed', timestamp: now,
      details: 'Event threshold confirmed',
    },
    {
      step: 2, name: 'Worker Eligibility Check', status: 'completed', timestamp: now,
      details: 'Policy active, zone verified',
    },
    {
      step: 3, name: 'Payout Calculated', status: 'completed', timestamp: now,
      details: `₹${cappedAmount} calculated`,
    },
    {
      step: 4, name: 'Transfer Initiated', status: 'failed', timestamp: now,
      details: `${primary} transfer failed — ${primary === 'UPI' ? 'UPI ID invalid or timeout' : 'Bank server timeout'}`,
    },
    {
      step: 5, name: 'Rollback & Fallback', status: 'in_progress', timestamp: now,
      details: fallback
        ? `Rolling back. Retrying via ${fallback}...`
        : 'Rolling back. Manual review required — no fallback channel available.',
    },
  ];

  return {
    settlementId,
    channel: primary,
    fallbackChannel: fallback,
    amount: input.amount,
    cappedAmount,
    status: 'rolled_back',
    transactionRef,
    estimatedTime: fallback ? '< 10 minutes (fallback)' : 'Manual review required',
    timeline,
    rollbackAvailable: false,
  };
}

/**
 * Get channel display info for the UI
 */
export function getChannelInfo(channel: PayoutChannel): { name: string; icon: string; description: string } {
  switch (channel) {
    case 'UPI':
      return { name: 'UPI Transfer', icon: '📱', description: 'Instant, preferred — worker already uses it' };
    case 'IMPS':
      return { name: 'IMPS to Bank', icon: '🏦', description: 'Fallback if UPI not linked' };
    case 'RAZORPAY_SANDBOX':
      return { name: 'Razorpay Sandbox', icon: '💳', description: 'For demo / hackathon simulation' };
  }
}
