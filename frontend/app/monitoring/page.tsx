"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppState } from "@/frontend/components/providers/AppProvider";
import {
  triggerNotification,
  triggerToast,
} from "@/frontend/components/ui/Notifications";
import { getTriggerEmoji } from "@/backend/utils/store";

let localClaimSequence = 0;

function createLocalClaimId(): string {
  localClaimSequence += 1;
  return `CLM-local-${localClaimSequence}`;
}

function normalizeStatus(
  status: unknown,
): "paid" | "pending" | "review" | "blocked" {
  const value = String(status || "").toLowerCase();
  if (value === "paid" || value === "auto_approved") return "paid";
  if (value === "review") return "review";
  if (value === "blocked") return "blocked";
  return "pending";
}

function getFraudColor(score: number): string {
  if (score <= 24) return "#34d399";
  if (score <= 44) return "#4d9fff";
  if (score <= 69) return "#ff6b35";
  return "#ff3b5c";
}

type GpsStatus =
  | "idle"
  | "checking"
  | "verified"
  | "approximate"
  | "manual_review"
  | "denied"
  | "unsupported"
  | "error";

interface GpsState {
  status: GpsStatus;
  message: string;
  coords?: { lat: number; lon: number };
  accuracyMeters?: number;
  distanceKm?: number;
  zoneSource?: string;
  lastCheckedAt?: string;
}

interface EvidenceState {
  name: string;
  sizeKb: number;
  source: "upload" | "demo";
}

export default function MonitoringPage() {
  const router = useRouter();
  const { worker, addClaim, isLoggedIn, isBootstrapping } = useAppState();
  const [processing, setProcessing] = useState(false);
  const [gpsChecking, setGpsChecking] = useState(false);
  const [evidence, setEvidence] = useState<EvidenceState | null>(null);
  const evidenceInputRef = useRef<HTMLInputElement | null>(null);
  const gpsRequestRef = useRef(0);
  const gpsCheckingRef = useRef(false);
  const [mapZoom, setMapZoom] = useState(12);
  const [gpsState, setGpsState] = useState<GpsState>({
    status: "idle",
    message: "GPS check pending",
  });

  useEffect(() => {
    if (!isBootstrapping && !isLoggedIn) router.replace("/");
  }, [isBootstrapping, isLoggedIn, router]);

  const verifyGps = useCallback(async () => {
    if (
      typeof window !== "undefined" &&
      !window.isSecureContext &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1"
    ) {
      setGpsState({
        status: "unsupported",
        message:
          "GPS requires HTTPS or localhost. Open the app on a secure origin.",
        lastCheckedAt: new Date().toISOString(),
      });
      return;
    }

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsState({
        status: "unsupported",
        message: "This device/browser does not support GPS geolocation.",
        lastCheckedAt: new Date().toISOString(),
      });
      return;
    }

    // Use ref for reliable concurrency check
    if (gpsCheckingRef.current) return;
    gpsCheckingRef.current = true;
    setGpsChecking(true);

    // Hard failsafe — ALWAYS reset after 20s no matter what
    const failsafeTimer = setTimeout(() => {
      gpsCheckingRef.current = false;
      setGpsChecking(false);
    }, 20000);

    const requestId = gpsRequestRef.current + 1;
    gpsRequestRef.current = requestId;

    setGpsState((prev) => ({
      ...prev,
      status: "checking",
      message: "Checking live GPS lock...",
      lastCheckedAt: new Date().toISOString(),
    }));

    const checkingWatchdog =
      typeof window !== "undefined"
        ? window.setTimeout(() => {
            if (gpsRequestRef.current !== requestId) return;
            gpsRequestRef.current += 1;
            setGpsState({
              status: "manual_review",
              message:
                "GPS check took too long. Enable location permission or continue with manual review.",
              lastCheckedAt: new Date().toISOString(),
            });
            setGpsChecking(false);
          }, 15000)
        : undefined;

    try {
      const position = await new Promise<GeolocationPosition>(
        (resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 12000,
            maximumAge: 0,
          });
        },
      );

      if (gpsRequestRef.current !== requestId) return;

      const workerLocation = {
        lat: Number(position.coords.latitude.toFixed(6)),
        lon: Number(position.coords.longitude.toFixed(6)),
      };
      const accuracyMeters = Math.round(position.coords.accuracy || 0);

      const res = await fetch("/api/gps/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city: worker?.city || "Mumbai",
          zone: worker?.zone || "Andheri East",
          workerLocation,
          gpsAccuracyMeters: accuracyMeters,
        }),
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(String(payload?.error || "GPS verification failed"));
      }

      if (gpsRequestRef.current !== requestId) return;

      const apiStatus = String(payload?.status || "manual_review");
      const status: GpsStatus =
        apiStatus === "verified"
          ? "verified"
          : apiStatus === "approximate"
            ? "approximate"
            : "manual_review";

      setGpsState({
        status,
        message:
          typeof payload?.guidance === "string" && payload.guidance.trim()
            ? payload.guidance
            : "GPS check complete",
        coords: workerLocation,
        accuracyMeters: Number(payload?.gpsAccuracyMeters || accuracyMeters),
        distanceKm: Number(payload?.distanceKm || 0),
        zoneSource: String(payload?.zoneContext?.source || "unknown"),
        lastCheckedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (gpsRequestRef.current !== requestId) return;

      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        typeof (error as GeolocationPositionError).code === "number"
      ) {
        const geolocationError = error as GeolocationPositionError;
        const deniedMessage =
          geolocationError.code === geolocationError.PERMISSION_DENIED
            ? "GPS permission denied. Enable location to strengthen fraud validation."
            : geolocationError.code === geolocationError.POSITION_UNAVAILABLE
              ? "GPS position unavailable right now. Move to open sky and retry."
              : "GPS request timed out. Retry once network/location improves.";

        setGpsState({
          status:
            geolocationError.code === geolocationError.PERMISSION_DENIED
              ? "denied"
              : "error",
          message: deniedMessage,
          lastCheckedAt: new Date().toISOString(),
        });
      } else {
        setGpsState({
          status: "error",
          message:
            "Unable to verify GPS right now. You can continue with screenshot evidence.",
          lastCheckedAt: new Date().toISOString(),
        });
      }
    } finally {
      if (checkingWatchdog !== undefined) {
        window.clearTimeout(checkingWatchdog);
      }
      clearTimeout(failsafeTimer);

      if (gpsRequestRef.current === requestId) {
        gpsCheckingRef.current = false;
        setGpsChecking(false);
      }
    }
  }, [worker?.city, worker?.zone]);

  useEffect(() => {
    if (isBootstrapping || !isLoggedIn) return;
    void verifyGps();
  }, [isBootstrapping, isLoggedIn, verifyGps]);

  if (isBootstrapping) {
    return null;
  }

  const dailyIncome = worker ? Math.round(worker.avgWeeklyEarnings / 7) : 1000;
  const hoursPerDay = worker?.hoursPerDay || 7;
  const avgIncomePerHour = parseFloat((dailyIncome / hoursPerDay).toFixed(2));
  const lostHours = 6;
  const calculatedClaim = Math.round(lostHours * avgIncomePerHour);

  const handleClaim = async () => {
    if (!worker?.id) {
      triggerToast("Worker profile missing. Please login again.", "error");
      return;
    }

    setProcessing(true);
    triggerNotification({
      emoji: "🌍",
      title: "Zone Disruption Claim — Fraud Screening",
      subtitle: "Disruption mapped and queued for verification",
      value: "Risk + eligibility checks running",
      amount: calculatedClaim,
    });

    await new Promise((r) => setTimeout(r, 1200));

    try {
      const res = await fetch("/api/triggers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workerId: worker.id,
          simulate: true,
          triggerType: "curfew",
          severity: "high",
          zone: worker.zone || "Andheri East",
          city: worker.city || "Mumbai",
          workerLocation: gpsState.coords,
          gpsAccuracyMeters: gpsState.accuracyMeters,
          evidenceName: evidence?.name,
        }),
      });

      const payload = await res.json();
      const claimData = (payload?.claim || {}) as {
        claimId?: string;
        amount?: number;
        status?: string;
        settlement?: { transactionRef?: string; channel?: string };
        fraud?: { score?: number; label?: string };
        fraudScore?: number;
        fraudLabel?: string;
        error?: string;
      };

      const status =
        res.status === 403 ? "blocked" : normalizeStatus(claimData.status);
      const fraudScore = Number(
        claimData.fraud?.score ?? claimData.fraudScore ?? 0,
      );
      const fraudLabel =
        claimData.fraud?.label ||
        claimData.fraudLabel ||
        `${fraudScore}/100 ${status === "blocked" ? "Blocked" : "Scored"}`;
      const settledAmount = Number(claimData.amount || calculatedClaim);

      if (status !== "blocked") {
        addClaim({
          id: claimData.claimId || createLocalClaimId(),
          triggerType: "curfew",
          triggerEmoji: getTriggerEmoji("curfew"),
          triggerName: "Local Map Disruption",
          triggerValue: "Zone disruption validated with evidence",
          amount: settledAmount,
          status,
          fraudScore,
          fraudLabel,
          fraudColor: getFraudColor(fraudScore),
          payoutRef:
            claimData.settlement?.transactionRef ||
            (status === "paid" ? "UPI-TXN-APPROVED" : "UNDER-REVIEW"),
          timestamp: new Date().toISOString(),
          relativeTime: "Just now",
          zone: worker.zone || "Andheri East",
        });
      }

      if (status === "paid") {
        triggerToast(
          `₹${settledAmount} approved via ${claimData.settlement?.channel || "UPI"} ✓`,
          "success",
        );
        setEvidence(null);
      } else if (status === "review") {
        triggerToast(
          "Claim queued for manual fraud review. No payout yet.",
          "success",
        );
        setEvidence(null);
      } else if (status === "blocked") {
        triggerToast(
          claimData.error || "Claim blocked by fraud checks.",
          "error",
        );
      } else {
        triggerToast("Claim captured and pending verification.", "success");
      }
    } catch {
      triggerToast("Unable to file disruption claim right now.", "error");
    } finally {
      setProcessing(false);
    }
  };

  const handleScreenshotUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const sizeKb = Math.max(1, Math.round(file.size / 1024));
    setEvidence({ name: file.name, sizeKb, source: "upload" });
    triggerToast("Screenshot attached successfully", "success");
  };

  const handleUseDemoEvidence = () => {
    setEvidence({
      name: "demo-zone-evidence.jpg",
      sizeKb: 148,
      source: "demo",
    });
    triggerToast("Demo evidence attached", "success");
  };

  const gpsBannerClasses =
    gpsState.status === "verified"
      ? "bg-emerald-50 border-emerald-200 text-emerald-700"
      : gpsState.status === "approximate"
        ? "bg-amber-50 border-amber-200 text-amber-700"
        : gpsState.status === "checking" || gpsState.status === "idle"
          ? "bg-blue-50 border-blue-100 text-blue-700"
          : "bg-red-50 border-red-200 text-red-700";

  const gpsStatusLabel =
    gpsState.status === "verified"
      ? "GPS Verified"
      : gpsState.status === "approximate"
        ? "GPS Approximate"
        : gpsState.status === "idle"
          ? "GPS Pending"
          : gpsState.status === "checking"
            ? "Checking GPS"
            : gpsState.status === "manual_review"
              ? "Manual Review"
              : gpsState.status === "denied"
                ? "Permission Needed"
                : gpsState.status === "unsupported"
                  ? "GPS Unsupported"
                  : "GPS Unavailable";

  const mapQuery = gpsState.coords
    ? `${gpsState.coords.lat},${gpsState.coords.lon}`
    : `${worker?.zone || "Andheri East"}, ${worker?.city || "Mumbai"}, India`;

  return (
    <div className="space-y-4 max-w-120 mx-auto fade-in pb-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Live Monitoring
          </h1>
          <p className="text-sm text-gray-500">
            Real-time environmental data with admin-reviewed claims
          </p>
        </div>
        <button
          onClick={() => void verifyGps()}
          disabled={gpsChecking}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-100 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition disabled:opacity-60"
        >
          <span>🔄</span> {gpsChecking ? "Checking..." : "Refresh GPS"}
        </button>
      </div>

      {/* Location Banner */}
      <div
        className={`border p-3 rounded-lg flex items-center justify-between ${gpsBannerClasses}`}
      >
        <div className="text-xs flex flex-wrap gap-1">
          <span>📍</span>
          <span>{gpsStatusLabel}:</span>
          <span className="font-bold">{worker?.zone || "Mumbai"}</span>
          {typeof gpsState.distanceKm === "number" && (
            <span>• {gpsState.distanceKm.toFixed(2)} km from mapped zone</span>
          )}
          {typeof gpsState.accuracyMeters === "number" && (
            <span>• ±{gpsState.accuracyMeters}m accuracy</span>
          )}
          <span>• {gpsState.message}</span>
        </div>
        <button
          onClick={() => void verifyGps()}
          disabled={gpsChecking}
          className="px-2.5 py-1 rounded text-[10px] font-bold uppercase shrink-0 bg-white/70 border border-current/20 disabled:opacity-60"
        >
          {gpsChecking ? "Checking" : "Re-check"}
        </button>
      </div>

      {/* Disruption Alert */}
      <div className="bg-red-50 border border-red-200 p-3 rounded-lg flex gap-3 shadow-sm">
        <div className="text-red-500 text-xl">⚠️</div>
        <div className="flex-1">
          <div className="text-sm font-bold text-red-700">
            Active Disruption Detected: Heavy Rain
          </div>
          <div className="text-xs text-red-600 flex items-center gap-1 mt-0.5">
            <span className="w-3 h-3 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[8px]">
              ✓
            </span>
            You are eligible to submit a review-gated claim
          </div>
        </div>
      </div>

      {/* Metrics Grid */}
      <div>
        <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2 px-1">
          Live Conditions
        </div>
        <div className="grid grid-cols-2 gap-3">
          {/* Rainfall */}
          <div className="border border-red-200 bg-red-50/50 p-3 rounded-xl relative">
            <div className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <div className="text-xl mb-1">🌧️</div>
            <div className="text-[10px] font-bold text-gray-500 uppercase">
              Rainfall
            </div>
            <div className="text-xl font-black text-red-600">65 mm</div>
            <div className="text-[9px] text-red-500 font-bold mt-1">
              ⚠️ Heavy Rain Detected
            </div>
          </div>
          {/* Temperature */}
          <div className="border border-slate-100 bg-white p-3 rounded-xl shadow-sm">
            <div className="text-xl mb-1">🌡️</div>
            <div className="text-[10px] font-bold text-gray-500 uppercase">
              Temperature
            </div>
            <div className="text-xl font-black text-slate-800">35°C</div>
            <div className="text-[9px] text-slate-500 mt-1">Humidity: 72%</div>
          </div>
          {/* AQI */}
          <div className="border border-slate-100 bg-white p-3 rounded-xl shadow-sm">
            <div className="text-xl mb-1">💨</div>
            <div className="text-[10px] font-bold text-gray-500 uppercase">
              AQI Level
            </div>
            <div className="text-xl font-black text-slate-800">26</div>
            <div className="text-[9px] text-emerald-500 font-bold mt-1">
              Good
            </div>
          </div>
          {/* Traffic */}
          <div className="border border-slate-100 bg-white p-3 rounded-xl shadow-sm">
            <div className="text-xl mb-1">🚦</div>
            <div className="text-[10px] font-bold text-gray-500 uppercase">
              Traffic Ratio
            </div>
            <div className="text-xl font-black text-slate-800">0.80</div>
            <div className="text-[9px] text-emerald-500 font-bold mt-1">
              Normal flow
            </div>
          </div>
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="h-56 relative bg-slate-200 w-full">
          {/* Google Maps Embed */}
          <iframe
            src={`https://maps.google.com/maps?q=${encodeURIComponent(mapQuery)}&t=&z=${mapZoom}&ie=UTF8&iwloc=&output=embed`}
            width="100%"
            height="100%"
            style={{ border: 0 }}
            allowFullScreen={false}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          ></iframe>

          {/* Zoom Controls */}
          <div className="absolute bottom-2 left-2 flex flex-col gap-1">
            <button
              onClick={() => setMapZoom((z) => Math.min(z + 2, 20))}
              className="w-8 h-8 rounded-lg bg-white/95 border border-slate-200 shadow-md flex items-center justify-center text-lg font-bold text-slate-700 hover:bg-slate-50 active:bg-slate-100 transition-all"
              title="Zoom In"
            >
              +
            </button>
            <button
              onClick={() => setMapZoom((z) => Math.max(z - 2, 4))}
              className="w-8 h-8 rounded-lg bg-white/95 border border-slate-200 shadow-md flex items-center justify-center text-lg font-bold text-slate-700 hover:bg-slate-50 active:bg-slate-100 transition-all"
              title="Zoom Out"
            >
              −
            </button>
          </div>

          {/* Zoom Level Indicator */}
          <div className="absolute bottom-2 left-12 bg-white/90 px-2 py-1 rounded-md text-[9px] font-bold text-slate-500 border border-slate-200 shadow-sm">
            {mapZoom}× Zoom
          </div>

          <div className="absolute top-2 right-2 bg-white/90 p-2 rounded-lg shadow-sm border border-slate-200">
            <div className="text-[10px] uppercase font-bold text-slate-500">
              Status
            </div>
            <div className="text-xs font-semibold text-amber-600 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
              Disruption detected
            </div>
          </div>
        </div>

        <div className="p-4 bg-slate-800 text-white">
          <h3 className="font-bold text-lg mb-2">
            Claim Calculation Breakdown
          </h3>
          <div className="font-mono text-sm text-slate-300 space-y-1 bg-slate-900 border border-slate-700 p-3 rounded-lg">
            <div>
              Avg Daily Income (₹):{" "}
              <span className="text-white">{dailyIncome}</span>
            </div>
            <div>
              Working Hours/Day:{" "}
              <span className="text-white">{hoursPerDay}</span>
            </div>
            <div className="pb-1 border-b border-slate-700">
              Average Income/Hour: {dailyIncome}/{hoursPerDay}={" "}
              <span className="text-white">₹{avgIncomePerHour}</span>
            </div>
            <div className="pt-1 text-primary-400">
              Day claim: {lostHours} * Average Income/Hour = {lostHours} *{" "}
              {avgIncomePerHour} ~ ₹{calculatedClaim}
            </div>
            <div className="font-bold text-lg text-emerald-400 mt-1">
              Claim: ₹{calculatedClaim}
            </div>
          </div>

          <div className="mt-3 bg-slate-900 p-3 rounded-lg border border-slate-700">
            <div className="text-[10px] uppercase font-bold text-slate-400 mb-2">
              Evidence Required
            </div>
            <input
              ref={evidenceInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleScreenshotUpload}
            />
            {evidence ? (
              <div className="p-2 bg-slate-800 rounded-md text-[10px] text-primary-300 flex items-center justify-between border border-slate-600">
                <span>
                  📷 {evidence.name} ({evidence.sizeKb} KB)
                  {evidence.source === "demo" ? " · demo" : ""}
                </span>
                <button
                  onClick={() => setEvidence(null)}
                  className="text-red-400 font-bold text-xs p-1"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  onClick={() => evidenceInputRef.current?.click()}
                  className="w-full border border-dashed border-slate-500 bg-slate-800 text-slate-300 py-3 rounded-lg text-xs hover:bg-slate-700 transition"
                >
                  + Upload Incident Screenshot
                </button>
                <button
                  onClick={handleUseDemoEvidence}
                  className="w-full border border-slate-600 bg-slate-800 text-slate-300 py-2 rounded-lg text-[11px] hover:bg-slate-700 transition"
                >
                  Use Demo Evidence
                </button>
              </div>
            )}
          </div>

          <button
            onClick={handleClaim}
            disabled={processing || !evidence}
            className={`w-full mt-4 flex flex-col items-center justify-center py-3 rounded-xl font-bold transition-all text-white shadow-xl ${processing || !evidence ? "bg-slate-700 opacity-50 cursor-not-allowed border-none" : "bg-linear-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 border border-red-400"}`}
          >
            <div className="flex items-center gap-2 text-lg">
              <span>⚡</span>{" "}
              {processing ? "Processing..." : "File Disruption Claim"}
            </div>
            {!processing && (
              <div className="text-[10px] font-medium opacity-90">
                ✓ Disruption confirmed — queued for admin review
              </div>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
