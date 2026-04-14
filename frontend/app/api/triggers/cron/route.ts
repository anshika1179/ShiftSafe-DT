import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { checkAllTriggers } from "@/backend/services/triggers";
import { detectFraudAdvanced } from "@/backend/engines/fraud-engine";
import { getDb } from "@/backend/models/db";
import { getCronSecret } from "@/lib/server/env";

function safeCompareSecret(input: string, expected: string): boolean {
  if (!input || !expected) return false;
  const left = Buffer.from(input);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function GET(req: Request) {
  const db = getDb();
  const runId = crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2);
  const startedAt = new Date().toISOString();

  try {
    const authHeader = req.headers.get("authorization");
    const expectedSecret = getCronSecret();
    const providedSecret = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : "";

    if (!safeCompareSecret(providedSecret, expectedSecret)) {
      return NextResponse.json(
        { error: "Unauthorized CRON execution" },
        { status: 401 },
      );
    }

    console.log("[CRON] Starting Global Zero-Touch Automation Engine...");

    await db
      .prepare(
        `
      INSERT INTO trigger_monitor_runs (id, status, started_at, scanned_zones, detected_events, payouts_initiated, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        runId,
        "running",
        startedAt,
        0,
        0,
        0,
        JSON.stringify({ source: "api/triggers/cron" }),
      );

    // 1. Fetch all unique active zones where riders are operating today
    const zonesQuery = (await db
      .prepare(
        `
      SELECT DISTINCT w.zone as zone, w.city as city
      FROM workers w
      JOIN policies p ON w.id = p.worker_id
      WHERE p.status = 'active'
    `,
      )
      .all()) as { zone: string; city: string }[];

    const zones = zonesQuery.filter((z) => z.zone);
    if (zones.length === 0) {
      await db
        .prepare(
          `
        UPDATE trigger_monitor_runs
        SET status = ?, finished_at = ?, scanned_zones = ?, metadata = ?
        WHERE id = ?
      `,
        )
        .run(
          "completed",
          new Date().toISOString(),
          0,
          JSON.stringify({
            source: "api/triggers/cron",
            message: "No active policies to monitor",
          }),
          runId,
        );
      return NextResponse.json({ message: "No active policies to monitor." });
    }

    const totalPayoutsInitiated = 0;
    let claimsSentForReview = 0;
    let blockedClaims = 0;
    const eventsDetected: Array<{
      type: string;
      zone: string;
      city: string;
      severity: string;
    }> = [];

    // 2. Iterate through each zone and check external APIs
    for (const zoneEntry of zones) {
      const checks = await checkAllTriggers({
        zone: zoneEntry.zone,
        city: zoneEntry.city || "Mumbai",
      });
      const activeTriggers = checks.triggered;

      // 3. Log all checks (triggered + normal) for observability
      for (const t of [checks.weather, checks.pollution, checks.platform]) {
        await db
          .prepare(
            `
          INSERT INTO trigger_events (id, event_type, zone, city, severity, raw_data, source, is_processed)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
          )
          .run(
            crypto.randomUUID
              ? crypto.randomUUID()
              : Math.random().toString(36).substring(2),
            t.type,
            checks.zoneContext.zone,
            checks.zoneContext.city,
            t.severity,
            JSON.stringify({
              ...t.rawData,
              monitor_run_id: runId,
              coordinate_source: checks.zoneContext.source,
              lat: checks.zoneContext.lat,
              lon: checks.zoneContext.lon,
            }),
            t.sourceApi,
            t.triggered ? 1 : 0,
          );
      }

      if (activeTriggers.length > 0) {
        // 4. Log the disaster events globally for transparency
        for (const t of activeTriggers) {
          eventsDetected.push({
            type: t.type,
            zone: checks.zoneContext.zone,
            city: checks.zoneContext.city,
            severity: t.severity,
          });
        }

        // 5. Find all active policies in this specific disaster zone
        const affectedWorkers = (await db
          .prepare(
            `
          SELECT w.id as workerId, p.id as policyId, p.max_coverage_per_week, w.avg_weekly_income 
          FROM workers w
          JOIN policies p ON w.id = p.worker_id
          WHERE w.zone = ? AND p.status = 'active'
        `,
          )
          .all(checks.zoneContext.zone)) as Array<{
          workerId: string;
          policyId: string;
          max_coverage_per_week: number;
          avg_weekly_income: number;
        }>;

        // 6. Evaluate claims for everyone affected with fraud-gated automation
        for (const worker of affectedWorkers) {
          for (const trigger of activeTriggers) {
            // Check if claim for same event already happened today
            const todayClaims = (await db
              .prepare(
                `
              SELECT COUNT(*) as cnt FROM claims 
              WHERE worker_id = ? AND trigger_type = ? AND created_at >= date('now')
            `,
              )
              .get(worker.workerId, trigger.type)) as { cnt: number };

            if (todayClaims.cnt > 0) {
              console.log(
                `Worker ${worker.workerId} already claimed for ${trigger.type} today.`,
              );
              continue; // Skip duplicate daily trigger
            }

            // Check weekly claim limit
            const weekClaims = (await db
              .prepare(
                `
               SELECT COALESCE(SUM(amount), 0) as total FROM claims 
               WHERE worker_id = ? AND created_at >= datetime('now', '-7 days')
            `,
              )
              .get(worker.workerId)) as { total: number };

            const maxPayoutCap = Math.round(worker.avg_weekly_income * 0.5);
            const payoutAmount = Math.min(trigger.payoutAmount, maxPayoutCap);

            if (
              weekClaims.total + payoutAmount >
              worker.max_coverage_per_week
            ) {
              console.log(
                `Worker ${worker.workerId} reached max weekly coverage.`,
              );
              continue; // Skip if it exceeds weekly coverage
            }

            const claimsLast30Days = (await db
              .prepare(
                `
              SELECT COUNT(*) as cnt FROM claims
              WHERE worker_id = ? AND created_at >= datetime('now', '-30 days')
            `,
              )
              .get(worker.workerId)) as { cnt: number };

            const fraudResult = detectFraudAdvanced({
              claimAlreadyToday: (todayClaims?.cnt || 0) > 0,
              policyActive: true,
              claimAmount: payoutAmount,
              dailyAverage: Math.max(
                1,
                Math.round(worker.avg_weekly_income / 7),
              ),
              claimsLast30Days: claimsLast30Days?.cnt || 0,
              gpsAccuracyMeters: 35,
              travelSpeedKmph: 28,
              zoneRadiusKm: 5,
            });

            const claimId = crypto.randomUUID
              ? crypto.randomUUID()
              : Math.random().toString(36).substring(2);
            const triggerDescription = `${trigger.description} — monitor run ${runId}`;

            try {
              if (fraudResult.decision === "BLOCKED") {
                await db
                  .prepare(
                    `
                INSERT INTO claims (id, policy_id, worker_id, trigger_type, trigger_description, amount, status, zone, payout_method, payout_channel, settlement_status, evidence_data, processed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
              `,
                  )
                  .run(
                    claimId,
                    worker.policyId,
                    worker.workerId,
                    trigger.type,
                    triggerDescription,
                    payoutAmount,
                    "blocked",
                    checks.zoneContext.zone,
                    "manual_review",
                    "manual_review",
                    "blocked",
                    JSON.stringify({
                      source: "cron_automation",
                      runId,
                      fraudScore: fraudResult.score,
                      fraudLabel: fraudResult.label,
                      flags: fraudResult.flags,
                      mlScore: fraudResult.mlScore,
                      reviewPriority: "high",
                    }),
                  );
                blockedClaims++;
                continue;
              }

              const reviewPriority =
                fraudResult.decision === "REVIEW" ? "high" : "normal";

              await db
                .prepare(
                  `
                INSERT INTO claims (id, policy_id, worker_id, trigger_type, trigger_description, amount, status, zone, payout_method, payout_channel, settlement_status, evidence_data, processed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
              `,
                )
                .run(
                  claimId,
                  worker.policyId,
                  worker.workerId,
                  trigger.type,
                  triggerDescription,
                  payoutAmount,
                  "review",
                  checks.zoneContext.zone,
                  "manual_review",
                  "manual_review",
                  "pending",
                  JSON.stringify({
                    source: "cron_automation",
                    runId,
                    fraudScore: fraudResult.score,
                    fraudLabel: fraudResult.label,
                    flags: fraudResult.flags,
                    mlScore: fraudResult.mlScore,
                    reviewPriority,
                  }),
                );

              claimsSentForReview++;
            } catch {
              console.error(
                "Failed to queue review claim for worker:",
                worker.workerId,
              );
            }
          }
        }
      }
    }

    await db
      .prepare(
        `
      UPDATE trigger_monitor_runs
      SET status = ?, finished_at = ?, scanned_zones = ?, detected_events = ?, payouts_initiated = ?, metadata = ?
      WHERE id = ?
    `,
      )
      .run(
        "completed",
        new Date().toISOString(),
        zones.length,
        eventsDetected.length,
        totalPayoutsInitiated,
        JSON.stringify({
          source: "api/triggers/cron",
          eventDetails: eventsDetected,
          reviewClaims: claimsSentForReview,
          blockedClaims,
        }),
        runId,
      );

    return NextResponse.json({
      success: true,
      message: "[CRON] Trigger sweep complete. Claims queued for admin review.",
      runId,
      metrics: {
        zonesScanned: zones.length,
        eventsDetected: eventsDetected.length,
        totalPayoutsInitiated,
        claimsSentForReview,
        blockedClaims,
        eventDetails: eventsDetected,
      },
    });
  } catch (error) {
    await db
      .prepare(
        `
      UPDATE trigger_monitor_runs
      SET status = ?, finished_at = ?, metadata = ?
      WHERE id = ?
    `,
      )
      .run(
        "failed",
        new Date().toISOString(),
        JSON.stringify({ source: "api/triggers/cron", error: String(error) }),
        runId,
      );

    console.error("[CRON ERROR]", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
