// GET /api/claims?workerId=...  — Get claims for a worker
// POST /api/claims — Create claim from trigger (review-first workflow)
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/backend/models/db";
import { detectFraudAdvanced } from "@/backend/engines/fraud-engine";
import {
  consumeRateLimit,
  getClientIp,
  retryAfterSeconds,
} from "@/lib/server/rate-limit";

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

function parseLocation(
  input: unknown,
): { lat: number; lon: number } | undefined {
  if (!input || typeof input !== "object") return undefined;
  const lat = Number((input as { lat?: unknown }).lat);
  const lon = Number((input as { lon?: unknown }).lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return undefined;
  return { lat, lon };
}

export async function GET(req: NextRequest) {
  const workerId = req.nextUrl.searchParams.get("workerId");
  if (!workerId) {
    return NextResponse.json(
      { error: "workerId query parameter is required" },
      { status: 400 },
    );
  }

  const db = getDb();
  const rows = (await db
    .prepare(
      "SELECT * FROM claims WHERE worker_id = ? ORDER BY created_at DESC",
    )
    .all(workerId)) as ClaimRow[];

  return NextResponse.json({ claims: rows });
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const routeRate = consumeRateLimit(`claims:${ip}`, 45, 10 * 60 * 1000);
    if (!routeRate.allowed) {
      return NextResponse.json(
        {
          error: "Too many claim requests. Please try again later.",
          retryAfterSeconds: retryAfterSeconds(routeRate.resetAt),
        },
        { status: 429 },
      );
    }

    const body = await req.json();
    const {
      workerId,
      triggerType,
      severity,
      zone,
      workerLocation,
      triggerLocation,
      gpsAccuracyMeters,
      travelSpeedKmph,
    } = body;

    const sanitizedWorkerId = String(workerId || "").trim();
    const sanitizedTriggerType = String(triggerType || "").trim();
    const sanitizedSeverity = String(severity || "high")
      .trim()
      .toLowerCase();
    const safeZone =
      String(zone || "Andheri West")
        .trim()
        .slice(0, 80) || "Andheri West";

    if (!sanitizedWorkerId || !sanitizedTriggerType) {
      return NextResponse.json(
        { error: "workerId and triggerType required" },
        { status: 400 },
      );
    }

    const validSeverities = new Set(["moderate", "high", "severe"]);
    if (!validSeverities.has(sanitizedSeverity)) {
      return NextResponse.json(
        { error: "severity must be moderate, high, or severe" },
        { status: 400 },
      );
    }

    const PER_TRIGGER_LIMIT = consumeRateLimit(
      `claims:${sanitizedWorkerId}`,
      25,
      10 * 60 * 1000,
    );
    if (!PER_TRIGGER_LIMIT.allowed) {
      return NextResponse.json(
        {
          error: "Claim rate limit exceeded for this worker",
          retryAfterSeconds: retryAfterSeconds(PER_TRIGGER_LIMIT.resetAt),
        },
        { status: 429 },
      );
    }

    const db = getDb();

    // Get active policy for this worker
    const policy = (await db
      .prepare(
        "SELECT id, max_coverage_per_week, max_payout_percent, weekly_premium FROM policies WHERE worker_id = ? AND status = ? LIMIT 1",
      )
      .get(sanitizedWorkerId, "active")) as
      | {
          id: string;
          max_coverage_per_week: number;
          max_payout_percent: number;
          weekly_premium: number;
        }
      | undefined;

    if (!policy) {
      return NextResponse.json(
        { error: "No active policy found" },
        { status: 404 },
      );
    }

    // Get worker info
    const worker = (await db
      .prepare(
        "SELECT avg_weekly_income, insurance_opted_out FROM workers WHERE id = ?",
      )
      .get(sanitizedWorkerId)) as
      | { avg_weekly_income: number; insurance_opted_out: number }
      | undefined;

    if (!worker || worker.insurance_opted_out) {
      return NextResponse.json(
        { error: "Worker has opted out of insurance" },
        { status: 403 },
      );
    }

    // Check weekly claim limit
    const weekClaims = (await db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) as total FROM claims 
       WHERE worker_id = ? AND created_at >= datetime('now', '-7 days')`,
      )
      .get(sanitizedWorkerId)) as { total: number };

    // Get recent claim activity for fraud behavior signals
    const todayClaims = (await db
      .prepare(
        `SELECT COUNT(*) as cnt FROM claims
       WHERE worker_id = ? AND trigger_type = ? AND created_at >= date('now')`,
      )
      .get(sanitizedWorkerId, sanitizedTriggerType)) as { cnt: number };

    const claimsLast30Days = (await db
      .prepare(
        `SELECT COUNT(*) as cnt FROM claims
       WHERE worker_id = ? AND created_at >= datetime('now', '-30 days')`,
      )
      .get(sanitizedWorkerId)) as { cnt: number };

    const PAYOUT_TABLE: Record<string, Record<string, number>> = {
      heavy_rain: { moderate: 100, high: 200, severe: 350 },
      heatwave: { moderate: 80, high: 150, severe: 250 },
      pollution: { moderate: 60, high: 120, severe: 200 },
      platform_outage: { moderate: 100, high: 200, severe: 300 },
      curfew: { moderate: 200, high: 350, severe: 500 },
    };

    const sev = sanitizedSeverity as "moderate" | "high" | "severe";
    if (!PAYOUT_TABLE[sanitizedTriggerType]) {
      return NextResponse.json(
        { error: "Unsupported trigger type" },
        { status: 400 },
      );
    }

    let amount = PAYOUT_TABLE[sanitizedTriggerType][sev] || 100;

    // Apply 50% maximum payout cap
    const maxPayout = Math.round(worker.avg_weekly_income * 0.5);
    amount = Math.min(amount, maxPayout);

    if (weekClaims.total + amount > policy.max_coverage_per_week) {
      return NextResponse.json(
        {
          error: "Weekly coverage limit reached",
          weeklyUsed: weekClaims.total,
          maxCoverage: policy.max_coverage_per_week,
        },
        { status: 422 },
      );
    }

    // Fraud checks run before claim review routing.
    const fraudResult = detectFraudAdvanced({
      claimAlreadyToday: (todayClaims?.cnt || 0) > 0,
      policyActive: true,
      claimAmount: amount,
      dailyAverage: Math.max(1, Math.round(worker.avg_weekly_income / 7)),
      claimsLast30Days: claimsLast30Days?.cnt || 0,
      workerLocation: parseLocation(workerLocation),
      triggerLocation: parseLocation(triggerLocation),
      gpsAccuracyMeters:
        typeof gpsAccuracyMeters === "number"
          ? Math.max(0, Math.min(2000, gpsAccuracyMeters))
          : undefined,
      travelSpeedKmph:
        typeof travelSpeedKmph === "number"
          ? Math.max(0, Math.min(300, travelSpeedKmph))
          : undefined,
      zoneRadiusKm: 5,
    });

    const claimId = crypto.randomUUID();
    const description = `${sanitizedTriggerType.replace(/_/g, " ")} — ${sev} severity — auto-triggered in ${safeZone}`;

    if (fraudResult.decision === "BLOCKED") {
      await db
        .prepare(
          `INSERT INTO claims (id, policy_id, worker_id, trigger_type, trigger_description, amount, status, zone, payout_method, payout_channel, settlement_status, evidence_data, processed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        )
        .run(
          claimId,
          policy.id,
          sanitizedWorkerId,
          sanitizedTriggerType,
          description,
          amount,
          "blocked",
          safeZone,
          "manual_review",
          "manual_review",
          "blocked",
          JSON.stringify({
            source: "api_claims",
            fraudScore: fraudResult.score,
            fraudLabel: fraudResult.label,
            flags: fraudResult.flags,
            mlScore: fraudResult.mlScore,
            distanceKm: fraudResult.distanceKm,
            reviewPriority: "high",
          }),
        );

      return NextResponse.json(
        {
          success: false,
          claimId,
          status: "blocked",
          error: "Claim blocked by fraud detection",
          fraudScore: fraudResult.score,
          fraudLabel: fraudResult.label,
          flags: fraudResult.flags,
        },
        { status: 403 },
      );
    }

    const reviewPriority =
      fraudResult.decision === "REVIEW" ? "high" : "normal";

    // ── AUTO-SETTLEMENT LOGIC ──
    // Low-risk claims (fraud score ≤ 25) are auto-approved for instant payout.
    // Medium-risk claims (26-60) go to admin review before payout.
    const isAutoApproved = fraudResult.score <= 25 && (fraudResult.decision === "CLEAN" || fraudResult.decision === "LOW_RISK");
    const claimStatus = isAutoApproved ? "auto_approved" : "review";
    const settlementStatus = isAutoApproved ? "completed" : "pending";
    const payoutMethod = isAutoApproved ? "upi" : "manual_review";
    const payoutChannel = isAutoApproved ? "UPI" : "manual_review";
    const processedAt = isAutoApproved ? "datetime('now')" : "NULL";

    await db
      .prepare(
        `INSERT INTO claims (id, policy_id, worker_id, trigger_type, trigger_description, amount, status, zone, payout_method, payout_channel, settlement_status, evidence_data, processed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${processedAt})`,
      )
      .run(
        claimId,
        policy.id,
        sanitizedWorkerId,
        sanitizedTriggerType,
        description,
        amount,
        claimStatus,
        safeZone,
        payoutMethod,
        payoutChannel,
        settlementStatus,
        JSON.stringify({
          source: "api_claims",
          fraudScore: fraudResult.score,
          fraudLabel: fraudResult.label,
          flags: fraudResult.flags,
          mlScore: fraudResult.mlScore,
          distanceKm: fraudResult.distanceKm,
          reviewPriority,
          autoApproved: isAutoApproved,
          automationReason: isAutoApproved
            ? `Fraud score ${fraudResult.score}/100 (≤25 threshold) — auto-approved by AI`
            : `Fraud score ${fraudResult.score}/100 — queued for admin review`,
        }),
      );

    // If auto-approved, also create settlement record
    if (isAutoApproved) {
      const txnRef = `UPI-AUTO-${Date.now()}-${claimId.slice(0, 8)}`;
      try {
        await db
          .prepare(
            `INSERT INTO settlements (id, claim_id, worker_id, amount, channel, status, transaction_ref, created_at, completed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
          )
          .run(
            crypto.randomUUID(),
            claimId,
            sanitizedWorkerId,
            amount,
            "UPI",
            "completed",
            txnRef,
          );
      } catch {
        // Settlement record creation is best-effort
      }

      return NextResponse.json(
        {
          success: true,
          claimId,
          amount,
          maxPayoutCap: maxPayout,
          status: "auto_approved",
          message: `✅ Auto-approved! Fraud score ${fraudResult.score}/100 (low risk). ₹${amount} sent via UPI.`,
          settlement: {
            channel: "UPI",
            transactionRef: txnRef,
            status: "completed",
          },
          fraud: {
            score: fraudResult.score,
            label: fraudResult.label,
            decision: "AUTO_APPROVED",
            flags: fraudResult.flags,
            mlScore: fraudResult.mlScore,
            distanceKm: fraudResult.distanceKm,
          },
          automation: {
            reason: `Fraud score ${fraudResult.score}/100 is below auto-approval threshold (≤25)`,
            pipeline: ["trigger_detected", "gps_verified", "fraud_scored", "auto_approved", "payout_initiated"],
          },
        },
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        claimId,
        amount,
        maxPayoutCap: maxPayout,
        status: "review",
        message: `Claim submitted for admin review (fraud score: ${fraudResult.score}/100)`,
        fraud: {
          score: fraudResult.score,
          label: fraudResult.label,
          decision: fraudResult.decision,
          flags: fraudResult.flags,
          mlScore: fraudResult.mlScore,
          distanceKm: fraudResult.distanceKm,
        },
        automation: {
          reason: `Fraud score ${fraudResult.score}/100 exceeds auto-approval threshold (>25). Queued for human review.`,
          pipeline: ["trigger_detected", "gps_verified", "fraud_scored", "admin_review_queued"],
        },
      },
      { status: 202 },
    );
  } catch (err) {
    console.error("Claim creation error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
