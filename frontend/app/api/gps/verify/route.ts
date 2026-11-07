import { NextRequest, NextResponse } from "next/server";
import { resolveZoneContext } from "@/backend/services/triggers";
import { authorizeWorker } from "@/lib/server/authorization";
import { getDb } from "@/backend/models/db";
import { TRIGGER_RULES } from "@/backend/config/trigger-rules";
import {
  consumeRateLimit,
  getClientIp,
  retryAfterSeconds,
} from "@/lib/server/rate-limit";

interface LocationPoint {
  lat: number;
  lon: number;
}

function parseLocation(value: unknown): LocationPoint | null {
  if (!value || typeof value !== "object") return null;

  const coords=value as {lat?:unknown;lon?:unknown};
  if (coords.lat === null || coords.lon === null || coords.lat === "" || coords.lon === "") return null;
  const lat = Number(coords.lat);
  const lon = Number((value as { lon?: unknown }).lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  return { lat, lon };
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function haversineKm(a: LocationPoint, b: LocationPoint): number {
  const R = 6371;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rate = consumeRateLimit(`gps_verify:${ip}`, 80, 10 * 60 * 1000);

    if (!rate.allowed) {
      return NextResponse.json(
        {
          error: "Too many GPS verification attempts. Please retry shortly.",
          retryAfterSeconds: retryAfterSeconds(rate.resetAt),
        },
        { status: 429 },
      );
    }

    const body = await req.json();
    if (req.headers.get("origin") !== req.nextUrl.origin) return NextResponse.json({error:"Invalid GPS origin"},{status:403});
    const auth=await authorizeWorker(req,body.workerId);
    if (auth.response) return auth.response;
    const consents = await getDb().prepare("SELECT gps_location FROM registration_consents WHERE worker_id = ?").get(auth.workerId);
    if (consents?.gps_location !== 1) return NextResponse.json({error:"Recorded location consent is required"},{status:403});
    const worker=await getDb().prepare("SELECT city, zone FROM workers WHERE id = ?").get(auth.workerId);
    const safeCity=String(worker.city || ""),safeZone=String(worker.zone || "");
    const timestamp=Number(body.observedAt);
    if (!Number.isFinite(timestamp) || timestamp > Date.now()+60000 || Date.now()-timestamp >= TRIGGER_RULES.maxGpsAgeMinutes*60000) return NextResponse.json({error:"Fresh location timestamp required (less than 15 minutes old)"},{status:400});
    const workerLocation = parseLocation(body?.workerLocation);
    const rawAccuracy = Number(body?.gpsAccuracyMeters);
    if (body.gpsAccuracyMeters === null || body.gpsAccuracyMeters === "" || !Number.isFinite(rawAccuracy) || rawAccuracy <= 0) return NextResponse.json({error:"Actual location accuracy is required"},{status:400});

    if (!workerLocation) {
      return NextResponse.json(
        { error: "workerLocation with valid lat/lon is required" },
        { status: 400 },
      );
    }

    const zoneContext = await resolveZoneContext(safeZone, safeCity);
    if (!zoneContext) return NextResponse.json({ verified:false, status:"manual_review", guidance:"Work area is unresolved. No location verification is available." });
    const distanceKm = haversineKm(workerLocation, {
      lat: zoneContext.lat,
      lon: zoneContext.lon,
    });
    const accuracyMeters = Number.isFinite(rawAccuracy)
      ? Math.max(0, Math.min(5000, Math.round(rawAccuracy)))
      : 999;

    const withinStrongZone = distanceKm <= 5;
    const withinApproxZone = distanceKm <= 8;
    const strongAccuracy = accuracyMeters <= 120;
    const mediumAccuracy = accuracyMeters <= 250;

    const status =
      zoneContext.precision !== "city_center" && withinStrongZone && strongAccuracy
        ? "verified"
        : withinApproxZone && mediumAccuracy
          ? "approximate"
          : "manual_review";

    return NextResponse.json({
      verified: status === "verified",
      status,
      distanceKm: Number(distanceKm.toFixed(3)),
      gpsAccuracyMeters: accuracyMeters,
      zoneContext,
      guidance:
        status === "verified"
          ? "Client-reported GPS comparison only. This is not device or fraud verification."
          : status === "approximate"
            ? "Client-reported GPS is near the city center. A precise work-zone reference is unavailable; no verified-zone claim is made."
            : "GPS signal is weak or far from mapped zone. Claim may go to manual review.",
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to verify GPS at the moment" },
      { status: 500 },
    );
  }
}
