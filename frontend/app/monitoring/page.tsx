"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppState } from "@/frontend/components/providers/AppProvider";
import {
  triggerToast,
} from "@/frontend/components/ui/Notifications";
import { TRIGGER_RULES } from "@/backend/config/trigger-rules";
import { safeReplace } from "@/lib/client/navigation";

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
  source: "upload";
}

// ── Live Weather & AQI types ──
interface LiveWeather {
  observedAt?: string;
  rainObservedAt?: string;
  temperature: number | null;
  feelsLike: number | null;
  humidity: number | null;
  windSpeed: number | null;
  windGust: number | null;
  rainfall1h: number | null;
  rainfall3h: number;
  visibility: number;
  pressure: number;
  description: string;
  icon: string;
  cloudCover: number;
}

interface LiveAqi {
  observedAt?: string;
  aqi: number | null;
  level: string;
  dominantPollutant: string;
  pm25: number | null;
  pm10: number | null;
}

interface TriggerAlert {
  type: string;
  emoji: string;
  title: string;
  severity: "moderate" | "high" | "severe";
  value: string;
  eligible: boolean;
}

interface LiveData {
  weather: LiveWeather | null;
  aqi: LiveAqi | null;
  triggers: TriggerAlert[];
  fetchedAt: string;
  source: string;
  status: string;
  issues: string[];
  location: { precision: string };
}

function getAqiColor(aqi: number): string {
  if (aqi <= 50) return "#34d399";
  if (aqi <= 100) return "#fbbf24";
  if (aqi <= 150) return "#fb923c";
  if (aqi <= 200) return "#f87171";
  if (aqi <= 300) return "#a855f7";
  return "#dc2626";
}

function getRainfallStatus(mm: number): { label: string; color: string; alert: boolean } {
  if (mm >= 64.5) return { label: "Extreme Rain ⚠️", color: "#dc2626", alert: true };
  if (mm >= TRIGGER_RULES.rainfallHourlyMm) return { label: "Heavy Rain", color: "#f87171", alert: true };
  if (mm >= 15) return { label: "Moderate Rain", color: "#fbbf24", alert: false };
  if (mm > 0) return { label: "Light Rain", color: "#60a5fa", alert: false };
  return { label: "No Rain", color: "#34d399", alert: false };
}

function getTempStatus(temp: number): { label: string; color: string; alert: boolean } {
  if (temp >= 45) return { label: "Extreme Heat ⚠️", color: "#dc2626", alert: true };
  if (temp >= TRIGGER_RULES.temperatureC) return { label: "Heatwave", color: "#f87171", alert: true };
  if (temp >= 38) return { label: "Very Hot", color: "#fb923c", alert: false };
  if (temp >= 30) return { label: "Warm", color: "#fbbf24", alert: false };
  if (temp >= 20) return { label: "Pleasant", color: "#34d399", alert: false };
  return { label: "Cool", color: "#60a5fa", alert: false };
}

export default function MonitoringPage() {
  const router = useRouter();
  const { worker, isLoggedIn, isBootstrapping } = useAppState();
  const [gpsChecking, setGpsChecking] = useState(false);
  const [evidence, setEvidence] = useState<EvidenceState | null>(null);
  const evidenceInputRef = useRef<HTMLInputElement | null>(null);
  const gpsRequestRef = useRef(0);
  const weatherRequestRef = useRef(0);
  const gpsCheckingRef = useRef(false);
  const [mapZoom, setMapZoom] = useState(14);
  const [gpsState, setGpsState] = useState<GpsState>({
    status: "idle",
    message: "GPS check pending",
  });

  // ── Live weather/AQI state ──
  const [liveData, setLiveData] = useState<LiveData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [clock, setClock] = useState(0);
  useEffect(() => { const tick = () => setClock(Date.now()); tick(); const timer = setInterval(tick, 60000); return () => clearInterval(timer); }, []);
  const [weatherError, setWeatherError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<string>("");

  useEffect(() => {
    if (!isBootstrapping && !isLoggedIn) safeReplace(router, "/");
  }, [isBootstrapping, isLoggedIn, router]);

  // ── Fetch live weather & AQI ──
  const fetchWeather = useCallback(async (lat?: number, lon?: number) => {
    const requestId = ++weatherRequestRef.current;
    setWeatherLoading(true);
    setLiveData(null); setWeatherError("");
    try {
      const params = new URLSearchParams();
      if (lat !== undefined && lon !== undefined) {
        params.set("lat", lat.toFixed(6));
        params.set("lon", lon.toFixed(6));
      }
      params.set("city", worker?.city || "");

      const res = await fetch(`/api/weather?${params.toString()}`);
      const data = await res.json();
      if (weatherRequestRef.current !== requestId) return;
      if (res.ok || data.status === "unavailable") {
        setLiveData(data);
        setLastRefresh(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
      } else throw new Error(data.error || "Environmental data unavailable");
    } catch (error) {
      if (weatherRequestRef.current !== requestId) return;
      setLiveData(null); setWeatherError(error instanceof Error ? error.message : "Environmental data unavailable");
    } finally {
      if (weatherRequestRef.current === requestId) setWeatherLoading(false);
    }
  }, [worker]);

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
      message: "Acquiring GPS lock...",
      lastCheckedAt: new Date().toISOString(),
    }));

    const checkingWatchdog =
      typeof window !== "undefined"
        ? window.setTimeout(() => {
            if (gpsRequestRef.current !== requestId) return;
            gpsRequestRef.current += 1;
            gpsCheckingRef.current = false;
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
      const accuracyMeters = Math.round(position.coords.accuracy);

      // Fetch weather for the GPS location
      void fetchWeather(workerLocation.lat, workerLocation.lon);

      const res = await fetch("/api/gps/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city: worker?.city || "",
          zone: worker?.zone || "",
          workerLocation,
          workerId: worker?.id,
          gpsAccuracyMeters: accuracyMeters,
          observedAt: position.timestamp,
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
        lastCheckedAt: new Date(position.timestamp).toISOString(),
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
            ? "GPS permission denied. Location permission is off; city-center weather remains an unverified preview."
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
            "Unable to verify GPS right now. City-center weather remains an unverified preview.",
          lastCheckedAt: new Date().toISOString(),
        });
      }

      // Still fetch weather using city fallback
      void fetchWeather();
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
  }, [worker, fetchWeather]);

  useEffect(() => {
    if (isBootstrapping || !isLoggedIn) return;
    const timer = window.setTimeout(() => { void verifyGps(); }, 0);
    return () => window.clearTimeout(timer);
  }, [isBootstrapping, isLoggedIn, verifyGps]);

  // Weather preview must not wait for GPS permission, callbacks or watchdogs.
  useEffect(() => {
    if (isBootstrapping || !isLoggedIn) return;
    const timer = window.setTimeout(() => { void fetchWeather(); }, 0);
    return () => window.clearTimeout(timer);
  }, [isBootstrapping, isLoggedIn, fetchWeather]);

  // Auto-refresh weather every 5 minutes
  useEffect(() => {
    if (!isLoggedIn || isBootstrapping) return;
    const interval = setInterval(() => {
      if (gpsState.coords && gpsState.lastCheckedAt && Date.now() - new Date(gpsState.lastCheckedAt).getTime() < TRIGGER_RULES.maxGpsAgeMinutes * 60000) {
        void fetchWeather(gpsState.coords.lat, gpsState.coords.lon);
      } else {
        void fetchWeather();
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isLoggedIn, isBootstrapping, gpsState.coords, gpsState.lastCheckedAt, fetchWeather]);

  if (isBootstrapping) {
    return null;
  }

  const handleScreenshotUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const sizeKb = Math.max(1, Math.round(file.size / 1024));
    setEvidence({ name: file.name, sizeKb, source: "upload" });
    triggerToast("Selected on this device only. No file was uploaded or verified.", "success");
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
      ? "✅ GPS Verified"
      : gpsState.status === "approximate"
        ? "⚠️ GPS Approximate"
        : gpsState.status === "idle"
          ? "📍 GPS Pending"
          : gpsState.status === "checking"
            ? "🔄 Checking GPS..."
            : gpsState.status === "manual_review"
              ? "📋 Manual Review"
              : gpsState.status === "denied"
                ? "🚫 Permission Needed"
                : gpsState.status === "unsupported"
                  ? "❌ GPS Unsupported"
                  : "⚠️ GPS Unavailable";

  // Map uses GPS coordinates when available
  const gpsFresh = !!gpsState.lastCheckedAt && clock - new Date(gpsState.lastCheckedAt).getTime() < TRIGGER_RULES.maxGpsAgeMinutes * 60000;
  const mapQuery = gpsState.coords && gpsFresh
    ? `${gpsState.coords.lat},${gpsState.coords.lon}`
    : `${worker?.zone || ""}, ${worker?.city || ""}, India`;

  // Weather data with fallback
  const weather = liveData?.weather;
  const aqiData = liveData?.aqi;
  const activeTriggers = liveData?.triggers || [];
  const rainfallStatus = weather?.rainfall1h == null ? { label: "Unavailable", color: "#94a3b8", alert: false } : getRainfallStatus(weather.rainfall1h);
  const tempStatus = weather?.temperature == null ? { label: "Unavailable", color: "#94a3b8", alert: false } : getTempStatus(weather.temperature);

  return (
    <div className="space-y-4 max-w-120 mx-auto fade-in pb-8">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2 flex-wrap">
            Environmental preview
            <span className="live-dot" />
          </h1>
          <p className="text-sm text-gray-500">
            Modelled weather · US AQI · client GPS comparison
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              if (gpsState.coords && gpsFresh) void fetchWeather(gpsState.coords.lat, gpsState.coords.lon);
              else void fetchWeather();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-xs font-semibold text-blue-600 hover:bg-blue-100 transition border border-blue-200"
          >
            🌤️ Refresh Data
          </button>
          <button
            onClick={() => void verifyGps()}
            disabled={gpsChecking}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition disabled:opacity-60"
          >
            📍 {gpsChecking ? "Checking..." : "Refresh GPS"}
          </button>
        </div>
      </div>

      {/* ── GPS Location Banner ── */}
      <div
        className={`border p-3 rounded-xl flex items-center justify-between gap-2 ${gpsBannerClasses}`}
      >
        <div className="text-xs flex flex-wrap items-center gap-1.5">
          <span className="font-bold text-sm">{gpsStatusLabel}</span>
          <span className="opacity-80">·</span>
          <span className="font-semibold">{worker?.zone || "Mumbai"}</span>
          {typeof gpsState.distanceKm === "number" && (
            <span className="bg-white/60 px-1.5 py-0.5 rounded">{gpsState.distanceKm.toFixed(2)} km from zone</span>
          )}
          {typeof gpsState.accuracyMeters === "number" && (
            <span className="bg-white/60 px-1.5 py-0.5 rounded">±{gpsState.accuracyMeters}m</span>
          )}
        </div>
        <button
          onClick={() => void verifyGps()}
          disabled={gpsChecking}
          className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase shrink-0 bg-white/70 border border-current/20 disabled:opacity-60 hover:bg-white transition"
        >
          {gpsChecking ? "..." : "Re-check"}
        </button>
      </div>

      {/* ── Active Trigger Alerts ── */}
      {activeTriggers.length > 0 && (
        <div className="space-y-2">
          {activeTriggers.map((trigger, i) => (
            <div
              key={i}
              className={`border p-3 rounded-xl flex gap-3 shadow-sm ${
                trigger.severity === "severe"
                  ? "bg-red-50 border-red-300"
                  : trigger.severity === "high"
                    ? "bg-orange-50 border-orange-300"
                    : "bg-amber-50 border-amber-300"
              }`}
            >
              <div className="text-2xl">{trigger.emoji}</div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold ${
                    trigger.severity === "severe" ? "text-red-700" : trigger.severity === "high" ? "text-orange-700" : "text-amber-700"
                  }`}>
                    {trigger.title}
                  </span>
                  <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${
                    trigger.severity === "severe"
                      ? "bg-red-200 text-red-800"
                      : trigger.severity === "high"
                        ? "bg-orange-200 text-orange-800"
                        : "bg-amber-200 text-amber-800"
                  }`}>
                    {trigger.severity}
                  </span>
                </div>
                <div className="text-xs text-slate-600 mt-0.5">{trigger.value}</div>

              </div>
            </div>
          ))}
        </div>
      )}

      {activeTriggers.length === 0 && !weatherLoading && (
        <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl flex gap-3">
          <div className="text-slate-500 text-xl">ℹ</div>
          <div>
            <div className="text-sm font-bold text-slate-700">{liveData?.status === "available" ? "No configured threshold detected" : "Environmental assessment unavailable or partial"}</div>
            <div className="text-xs text-slate-600">
              Available model data shows no configured threshold crossing. Missing data is unknown, not safe. This preview establishes no cover.
            </div>
          </div>
        </div>
      )}

      {/* ── Modelled conditions Grid ── */}
      <div>
        <div className="flex items-center justify-between mb-2 px-1">
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
            <span className="live-dot" style={{ width: 6, height: 6 }} />
            Modelled conditions
          </div>
          {lastRefresh && (
            <div className="text-[10px] text-gray-400">
              Updated {lastRefresh}
              <span className="ml-1">• {liveData?.status || "unavailable"}</span>
            </div>
          )}
        </div>

        <p className="text-xs text-gray-500 mb-3">Open-Meteo weather estimates; CAMS global air quality is roughly 45 km, not a street sensor. US AQI is not Indian AQI. {liveData?.location?.precision === "city_center" ? "Location: city center, not your work zone." : "Coordinates are client-reported, not verified."} <a className="underline" href="https://open-meteo.com/">Open-Meteo</a> / <a className="underline" href="https://atmosphere.copernicus.eu/">CAMS</a>. Rules {TRIGGER_RULES.version}: rain {TRIGGER_RULES.rainfallHourlyMm} mm in the preceding hour, heat {TRIGGER_RULES.temperatureC}°C, US AQI {TRIGGER_RULES.usAqi}. Preview only, no claim eligibility.</p>
        <p className="text-[10px] text-gray-500 mb-2">Provider times (UTC): weather {weather?.observedAt || "unavailable"}, preceding-hour rain {weather?.rainObservedAt || "unavailable"}, US AQI {aqiData?.observedAt || "unavailable"}. Retrieval time is not observation time.</p>
        {(weatherError || liveData?.issues?.length) ? <p role="alert" className="text-xs text-amber-700 mb-3">{weatherError || liveData?.issues.join("; ")}</p> : null}
        {weatherLoading && !liveData ? (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="skeleton h-28 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {/* Rainfall */}
            <div className={`border p-3 rounded-xl relative ${
              rainfallStatus.alert ? "border-red-200 bg-red-50/50" : "border-slate-100 bg-white"
            }`}>
              {rainfallStatus.alert && (
                <div className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              )}
              <div className="text-xl mb-1">🌧️</div>
              <div className="text-[10px] font-bold text-gray-500 uppercase">Rainfall</div>
              <div className="text-xl font-black" style={{ color: rainfallStatus.color }}>
                {weather?.rainfall1h ?? "—"} mm
              </div>
              <div className="text-[9px] font-bold mt-1" style={{ color: rainfallStatus.color }}>
                {rainfallStatus.label}
              </div>
            </div>

            {/* Temperature */}
            <div className={`border p-3 rounded-xl relative ${
              tempStatus.alert ? "border-red-200 bg-red-50/50" : "border-slate-100 bg-white"
            }`}>
              {tempStatus.alert && (
                <div className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              )}
              <div className="text-xl mb-1">🌡️</div>
              <div className="text-[10px] font-bold text-gray-500 uppercase">Temperature</div>
              <div className="text-xl font-black" style={{ color: tempStatus.color }}>
                {weather?.temperature ?? "—"}°C
              </div>
              <div className="text-[9px] text-slate-500 mt-1">
                Feels {weather?.feelsLike ?? "—"}°C · {weather?.humidity ?? "—"}% humidity
              </div>
            </div>

            {/* AQI */}
            <div className={`border p-3 rounded-xl relative ${
              (aqiData?.aqi ?? 0) >= 200 ? "border-red-200 bg-red-50/50" : "border-slate-100 bg-white"
            }`}>
              {(aqiData?.aqi ?? 0) >= 200 && (
                <div className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              )}
              <div className="text-xl mb-1">💨</div>
              <div className="text-[10px] font-bold text-gray-500 uppercase">Air Quality (US AQI)</div>
              <div className="text-xl font-black" style={{ color: aqiData?.aqi == null ? "#94a3b8" : getAqiColor(aqiData.aqi) }}>
                {aqiData?.aqi ?? "—"}
              </div>
              <div className="text-[9px] font-bold mt-1" style={{ color: aqiData?.aqi == null ? "#94a3b8" : getAqiColor(aqiData.aqi) }}>
                {aqiData?.level ?? "Unavailable"}
              </div>
              {aqiData?.pm25 != null && (
                <div className="text-[8px] text-gray-400 mt-0.5">PM2.5: {aqiData.pm25} µg/m³</div>
              )}
            </div>

            {/* Wind + Visibility */}
            <div className="border border-slate-100 bg-white p-3 rounded-xl">
              <div className="text-xl mb-1">💨</div>
              <div className="text-[10px] font-bold text-gray-500 uppercase">Wind & Visibility</div>
              <div className="text-xl font-black text-slate-800">
                {weather?.windSpeed ?? "—"} <span className="text-sm font-normal text-gray-400">km/h</span>
              </div>
              <div className="text-[9px] text-slate-500 mt-1">
                Visibility unavailable
                {weather?.windGust ? ` · Gust: ${weather.windGust} km/h` : ""}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Map Section ── */}
      <div className="glass-card overflow-hidden">
        <div className="h-56 relative bg-slate-200 w-full">
          {/* Google Maps Embed — zoomed to GPS coords when available */}
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

          {/* GPS Badge */}
          <div className={`absolute top-2 left-2 px-2.5 py-1 rounded-lg text-[10px] font-bold shadow-sm border ${
            gpsState.status === "verified"
              ? "bg-emerald-500 text-white border-emerald-600"
              : gpsState.status === "approximate"
                ? "bg-amber-500 text-white border-amber-600"
                : "bg-white/90 text-slate-600 border-slate-200"
          }`}>
            {gpsState.coords ? `📍 ${gpsState.coords.lat.toFixed(4)}, ${gpsState.coords.lon.toFixed(4)}` : "📍 Zone center"}
          </div>

          {/* Map Status */}
          <div className="absolute top-2 right-2 bg-white/90 p-2 rounded-lg shadow-sm border border-slate-200">
            <div className="text-[10px] uppercase font-bold text-slate-500">Status</div>
            <div className={`text-xs font-semibold flex items-center gap-1 ${
              activeTriggers.length > 0 ? "text-amber-600" : "text-emerald-600"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                activeTriggers.length > 0 ? "bg-amber-500 animate-pulse" : "bg-emerald-500"
              }`} />
              {activeTriggers.length > 0 ? "Configured threshold crossed" : "No verified incident assessment"}
            </div>
          </div>
        </div>

        {/* ── Evidence limitations Panel ── */}
        <div className="p-4 bg-slate-800 text-white">
          <h3 className="font-bold text-lg mb-2 flex items-center gap-2">
            Evidence limitations
            <span className="text-[10px] font-normal bg-slate-700 px-2 py-0.5 rounded-full text-gray-300">Prototype</span>
          </h3>

          {/* Formula Steps */}
          <p className="text-sm text-slate-300 mb-3">No loss amount is calculated. Actual disruption duration and verified work evidence are not available. Claim submission and payouts are disabled.</p>

          {/* Evidence */}
          <div className="bg-slate-900 p-3 rounded-lg border border-slate-700">
            <div className="text-[10px] uppercase font-bold text-slate-400 mb-2">
              Local file selection - not submitted evidence
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
                   · local selection only
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
                  + Select local screenshot (not uploaded)
                </button>

              </div>
            )}
          </div>

          <p className="mt-3 text-xs text-slate-300">No screenshot bytes leave this device. Selecting a file does not submit or verify evidence.</p>

        </div>
      </div>

      {/* ── Automation Pipeline Visualization ── */}
      <div className="glass-card p-4">
        <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
          ⚙️ How Automation Works
          <span className="text-[9px] text-gray-400 font-normal">Step-by-step pipeline</span>
        </h3>
        <div className="space-y-0">
          {[
            { step: 1, icon: "🌡️", title: "Environmental Trigger", desc: "Model estimates cross configured preview rules", status: activeTriggers.length > 0 ? "active" : "monitoring", color: activeTriggers.length > 0 ? "#f97316" : "#94a3b8" },
            { step: 2, icon: "📍", title: "Client GPS comparison", desc: "City-center reference only, not zone verification", status: gpsState.status === "verified" ? "active" : "pending", color: gpsState.status === "verified" ? "#10b981" : "#94a3b8" },
            { step: 3, icon: "🤖", title: "Fraud screening", desc: "Not available: no validated model or evidence", status: "disabled", color: "#3b82f6" },
            { step: 4, icon: "👨‍💼", title: "Admin Review Gate", desc: "Verified claim ingestion not configured", status: "disabled", color: "#8b5cf6" },
            { step: 5, icon: "💰", title: "Settlement & Payout", desc: "Real payments and payouts are disabled", status: "disabled", color: "#10b981" },
          ].map((item, i) => (
            <div key={item.step} className="flex gap-3">
              {/* Connector Line */}
              <div className="flex flex-col items-center">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-sm shadow-sm border-2"
                  style={{ borderColor: item.color, background: `${item.color}15` }}
                >
                  {item.icon}
                </div>
                {i < 4 && (
                  <div className="w-0.5 h-6 bg-slate-200" />
                )}
              </div>
              <div className="flex-1 pb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-800">{item.title}</span>
                  <span
                    className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full"
                    style={{ background: `${item.color}20`, color: item.color }}
                  >
                    {item.status}
                  </span>
                </div>
                <div className="text-[10px] text-gray-500">{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
