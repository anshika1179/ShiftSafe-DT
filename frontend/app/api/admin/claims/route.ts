import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/backend/models/db";
import { processSettlement } from "@/backend/engines/settlement-engine";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-auth";
import {
  consumeRateLimit,
  getClientIp,
  retryAfterSeconds,
} from "@/lib/server/rate-limit";

type ClaimStatus = "review" | "paid" | "blocked" | "all";

type ClaimAction = "approve" | "reject";

interface QueueClaimRow {
  id: string;
  worker_id: string;
  policy_id: string;
  trigger_type: string;
  trigger_description: string | null;
  amount: number;
  status: string;
  zone: string | null;
  created_at: string;
  processed_at: string | null;
  evidence_data: string | null;
  worker_name: string;
  worker_phone: string;
  platform: string;
  city: string;
  settlement_channel: string | null;
  settlement_status: string | null;
  transaction_ref: string | null;
}

interface ClaimDetailsRow {
  id: string;
  worker_id: string;
  policy_id: string;
  amount: number;
  status: string;
  zone: string | null;
  evidence_data: string | null;
  worker_phone: string;
  worker_income: number;
  payout_method: string | null;
  upi_id: string | null;
  bank_account: string | null;
  ifsc_code: string | null;
}

interface CountRow {
  status: string;
  count: number;
}

function isAdminAuthenticated(req: NextRequest): boolean {
  const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  return token ? verifyAdminSessionToken(token) : false;
}

function parseEvidenceData(
  evidenceData: string | null,
): Record<string, unknown> {
  if (!evidenceData) return {};
  try {
    const parsed = JSON.parse(evidenceData) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore malformed evidence blobs.
  }
  return {};
}

function withAdminReviewMetadata(
  evidenceData: string | null,
  action: ClaimAction,
  note?: string,
): string {
  const base = parseEvidenceData(evidenceData);
  const next: Record<string, unknown> = {
    ...base,
    adminReview: {
      action,
      note: String(note || "").trim() || null,
      reviewedAt: new Date().toISOString(),
      reviewedBy: "admin",
    },
  };
  return JSON.stringify(next);
}

function normalizeStatusFilter(raw: string | null): ClaimStatus {
  const normalized = String(raw || "review")
    .trim()
    .toLowerCase();
  if (normalized === "review") return "review";
  if (normalized === "paid") return "paid";
  if (normalized === "blocked") return "blocked";
  return "all";
}

function normalizeQueueStatus(status: string): "review" | "paid" | "blocked" {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "paid" || normalized === "auto_approved") return "paid";
  if (normalized === "blocked") return "blocked";
  return "review";
}

function mapQueueClaim(row: QueueClaimRow) {
  const evidence = parseEvidenceData(row.evidence_data);
  const fraudScore = Number(evidence.fraudScore || 0);
  const fraudLabel = String(
    evidence.fraudLabel ||
      (fraudScore > 0 ? `${fraudScore}/100` : "Not scored"),
  );
  const reviewPriority =
    String(evidence.reviewPriority || "normal").toLowerCase() === "high"
      ? "high"
      : "normal";
  const normalizedStatus = normalizeQueueStatus(row.status);

  return {
    id: row.id,
    workerId: row.worker_id,
    workerName: row.worker_name,
    workerPhone: row.worker_phone,
    platform: row.platform,
    city: row.city,
    zone: row.zone || "Unknown",
    triggerType: row.trigger_type,
    triggerDescription:
      row.trigger_description || row.trigger_type.replace(/_/g, " "),
    amount: Math.round(Number(row.amount || 0)),
    status: normalizedStatus,
    createdAt: row.created_at,
    processedAt: row.processed_at,
    fraudScore,
    fraudLabel,
    reviewPriority,
    settlement: {
      channel: row.settlement_channel,
      status: row.settlement_status,
      transactionRef: row.transaction_ref,
    },
  };
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthenticated(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const statusFilter = normalizeStatusFilter(
    req.nextUrl.searchParams.get("status"),
  );
  const db = getDb();

  let whereClause = "";
  const params: string[] = [];
  if (statusFilter === "paid") {
    whereClause = "WHERE c.status IN ('paid', 'auto_approved')";
  } else if (statusFilter !== "all") {
    whereClause = "WHERE c.status = ?";
    params.push(statusFilter);
  }

  const rows = (await db
    .prepare(
      `SELECT
         c.id,
         c.worker_id,
         c.policy_id,
         c.trigger_type,
         c.trigger_description,
         c.amount,
         c.status,
         c.zone,
         c.created_at,
         c.processed_at,
         c.evidence_data,
         w.name as worker_name,
         w.phone as worker_phone,
         w.platform,
         w.city,
         s.channel as settlement_channel,
         s.status as settlement_status,
         s.transaction_ref
       FROM claims c
       JOIN workers w ON w.id = c.worker_id
       LEFT JOIN settlements s ON s.claim_id = c.id
       ${whereClause}
       ORDER BY c.created_at DESC
       LIMIT 120`,
    )
    .all(...params)) as QueueClaimRow[];

  const counts = (await db
    .prepare(
      `SELECT
         CASE
           WHEN status IN ('paid', 'auto_approved') THEN 'paid'
           ELSE status
         END as status,
         COUNT(*) as count
       FROM claims
       WHERE status IN ('review', 'paid', 'blocked', 'auto_approved')
       GROUP BY status`,
    )
    .all()) as CountRow[];

  const summary = {
    review: 0,
    paid: 0,
    blocked: 0,
    total: 0,
  };

  for (const row of counts) {
    const status = String(row.status || "").toLowerCase();
    const count = Number(row.count || 0);
    if (status === "review") summary.review = count;
    if (status === "paid") summary.paid = count;
    if (status === "blocked") summary.blocked = count;
  }

  summary.total = summary.review + summary.paid + summary.blocked;

  return NextResponse.json({
    claims: rows.map(mapQueueClaim),
    summary,
  });
}

export async function PATCH(req: NextRequest) {
  if (!isAdminAuthenticated(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(req);
  const routeRate = consumeRateLimit(
    `admin_claims_action:${ip}`,
    90,
    10 * 60 * 1000,
  );
  if (!routeRate.allowed) {
    return NextResponse.json(
      {
        error: "Too many admin actions. Please try again later.",
        retryAfterSeconds: retryAfterSeconds(routeRate.resetAt),
      },
      { status: 429 },
    );
  }

  try {
    const body = await req.json();
    const claimId = String(body?.claimId || "").trim();
    const action = String(body?.action || "")
      .trim()
      .toLowerCase() as ClaimAction;
    const note = String(body?.note || "").trim();

    if (!claimId || (action !== "approve" && action !== "reject")) {
      return NextResponse.json(
        { error: "claimId and a valid action are required" },
        { status: 400 },
      );
    }

    const db = getDb();

    const claim = (await db
      .prepare(
        `SELECT
           c.id,
           c.worker_id,
           c.policy_id,
           c.amount,
           c.status,
           c.zone,
           c.evidence_data,
           w.phone as worker_phone,
           w.avg_weekly_income as worker_income,
           w.payout_method,
           w.upi_id,
           w.bank_account,
           w.ifsc_code
         FROM claims c
         JOIN workers w ON w.id = c.worker_id
         WHERE c.id = ?
         LIMIT 1`,
      )
      .get(claimId)) as ClaimDetailsRow | undefined;

    if (!claim) {
      return NextResponse.json({ error: "Claim not found" }, { status: 404 });
    }

    const existingStatus = String(claim.status || "").toLowerCase();
    if (existingStatus !== "review" && action === "approve") {
      return NextResponse.json(
        { error: "Only claims in review can be approved" },
        { status: 409 },
      );
    }

    if (existingStatus !== "review" && action === "reject") {
      return NextResponse.json(
        { error: "Only claims in review can be rejected" },
        { status: 409 },
      );
    }

    if (action === "reject") {
      const evidenceData = withAdminReviewMetadata(
        claim.evidence_data,
        "reject",
        note,
      );

      await db
        .prepare(
          `UPDATE claims
           SET status = 'blocked',
               payout_method = 'manual_review',
               payout_channel = 'manual_review',
               settlement_status = 'blocked',
               evidence_data = ?,
               processed_at = datetime('now')
           WHERE id = ?`,
        )
        .run(evidenceData, claimId);

      return NextResponse.json({
        success: true,
        claimId,
        status: "blocked",
        message: "Claim rejected and marked as blocked",
      });
    }

    const maxPayoutCap = Math.round(Number(claim.worker_income || 0) * 0.5);
    const preferredPayoutMethod = String(claim.payout_method || "upi")
      .trim()
      .toLowerCase();
    const workerUpiId = String(claim.upi_id || "")
      .trim()
      .toLowerCase();
    const workerBankAccount = String(claim.bank_account || "").trim();
    const upiFromPhone = `${claim.worker_phone}@upi`;

    const payoutViaBank = preferredPayoutMethod === "bank";
    const preferredUpi = workerUpiId.includes("@") ? workerUpiId : upiFromPhone;
    const settlementUpiId = payoutViaBank ? undefined : preferredUpi;
    const settlementBankAccount = workerBankAccount || undefined;

    const settlement = processSettlement({
      claimId: claim.id,
      workerId: claim.worker_id,
      amount: Number(claim.amount || 0),
      upiId: settlementUpiId,
      bankAccount: settlementBankAccount,
      maxPayoutCap,
    });

    const evidenceData = withAdminReviewMetadata(
      claim.evidence_data,
      "approve",
      note,
    );

    await db
      .prepare(
        `UPDATE claims
         SET amount = ?,
             status = 'paid',
             payout_method = ?,
             payout_channel = ?,
             settlement_status = ?,
             evidence_data = ?,
             processed_at = datetime('now')
         WHERE id = ?`,
      )
      .run(
        settlement.cappedAmount,
        settlement.channel,
        settlement.channel,
        settlement.status,
        evidenceData,
        claimId,
      );

    await db
      .prepare(
        `INSERT INTO settlements (id, claim_id, worker_id, amount, channel, fallback_channel, upi_id, bank_account, status, completed_at, transaction_ref)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
      )
      .run(
        settlement.settlementId,
        claimId,
        claim.worker_id,
        settlement.cappedAmount,
        settlement.channel,
        settlement.fallbackChannel,
        settlementUpiId || null,
        settlementBankAccount || null,
        settlement.status,
        settlement.transactionRef,
      );

    return NextResponse.json({
      success: true,
      claimId,
      status: "paid",
      message: `Claim approved and payout settled via ${settlement.channel}`,
      settlement: {
        id: settlement.settlementId,
        channel: settlement.channel,
        fallbackChannel: settlement.fallbackChannel,
        amount: settlement.cappedAmount,
        estimatedTime: settlement.estimatedTime,
        transactionRef: settlement.transactionRef,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }
}
