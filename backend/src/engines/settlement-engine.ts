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
  transactionRef: string | null;
  estimatedTime: string;
  timeline: SettlementStep[];
  rollbackAvailable: boolean;
  failureReason: string | null;
  attemptedChannels: PayoutChannel[];
}

export interface SettlementStep {
  step: number;
  name: string;
  status: 'completed' | 'in_progress' | 'pending' | 'failed';
  timestamp: string;
  details: string;
}

interface TransferAttempt {
  success: boolean;
  channel: PayoutChannel;
  transactionRef: string | null;
  failureReason: string | null;
}

function generateTransactionRef(channel: PayoutChannel): string {
  const prefix = channel === 'UPI' ? 'UPI-TXN' : channel === 'IMPS' ? 'IMPS-TXN' : 'RZP-TXN';
  return `${prefix}-${Math.floor(1000000 + Math.random() * 9000000)}`;
}

function estimateSettlementTime(channel: PayoutChannel): string {
  if (channel === 'IMPS') return '< 5 minutes';
  if (channel === 'RAZORPAY_SANDBOX') return '< 1 minute (sandbox)';
  return '< 2 minutes';
}

function isValidUpiId(upiId?: string): boolean {
  if (!upiId) return false;
  const trimmed = String(upiId).trim().toLowerCase();
  return /^[a-z0-9._-]{2,}@[a-z]{2,}$/i.test(trimmed);
}

function isValidBankAccount(bankAccount?: string): boolean {
  if (!bankAccount) return false;
  const compact = String(bankAccount).replace(/\s+/g, '');
  return /^\d{9,18}$/.test(compact);
}

function attemptTransfer(
  channel: PayoutChannel,
  amount: number,
  input: SettlementInput,
): TransferAttempt {
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      success: false,
      channel,
      transactionRef: null,
      failureReason: 'Invalid payout amount',
    };
  }

  if (channel === 'UPI') {
    if (!isValidUpiId(input.upiId)) {
      return {
        success: false,
        channel,
        transactionRef: null,
        failureReason: 'UPI transfer failed: invalid UPI ID',
      };
    }

    return {
      success: true,
      channel,
      transactionRef: generateTransactionRef(channel),
      failureReason: null,
    };
  }

  if (channel === 'IMPS') {
    if (!isValidBankAccount(input.bankAccount)) {
      return {
        success: false,
        channel,
        transactionRef: null,
        failureReason: 'IMPS transfer failed: invalid bank account',
      };
    }

    return {
      success: true,
      channel,
      transactionRef: generateTransactionRef(channel),
      failureReason: null,
    };
  }

  return {
    success: true,
    channel,
    transactionRef: generateTransactionRef(channel),
    failureReason: null,
  };
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

export function processSettlement(input: SettlementInput): SettlementResult {
  const now = new Date().toISOString();

  // Apply 50% maximum payout cap
  const cappedAmount = Math.min(input.amount, input.maxPayoutCap);

  // Select channel
  const { primary, fallback } = selectChannel(input.upiId, input.bankAccount);

  const settlementId = `SET-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const attemptedChannels: PayoutChannel[] = [primary];
  let finalChannel: PayoutChannel = primary;
  
  // Real settlements don't complete instantly in the real world.
  // We mark it as 'processing' so the status reflects an ongoing transfer.
  let finalStatus: SettlementStatus = 'processing';
  let transactionRef: string | null = null;
  let failureReason: string | null = null;
  let estimatedTime = estimateSettlementTime(primary);

  // Early steps are definitively completed since we got to this point
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
      status: 'in_progress',
      timestamp: now,
      details: `${primary} transfer attempt for ₹${cappedAmount} started`,
    },
    {
      step: 5,
      name: 'Record Updated',
      status: 'pending',
      timestamp: now,
      details: `Awaiting transfer outcome before ledger reconciliation`,
    },
  ];

  const primaryAttempt = attemptTransfer(primary, cappedAmount, input);
  if (primaryAttempt.success) {
    // Leave status as 'processing' to reflect real-world pending transfers
    finalStatus = 'processing';
    transactionRef = primaryAttempt.transactionRef;
    
    timeline[3] = {
      ...timeline[3],
      status: 'completed',
      details: `${primary} transfer of ₹${cappedAmount} initiated successfully. Ref: ${transactionRef}`,
    };
    timeline[4] = {
      ...timeline[4],
      status: 'pending',
      details: 'PolicyCenter logging payout. Awaiting final bank confirmation...',
    };
  } else if (fallback) {
    attemptedChannels.push(fallback);
    timeline[3] = {
      ...timeline[3],
      status: 'failed',
      details: `${primaryAttempt.failureReason}. Retrying via ${fallback}.`,
    };

    const fallbackAttempt = attemptTransfer(fallback, cappedAmount, input);
    if (fallbackAttempt.success) {
      finalStatus = 'processing';
      finalChannel = fallback;
      transactionRef = fallbackAttempt.transactionRef;
      failureReason = primaryAttempt.failureReason;
      estimatedTime = `${estimateSettlementTime(primary)} + fallback ${estimateSettlementTime(fallback)}`;

      timeline[3] = {
        ...timeline[3],
        status: 'completed',
        details: `${fallback} transfer of ₹${cappedAmount} initiated after ${primary} failure. Ref: ${transactionRef}`,
      };
      timeline[4] = {
        ...timeline[4],
        status: 'pending',
        details: `${primary} failed; processing via fallback ${fallback}. Ref: ${transactionRef}.`,
      };
    } else {
      finalStatus = 'failed'; // We can safely mark as failed if absolutely rejected
      failureReason = `${primaryAttempt.failureReason}; ${fallbackAttempt.failureReason}`;
      estimatedTime = 'Manual review required';
      timeline[4] = {
        ...timeline[4],
        status: 'failed',
        details: `All transfer attempts failed. ${failureReason}. Claim moved to manual review.`,
      };
    }
  } else {
    finalStatus = 'failed';
    failureReason = primaryAttempt.failureReason;
    estimatedTime = 'Manual review required';
    timeline[3] = {
      ...timeline[3],
      status: 'failed',
      details: `${primaryAttempt.failureReason}. No fallback channel available.`,
    };
    timeline[4] = {
      ...timeline[4],
      status: 'failed',
      details: 'Settlement not recorded as paid. Claim returned for manual review.',
    };
  }

  // NOTE: We intentionally DO NOT mark Steps 1, 2, 3 as failed if the overall settlement fails.
  // The trigger and eligibility succeeded, so their step statuses must correctly reflect that reality.

  return {
    settlementId,
    channel: finalChannel,
    fallbackChannel: fallback,
    amount: input.amount,
    cappedAmount,
    status: finalStatus,
    transactionRef,
    estimatedTime,
    timeline,
    rollbackAvailable: finalStatus === 'processing' || finalStatus === 'completed',
    failureReason,
    attemptedChannels,
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
  const settlementId = `SET-FAIL-${Date.now()}`;

  const timeline: SettlementStep[] = [
    {
      step: 1, name: 'Trigger Confirmed', status: 'completed', timestamp: now,
      details: 'Event threshold confirmed (system processing)',
    },
    {
      step: 2, name: 'Worker Eligibility Check', status: 'completed', timestamp: now,
      details: 'Policy active, zone verified',
    },
    {
      step: 3, name: 'Payout Calculated', status: 'completed', timestamp: now,
      details: `₹${cappedAmount} calculated (max cap considered)`,
    },
    {
      step: 4, name: 'Transfer Initiated', status: 'failed', timestamp: now,
      details: `${primary} transfer failed — ${primary === 'UPI' ? 'UPI ID invalid or bank timeout' : 'Bank server timeout'}`,
    },
    {
      step: 5, name: 'Rollback & Fallback', status: 'in_progress', timestamp: now,
      details: fallback
        ? `Transfer dropped. Retrying via ${fallback}...`
        : 'Transfer dropped. Manual review required — no fallback channel available.',
    },
  ];

  return {
    settlementId,
    channel: primary,
    fallbackChannel: fallback,
    amount: input.amount,
    cappedAmount,
    status: 'rolled_back',
    transactionRef: null,
    estimatedTime: fallback ? '< 10 minutes (fallback)' : 'Manual review required',
    timeline,
    rollbackAvailable: false,
    failureReason: fallback
      ? `${primary} failed; fallback ${fallback} pending/manual review`
      : `${primary} failed with no fallback channel`,
    attemptedChannels: fallback ? [primary, fallback] : [primary],
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
