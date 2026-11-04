import { authorizeWorker } from "@/lib/server/authorization";
import { getDb } from "@/backend/models/db";
import { isProduction } from "@/lib/server/env";
// Authenticated trigger previews have no financial effect.
import { NextRequest, NextResponse } from "next/server";
import {
  checkAllTriggers,
  simulateTrigger,
} from "@/backend/services/triggers";
import {
  consumeRateLimit,
  getClientIp,
  retryAfterSeconds,
} from "@/lib/server/rate-limit";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const routeRate = consumeRateLimit(`triggers:${ip}`, 60, 10 * 60 * 1000);
    if (!routeRate.allowed) {
      return NextResponse.json(
        {
          error: "Too many trigger checks. Please try again later.",
          retryAfterSeconds: retryAfterSeconds(routeRate.resetAt),
        },
        { status: 429 },
      );
    }

    const body = await req.json();
    const {
      workerId,
      simulate,
      triggerType,
      severity,
    } = body;
    const auth = await authorizeWorker(req, workerId);
    if (auth.response) return auth.response;
    const worker = await getDb().prepare("SELECT city, zone FROM workers WHERE id = ?").get(auth.workerId);
    const safeCity = String(worker.city || "");
    const safeZone = String(worker.zone || "");
    if (simulate && (isProduction || process.env.ENABLE_LOCAL_SIMULATION !== "true")) {
      return NextResponse.json({ error: "Simulation is disabled in this environment" }, { status: 403 });
    }

    // Manual simulation mode for demo
    if (simulate && triggerType) {
      const safeType = String(triggerType).trim() as
        | "heavy_rain"
        | "heatwave"
        | "pollution"
        | "platform_outage"
        | "curfew";
      const safeSeverity = String(severity || "high").toLowerCase() as
        | "moderate"
        | "high"
        | "severe";
      const validTypes = new Set([
        "heavy_rain",
        "heatwave",
        "pollution",
        "platform_outage",
        "curfew",
      ]);
      const validSeverities = new Set(["moderate", "high", "severe"]);

      if (!validTypes.has(safeType)) {
        return NextResponse.json(
          { error: "Unsupported triggerType for simulation" },
          { status: 400 },
        );
      }
      if (!validSeverities.has(safeSeverity)) {
        return NextResponse.json(
          { error: "severity must be moderate, high, or severe" },
          { status: 400 },
        );
      }

      const trigger = simulateTrigger(safeType, safeSeverity);

      return NextResponse.json({ trigger, mode: "simulation", financialEffect: false });
    }

    // Real trigger check with zone-to-coordinate resolution
    const checks = await checkAllTriggers({
      zone: safeZone,
      city: safeCity,
    });
    const { weather, pollution, platform, triggered, zoneContext } = checks;

    return NextResponse.json({
      zoneContext,
      checked: {
        weather: { ...weather },
        pollution: { ...pollution },
        platform: { ...platform },
      },
      triggeredCount: triggered.length,
      claims: [],
      financialEffect: false,
      message: "Preview only. Verified claim ingestion is not configured.",
    });
  } catch (err) {
    console.error("Trigger check error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
