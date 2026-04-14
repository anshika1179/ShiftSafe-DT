// POST /api/triggers — Check all trigger sources and auto-file claims
import { NextRequest, NextResponse } from "next/server";
import {
  checkAllTriggers,
  resolveZoneContext,
  simulateTrigger,
} from "@/backend/services/triggers";
import { getDb } from "@/backend/models/db";
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
      zone,
      city,
      simulate,
      triggerType,
      severity,
      workerLocation,
      gpsAccuracyMeters,
    } = body;
    const safeZone =
      String(zone || "Andheri West")
        .trim()
        .slice(0, 80) || "Andheri West";
    const safeCity =
      String(city || "Mumbai")
        .trim()
        .slice(0, 60) || "Mumbai";
    const safeWorkerId = workerId ? String(workerId).trim() : "";

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

      if (safeWorkerId) {
        const zoneContext = await resolveZoneContext(safeZone, safeCity);

        // Auto-file claim
        const claimRes = await fetch(new URL("/api/claims", req.url), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workerId: safeWorkerId,
            triggerType: trigger.type,
            severity: trigger.severity,
            zone: safeZone,
            city: safeCity,
            workerLocation,
            gpsAccuracyMeters,
            triggerLocation: {
              lat: zoneContext.lat,
              lon: zoneContext.lon,
            },
          }),
        });

        let claimData: unknown = {};
        try {
          claimData = await claimRes.json();
        } catch {
          claimData = { error: "Claim service returned invalid JSON" };
        }

        return NextResponse.json(
          {
            trigger,
            claim: claimData,
            claimStatusCode: claimRes.status,
          },
          { status: claimRes.status },
        );
      }

      return NextResponse.json({ trigger });
    }

    // Real trigger check with zone-to-coordinate resolution
    const checks = await checkAllTriggers({
      zone: safeZone,
      city: safeCity,
    });
    const { weather, pollution, platform, triggered, zoneContext } = checks;

    // Log trigger events
    const db = getDb();
    for (const t of [weather, pollution, platform]) {
      await db
        .prepare(
          `INSERT INTO trigger_events (id, event_type, zone, city, severity, raw_data, source, is_processed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          crypto.randomUUID(),
          t.type,
          zoneContext.zone,
          zoneContext.city,
          t.severity,
          JSON.stringify(t.rawData),
          t.sourceApi,
          t.triggered ? 1 : 0,
        );
    }

    // Auto-file claims for triggered events
    const claims = [];
    if (safeWorkerId && triggered.length > 0) {
      for (const t of triggered) {
        try {
          const claimRes = await fetch(new URL("/api/claims", req.url), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workerId: safeWorkerId,
              triggerType: t.type,
              severity: t.severity,
              zone: zoneContext.zone,
              city: zoneContext.city,
              workerLocation,
              gpsAccuracyMeters,
              triggerLocation: {
                lat: zoneContext.lat,
                lon: zoneContext.lon,
              },
            }),
          });
          const claimData = await claimRes.json();
          claims.push(claimData);
        } catch {
          // Continue checking other triggers
        }
      }
    }

    return NextResponse.json({
      zoneContext,
      checked: {
        weather: { ...weather },
        pollution: { ...pollution },
        platform: { ...platform },
      },
      triggeredCount: triggered.length,
      claims,
    });
  } catch (err) {
    console.error("Trigger check error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
