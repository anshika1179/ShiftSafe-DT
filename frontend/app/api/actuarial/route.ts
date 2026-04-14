// GET /api/actuarial — Get actuarial metrics, BCR, and stress scenarios
// POST /api/actuarial — Run a stress scenario
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/backend/models/db";
import {
  getActuarialSnapshot,
  runMonsoonStressScenario,
  runDelhiHazardScenario,
  runCustomStressScenario,
} from "@/backend/engines/actuarial-engine";
import {
  consumeRateLimit,
  getClientIp,
  retryAfterSeconds,
} from "@/lib/server/rate-limit";

interface SumRow {
  total: number;
}
interface CountRow {
  cnt: number;
}

export async function GET() {
  const db = getDb();

  // Current totals
  const totalPremium = (
    (await db
      .prepare(
        "SELECT COALESCE(SUM(weekly_premium), 0) as total FROM policies WHERE status = ?",
      )
      .get("active")) as SumRow
  ).total;

  const totalClaims = (
    (await db
      .prepare(
        "SELECT COALESCE(SUM(amount), 0) as total FROM claims WHERE status IN ('auto_approved', 'paid')",
      )
      .get()) as SumRow
  ).total;

  const activePolicies = (
    (await db
      .prepare("SELECT COUNT(*) as cnt FROM policies WHERE status = ?")
      .get("active")) as CountRow
  ).cnt;

  const totalWorkers = (
    (await db
      .prepare("SELECT COUNT(*) as cnt FROM workers WHERE is_active = 1")
      .get()) as CountRow
  ).cnt;

  // Current actuarial snapshot
  const snapshot = getActuarialSnapshot(
    totalPremium,
    totalClaims,
    activePolicies,
    totalWorkers,
    "Current Period",
  );

  // Historical weekly metrics
  const weeklyMetrics = await db
    .prepare(
      "SELECT * FROM actuarial_metrics ORDER BY period_start DESC LIMIT 12",
    )
    .all();

  // Stress scenarios
  const stressScenarios = await db
    .prepare("SELECT * FROM stress_scenarios ORDER BY created_at DESC")
    .all();

  // Run live stress scenarios with current data
  const avgPremium = activePolicies > 0 ? totalPremium / activePolicies : 35;
  const liveMonsoon = runMonsoonStressScenario(totalWorkers || 4, avgPremium);
  const liveDelhiHazard = runDelhiHazardScenario(totalWorkers || 4, avgPremium);

  return NextResponse.json({
    snapshot,
    weeklyMetrics,
    stressScenarios,
    liveStressTests: {
      monsoon: liveMonsoon,
      delhiHazard: liveDelhiHazard,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rate = consumeRateLimit(`actuarial_post:${ip}`, 25, 10 * 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json(
        {
          error: "Too many stress-test requests. Please try again later.",
          retryAfterSeconds: retryAfterSeconds(rate.resetAt),
        },
        { status: 429 },
      );
    }

    const body = await req.json();
    const { scenario, durationDays, triggerFrequency, avgDailyPayout } = body;

    const safeScenario =
      String(scenario || "")
        .trim()
        .slice(0, 80) || "Custom Scenario";
    const safeDurationDays = Math.max(
      1,
      Math.min(365, Number(durationDays) || 30),
    );
    const safeTriggerFrequency = Math.max(
      0.01,
      Math.min(1, Number(triggerFrequency) || 0.5),
    );
    const safeAvgDailyPayout = Math.max(
      1,
      Math.min(20000, Number(avgDailyPayout) || 350),
    );

    const db = getDb();
    const activePolicies = (
      (await db
        .prepare("SELECT COUNT(*) as cnt FROM policies WHERE status = ?")
        .get("active")) as CountRow
    ).cnt;

    const totalPremium = (
      (await db
        .prepare(
          "SELECT COALESCE(SUM(weekly_premium), 0) as total FROM policies WHERE status = ?",
        )
        .get("active")) as SumRow
    ).total;

    const avgPremium = activePolicies > 0 ? totalPremium / activePolicies : 35;
    const workers = Math.max(activePolicies, 4);

    let result;
    if (safeScenario === "monsoon") {
      result = runMonsoonStressScenario(
        workers,
        avgPremium,
        safeAvgDailyPayout || 450,
      );
    } else if (safeScenario === "delhi_hazard") {
      result = runDelhiHazardScenario(
        workers,
        avgPremium,
        safeAvgDailyPayout || 300,
      );
    } else {
      result = runCustomStressScenario(
        safeScenario,
        safeDurationDays,
        safeTriggerFrequency,
        workers,
        avgPremium,
        safeAvgDailyPayout,
      );
    }

    // Save to database
    await db
      .prepare(
        `INSERT INTO stress_scenarios (id, scenario_name, scenario_type, duration_days, trigger_frequency, avg_payout_per_day, total_estimated_payout, total_premium_in_period, bcr_under_stress, loss_ratio_under_stress, is_sustainable, recommendation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `STRESS-${Date.now()}`,
        result.scenarioName,
        result.scenarioType,
        result.durationDays,
        result.triggerFrequency,
        result.avgPayoutPerTriggerDay,
        result.totalEstimatedPayout,
        result.totalPremiumInPeriod,
        result.bcrUnderStress,
        result.lossRatioUnderStress,
        result.isSustainable ? 1 : 0,
        result.recommendation,
      );

    return NextResponse.json({ success: true, result });
  } catch (err) {
    console.error("Stress scenario error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
