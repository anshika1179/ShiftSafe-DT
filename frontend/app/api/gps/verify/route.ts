import { NextRequest, NextResponse } from "next/server";
import { resolveZoneContext } from "@/backend/services/triggers";
import { normalizeIndianCityName } from "@/backend/utils/india-market";
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

  const lat = Number((value as { lat?: unknown }).lat);
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
    const safeZone =
      String(body?.zone || "Andheri West")
        .trim()
        .slice(0, 80) || "Andheri West";
    const safeCity = normalizeIndianCityName(body?.city || "Mumbai");
    const workerLocation = parseLocation(body?.workerLocation);
    const rawAccuracy = Number(body?.gpsAccuracyMeters);

    if (!workerLocation) {
      return NextResponse.json(
        { error: "workerLocation with valid lat/lon is required" },
        { status: 400 },
      );
    }

    const zoneContext = await resolveZoneContext(safeZone, safeCity);
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
      withinStrongZone && strongAccuracy
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
          ? "GPS lock is strong. Fraud scoring can use precise distance checks."
          : status === "approximate"
            ? "GPS is usable but weak. Keep screenshot evidence for faster review."
            : "GPS signal is weak or far from mapped zone. Claim may go to manual review.",
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to verify GPS at the moment" },
      { status: 500 },
    );
  }
}
