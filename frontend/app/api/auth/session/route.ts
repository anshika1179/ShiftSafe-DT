import { NextRequest, NextResponse } from "next/server";
import type {
  ClaimData,
  PolicyData,
  WorkerProfile,
} from "@/backend/utils/store";
import { getTriggerEmoji, getTriggerName } from "@/backend/utils/store";
import { getDb } from "@/backend/models/db";
import { isProduction } from "@/lib/server/env";
import {
  WORKER_SESSION_COOKIE,
  parseWorkerSessionToken,
} from "@/lib/server/worker-auth";

interface WorkerRow {
  id: string;
  name: string;
  phone: string;
  platform: string;
  city: string;
  zone: string;
  avg_weekly_income: number;
  shift_type: string;
  risk_score: number;
  payout_method: string | null;
  upi_id: string | null;
}

interface PolicyRow {
  id: string;
  weekly_premium: number;
  max_coverage_per_week: number;
  status: string;
  start_date: string;
  premium_tier: string;
}

interface ClaimRow {
  id: string;
  trigger_type: string;
  trigger_description: string | null;
  amount: number;
  status: string;
  zone: string | null;
  created_at: string;
  evidence_data: string | null;
  transaction_ref: string | null;
}

function shouldUseSecureCookie(req: NextRequest): boolean {
  const host = req.nextUrl.hostname;
  const isLocalhost = host === "localhost" || host === "127.0.0.1";
  const forwardedProto = req.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    ?.toLowerCase();
  const isHttps =
    req.nextUrl.protocol === "https:" || forwardedProto === "https";

  if (isHttps) return true;
  if (isProduction && !isLocalhost) return true;
  return false;
}

function normalizeClaimStatus(status: string): ClaimData["status"] {
  const normalized = status.toLowerCase();
  if (normalized === "paid" || normalized === "auto_approved") return "paid";
  if (normalized === "review") return "review";
  if (normalized === "blocked") return "blocked";
  return "pending";
}

function getFraudColor(score: number): string {
  if (score <= 24) return "#34d399";
  if (score <= 44) return "#4d9fff";
  if (score <= 69) return "#ff6b35";
  return "#ff3b5c";
}

function getRiskLabel(score: number): string {
  if (score <= 25) return "Low";
  if (score <= 50) return "Moderate";
  if (score <= 75) return "High";
  return "Critical";
}

function getRelativeTime(timestamp: string): string {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(diffMs / (60 * 1000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getContributionByTier(tier: string): PolicyData["contributions"] {
  const normalized = String(tier || "").toLowerCase();
  if (normalized === "premium") {
    return { weather: 32, zone: 26, platform: 22, claims: 20 };
  }
  if (normalized === "low") {
    return { weather: 20, zone: 18, platform: 35, claims: 27 };
  }
  return { weather: 28, zone: 24, platform: 24, claims: 24 };
}

function parseFraudInfo(
  row: ClaimRow,
  status: ClaimData["status"],
): { score: number; label: string } {
  let score = status === "blocked" ? 80 : status === "review" ? 55 : 18;
  let label =
    status === "blocked"
      ? "80/100 Blocked"
      : status === "review"
        ? "55/100 Review"
        : "18/100 Clean";

  if (!row.evidence_data) {
    return { score, label };
  }

  try {
    const parsed = JSON.parse(row.evidence_data) as {
      fraudScore?: unknown;
      fraudLabel?: unknown;
    };
    const parsedScore = Number(parsed.fraudScore);
    if (Number.isFinite(parsedScore)) score = parsedScore;
    if (typeof parsed.fraudLabel === "string" && parsed.fraudLabel.trim()) {
      label = parsed.fraudLabel;
    }
  } catch {
    // Ignore malformed evidence blobs.
  }

  return { score, label };
}

function mapWorkerToProfile(worker: WorkerRow): WorkerProfile {
  const avgWeeklyEarnings = Number(worker.avg_weekly_income || 0);
  const hoursPerDay = worker.shift_type === "part_time" ? 5 : 8;
  const persistedUpiId = String(worker.upi_id || "").trim();
  const effectiveUpiId = persistedUpiId || `${worker.phone}@upi`;

  return {
    id: worker.id,
    name: worker.name,
    phone: worker.phone,
    platform: worker.platform,
    city: worker.city,
    zone: worker.zone,
    avgWeeklyEarnings,
    hoursPerDay,
    upiId: effectiveUpiId,
  };
}

function mapPolicy(
  worker: WorkerRow,
  policy: PolicyRow | undefined,
  now: Date,
): PolicyData {
  const weeklyPremium = Number(policy?.weekly_premium || 0);
  const coverageAmount = Number(policy?.max_coverage_per_week || 0);
  const normalizedRisk = Number(worker.risk_score || 0.35);
  const riskScore =
    normalizedRisk <= 1 ? Math.round(normalizedRisk * 100) : normalizedRisk;

  const startDate = policy?.start_date || now.toISOString().split("T")[0];
  const weeksActive = Math.max(
    1,
    Math.floor(
      (now.getTime() - new Date(startDate).getTime()) / (7 * 86400000),
    ) + 1,
  );

  const nextPaymentDate = new Date(startDate);
  nextPaymentDate.setDate(nextPaymentDate.getDate() + weeksActive * 7);

  const status = String(policy?.status || "active").toLowerCase();
  const normalizedStatus: PolicyData["status"] =
    status === "cancelled" || status === "expired" ? status : "active";

  return {
    id: policy?.id || `POL-${worker.id.slice(0, 8)}`,
    weeklyPremium,
    coverageAmount,
    riskScore,
    riskLabel: getRiskLabel(riskScore),
    status: normalizedStatus,
    startDate,
    nextPaymentDue: nextPaymentDate.toISOString().split("T")[0],
    totalPremiumPaid: Math.round(weeklyPremium * weeksActive),
    contributions: getContributionByTier(policy?.premium_tier || "standard"),
  };
}

function mapClaims(rows: ClaimRow[]): ClaimData[] {
  return rows.map((row) => {
    const status = normalizeClaimStatus(row.status);
    const fraud = parseFraudInfo(row, status);

    return {
      id: row.id,
      triggerType: row.trigger_type,
      triggerEmoji: getTriggerEmoji(row.trigger_type),
      triggerName: getTriggerName(row.trigger_type),
      triggerValue:
        row.trigger_description ||
        `${getTriggerName(row.trigger_type)} detected`,
      amount: Math.round(Number(row.amount || 0)),
      status,
      fraudScore: fraud.score,
      fraudLabel: fraud.label,
      fraudColor: getFraudColor(fraud.score),
      payoutRef:
        row.transaction_ref ||
        (status === "paid"
          ? "UPI-TXN-APPROVED"
          : status === "blocked"
            ? "BLOCKED"
            : "UNDER-REVIEW"),
      timestamp: row.created_at,
      relativeTime: getRelativeTime(row.created_at),
      zone: row.zone || "Unknown",
    };
  });
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get(WORKER_SESSION_COOKIE)?.value;
  const session = token ? parseWorkerSessionToken(token) : null;

  if (!session) {
    return NextResponse.json({ authenticated: false });
  }

  const db = getDb();
  const worker = (await db
    .prepare(
      "SELECT id, name, phone, platform, city, zone, avg_weekly_income, shift_type, risk_score, payout_method, upi_id FROM workers WHERE id = ? LIMIT 1",
    )
    .get(session.workerId)) as WorkerRow | undefined;

  if (!worker) {
    return NextResponse.json({ authenticated: false });
  }

  const policy = (await db
    .prepare(
      "SELECT id, weekly_premium, max_coverage_per_week, status, start_date, premium_tier FROM policies WHERE worker_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(worker.id)) as PolicyRow | undefined;

  const claimRows = (await db
    .prepare(
      `SELECT c.id, c.trigger_type, c.trigger_description, c.amount, c.status, c.zone, c.created_at, c.evidence_data, s.transaction_ref
       FROM claims c
       LEFT JOIN settlements s ON s.claim_id = c.id
       WHERE c.worker_id = ?
       ORDER BY c.created_at DESC
       LIMIT 100`,
    )
    .all(worker.id)) as ClaimRow[];

  const now = new Date();
  const workerProfile = mapWorkerToProfile(worker);
  const policyData = mapPolicy(worker, policy, now);
  const claims = mapClaims(claimRows);
  const totalEarningsProtected = claims
    .filter((claim) => claim.status === "paid")
    .reduce((sum, claim) => sum + claim.amount, 0);

  return NextResponse.json(
    {
      authenticated: true,
      worker: workerProfile,
      policy: policyData,
      claims,
      totalEarningsProtected,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function DELETE(req: NextRequest) {
  const res = NextResponse.json({ success: true });
  const secureCookie = shouldUseSecureCookie(req);
  res.cookies.set(WORKER_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: secureCookie,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return res;
}
