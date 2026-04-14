// GET /api/policies?workerId=...  — Get worker's policies
// POST /api/policies — not used (created during registration)
// PATCH /api/policies — update auto_renew status or cancel policy (opt-out)
// DELETE /api/policies — cancel/opt-out of insurance
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/backend/models/db";
import {
  consumeRateLimit,
  getClientIp,
  retryAfterSeconds,
} from "@/lib/server/rate-limit";

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
      "SELECT * FROM policies WHERE worker_id = ? ORDER BY created_at DESC",
    )
    .all(workerId)) as PolicyRow[];

  const policies = rows.map((r) => {
    let coverageEvents: string[] = [
      "heavy_rain",
      "heatwave",
      "pollution",
      "platform_outage",
      "curfew",
    ];
    try {
      if (r.coverage_events) {
        coverageEvents = JSON.parse(r.coverage_events);
      }
    } catch {
      // Ignore malformed coverage_events — use defaults.
    }

    return {
      ...r,
      coverageEvents,
      autoRenew: !!r.auto_renew,
      premiumTier: r.premium_tier || "standard",
      maxPayoutPercent: r.max_payout_percent || 50,
      cityPool: r.city_pool || "mumbai_rain",
    };
  });

  return NextResponse.json({ policies });
}

export async function PATCH(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rate = consumeRateLimit(`policies_patch:${ip}`, 30, 10 * 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json(
        {
          error: "Too many policy updates. Please try again later.",
          retryAfterSeconds: retryAfterSeconds(rate.resetAt),
        },
        { status: 429 },
      );
    }

    const body = await req.json();
    const { policyId, workerId, autoRenew, action } = body;

    if (!policyId || !workerId) {
      return NextResponse.json(
        { error: "policyId and workerId are required" },
        { status: 400 },
      );
    }

    const db = getDb();
    const ownership = (await db
      .prepare("SELECT worker_id FROM policies WHERE id = ?")
      .get(policyId)) as { worker_id: string } | undefined;
    if (!ownership || ownership.worker_id !== String(workerId).trim()) {
      return NextResponse.json(
        { error: "Policy not found for this worker" },
        { status: 404 },
      );
    }

    // cancel / opt-out action
    if (action === "cancel" || action === "opt_out") {
      const stmt = await db.prepare(
        "UPDATE policies SET status = ?, auto_renew = 0, end_date = date('now') WHERE id = ?",
      );
      const result = await stmt.run("cancelled", policyId);

      if (result.changes === 0) {
        return NextResponse.json(
          { error: "Policy not found" },
          { status: 404 },
        );
      }

      // Also mark worker as opted out
      const policy = (await db
        .prepare("SELECT worker_id FROM policies WHERE id = ?")
        .get(policyId)) as { worker_id: string } | undefined;
      if (policy) {
        await db
          .prepare("UPDATE workers SET insurance_opted_out = 1 WHERE id = ?")
          .run(policy.worker_id);
      }

      return NextResponse.json({
        success: true,
        policyId,
        status: "cancelled",
        message:
          "Insurance coverage cancelled. Worker can re-enroll at any time.",
      });
    }

    // re-activate action
    if (action === "reactivate") {
      const stmt = await db.prepare(
        "UPDATE policies SET status = ?, auto_renew = 1, end_date = NULL WHERE id = ?",
      );
      const result = await stmt.run("active", policyId);

      if (result.changes === 0) {
        return NextResponse.json(
          { error: "Policy not found" },
          { status: 404 },
        );
      }

      const policy = (await db
        .prepare("SELECT worker_id FROM policies WHERE id = ?")
        .get(policyId)) as { worker_id: string } | undefined;
      if (policy) {
        await db
          .prepare("UPDATE workers SET insurance_opted_out = 0 WHERE id = ?")
          .run(policy.worker_id);
      }

      return NextResponse.json({
        success: true,
        policyId,
        status: "active",
        message: "Insurance coverage reactivated.",
      });
    }

    // toggle auto-renew
    if (autoRenew !== undefined) {
      const stmt = await db.prepare(
        "UPDATE policies SET auto_renew = ? WHERE id = ?",
      );
      const result = await stmt.run(autoRenew ? 1 : 0, policyId);

      if (result.changes === 0) {
        return NextResponse.json(
          { error: "Policy not found" },
          { status: 404 },
        );
      }

      return NextResponse.json({ success: true, policyId, autoRenew });
    }

    return NextResponse.json(
      { error: "No valid action specified" },
      { status: 400 },
    );
  } catch (error) {
    console.error("Failed to update policy:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
