"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAppState } from "@/frontend/components/providers/AppProvider";
import {
  triggerNotification,
  triggerToast,
} from "@/frontend/components/ui/Notifications";
import {
  getGreeting,
  formatIndianDate,
  getTriggerEmoji,
  getTriggerName,
} from "@/backend/utils/store";

const TRIGGERS = [
  {
    type: "heavy_rain",
    emoji: "🌧️",
    name: "Heavy Rain",
    value: "15mm/hr",
    safeLabel: "Normal",
  },
  {
    type: "heatwave",
    emoji: "🌡️",
    name: "Extreme Heat",
    value: "30°C",
    safeLabel: "Normal",
  },
  {
    type: "pollution",
    emoji: "😷",
    name: "Air Quality",
    value: "AQI 120",
    safeLabel: "Moderate",
  },
  {
    type: "platform_outage",
    emoji: "📱",
    name: "Platform Status",
    value: "Online",
    safeLabel: "Operational",
  },
  {
    type: "zone_closure",
    emoji: "🚧",
    name: "Zone Closures",
    value: "None",
    safeLabel: "Open",
  },
];

const DEFAULT_WEATHER_PILLS = [
  { label: "🌡️ --°C", color: "#f97316" },
  { label: "🌧️ --mm", color: "#4d9fff" },
  { label: "😷 AQI --", color: "#fbbf24" },
  { label: "💨 -- km/h", color: "#8892a4" },
];

const SIMULATOR_BUTTONS = [
  {
    type: "heavy_rain",
    emoji: "🌧️",
    label: "Trigger Heavy Rain",
    desc: "Simulates 67.5mm rainfall → fraud screening",
    borderColor: "border-blue-400/30",
    hoverBg: "hover:bg-blue-50",
  },
  {
    type: "heatwave",
    emoji: "🌡️",
    label: "Trigger Extreme Heat",
    desc: "Simulates 43.2°C → fraud screening",
    borderColor: "border-orange-400/30",
    hoverBg: "hover:bg-orange-50",
  },
  {
    type: "platform_outage",
    emoji: "📵",
    label: "Platform Outage",
    desc: "Simulates 95-min outage → fraud screening",
    borderColor: "border-red-400/30",
    hoverBg: "hover:bg-red-50",
  },
  {
    type: "pollution",
    emoji: "😷",
    label: "Severe Pollution",
    desc: "Simulates AQI 480 → fraud screening",
    borderColor: "border-gray-400/30",
    hoverBg: "hover:bg-gray-50",
  },
];

let localClaimSequence = 0;

function createLocalClaimId(): string {
  localClaimSequence += 1;
  return `CLM-local-${localClaimSequence}`;
}

function getFraudColor(score: number): string {
  if (score <= 24) return "#34d399";
  if (score <= 44) return "#4d9fff";
  if (score <= 69) return "#ff6b35";
  return "#ff3b5c";
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

export default function DashboardPage() {
  const router = useRouter();
  const {
    worker,
    policy,
    claims,
    totalEarningsProtected,
    addClaim,
    isLoggedIn,
    isBootstrapping,
  } = useAppState();
  const [activeTriggers, setActiveTriggers] = useState<string[]>([]);
  const [processing, setProcessing] = useState<string | null>(null);
  const [weatherTips, setWeatherTips] = useState<{
    currentMonth: string;
    riskLevel: string;
    tips: string[];
    nextMonthWarning: string | null;
  } | null>(null);
  const [weatherPills, setWeatherPills] = useState(DEFAULT_WEATHER_PILLS);

  // redirect if not logged in
  useEffect(() => {
    if (!isBootstrapping && !isLoggedIn) router.replace("/");
    // fetch historical weather recommendations
    const qs = worker?.id ? `?workerId=${encodeURIComponent(worker.id)}` : "";
    fetch(`/api/dashboard${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.weatherRecommendations) {
          setWeatherTips(d.weatherRecommendations);
          // Derive weather pill values from the response
          const rec = d.weatherRecommendations;
          const riskLevel = rec.riskLevel || "Low";
          // Use current-month historical data from the recommendations
          const month = new Date().getMonth() + 1;
          // Build smart pills from historical risk model
          const temp =
            riskLevel === "Very High"
              ? 43
              : riskLevel === "High"
                ? 38
                : riskLevel === "Moderate"
                  ? 35
                  : 30;
          const rain =
            riskLevel === "Very High"
              ? 85
              : riskLevel === "High"
                ? 45
                : riskLevel === "Moderate"
                  ? 18
                  : 5;
          const aqi =
            riskLevel === "Very High"
              ? 320
              : riskLevel === "High"
                ? 180
                : riskLevel === "Moderate"
                  ? 120
                  : 75;
          const wind = month >= 6 && month <= 9 ? 25 : 12;
          setWeatherPills([
            { label: `🌡️ ${temp}°C`, color: temp > 40 ? "#ef4444" : "#f97316" },
            { label: `🌧️ ${rain}mm`, color: rain > 50 ? "#3b82f6" : "#4d9fff" },
            {
              label: `😷 AQI ${aqi}`,
              color: aqi > 200 ? "#ef4444" : "#fbbf24",
            },
            { label: `💨 ${wind} km/h`, color: "#8892a4" },
          ]);
        }
      })
      .catch(() => {});

    // Fetch live weather data from weather engine
    const city = worker?.city || 'Mumbai';
    const zone = worker?.zone || 'Andheri East';
    fetch(`/api/weather?city=${encodeURIComponent(city)}&zone=${encodeURIComponent(zone)}`)
      .then((r) => r.json())
      .then((w) => {
        if (w && typeof w.temperature === 'number') {
          setWeatherPills([
            { label: `🌡️ ${w.temperature}°C`, color: w.temperature > 40 ? "#ef4444" : "#f97316" },
            { label: `🌧️ ${w.rainfall}mm`, color: w.rainfall > 50 ? "#3b82f6" : "#4d9fff" },
            { label: `😷 AQI ${w.aqi}`, color: w.aqi > 200 ? "#ef4444" : "#fbbf24" },
            { label: `💨 ${w.windSpeed} km/h`, color: w.windSpeed > 40 ? "#3b82f6" : "#8892a4" },
          ]);
        }
      })
      .catch(() => {});
  }, [isBootstrapping, isLoggedIn, router, worker?.id, worker?.city, worker?.zone]);

  if (isBootstrapping) {
    return (
      <div className="space-y-4 max-w-120 mx-auto fade-in pb-6">
        <div className="h-7 w-48 bg-slate-200 rounded-lg animate-pulse" />
        <div className="glass-card p-6">
          <div className="flex justify-center mb-4">
            <div className="w-20 h-20 rounded-2xl bg-slate-200 animate-pulse" />
          </div>
          <div className="h-8 w-32 mx-auto bg-slate-200 rounded-lg animate-pulse mb-4" />
          <div className="grid grid-cols-3 gap-3 pt-4 border-t border-slate-100">
            {[1, 2, 3].map((i) => (
              <div key={i} className="text-center space-y-2">
                <div className="h-5 w-12 mx-auto bg-slate-200 rounded animate-pulse" />
                <div className="h-3 w-16 mx-auto bg-slate-100 rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
        <div className="glass-card p-5">
          <div className="h-4 w-28 bg-slate-200 rounded animate-pulse mb-3" />
          <div className="h-3 w-full bg-slate-100 rounded-full animate-pulse mb-3" />
          <div className="flex gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-7 w-20 bg-slate-100 rounded-full animate-pulse"
              />
            ))}
          </div>
        </div>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="glass-card px-4 py-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-slate-200 animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-24 bg-slate-200 rounded animate-pulse" />
              <div className="h-3 w-16 bg-slate-100 rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const riskScore = policy?.riskScore ?? 22;
  const riskColor =
    riskScore <= 25
      ? "#34d399"
      : riskScore <= 50
        ? "#4d9fff"
        : riskScore <= 75
          ? "#ff6b35"
          : "#ff3b5c";
  const riskLabel = policy?.riskLabel ?? "Low";
  const currentDate = new Date();
  const currentDateAtMidnight = new Date(currentDate);
  currentDateAtMidnight.setHours(0, 0, 0, 0);

  const daysUntilRenewal = policy?.nextPaymentDue
    ? (() => {
        const renewalDate = new Date(policy.nextPaymentDue);
        renewalDate.setHours(0, 0, 0, 0);
        return Math.max(
          0,
          Math.ceil(
            (renewalDate.getTime() - currentDateAtMidnight.getTime()) /
              86400000,
          ),
        );
      })()
    : 3;

  const handleSimulate = async (triggerType: string) => {
    if (processing) return;
    if (!worker?.id) {
      triggerToast("Worker profile missing. Please login again.", "error");
      return;
    }

    setProcessing(triggerType);
    setActiveTriggers((prev) => [...prev, triggerType]);

    const emoji = getTriggerEmoji(triggerType);
    const name = getTriggerName(triggerType);

    // Step 1: Show push notification
    const earnings = worker?.avgWeeklyEarnings || 4200;
    const coveragePct: Record<string, number> = {
      heavy_rain: 0.7,
      heatwave: 0.5,
      pollution: 0.6,
      platform_outage: 0.8,
    };
    const amount = Math.round(
      (earnings / 7) * (coveragePct[triggerType] ?? 0.5),
    );

    const TRIGGER_DETAILS: Record<string, string> = {
      heavy_rain: "67.5mm in 2 hours · Threshold exceeded",
      heatwave: "43.2°C for 4+ hours · Threshold exceeded",
      pollution: "AQI 480 · Hazardous level detected",
      platform_outage: "95-min Zomato outage · Service disruption",
    };

    triggerNotification({
      emoji,
      title: `${name} Detected — Fraud Screening Started`,
      subtitle: TRIGGER_DETAILS[triggerType] || "Threshold exceeded",
      value: "Risk + eligibility checks running",
      amount,
    });

    await new Promise((r) => setTimeout(r, 800));

    try {
      const res = await fetch("/api/triggers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workerId: worker.id,
          simulate: true,
          triggerType,
          severity: "high",
          zone: worker.zone || "Andheri East",
          city: worker.city || "Mumbai",
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
      const settledAmount = Number(claimData.amount || amount);

      if (status !== "blocked") {
        addClaim({
          id: claimData.claimId || createLocalClaimId(),
          triggerType,
          triggerEmoji: emoji,
          triggerName: name,
          triggerValue: TRIGGER_DETAILS[triggerType] || "Threshold exceeded",
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
          `₹${settledAmount} approved instantly! (Simulated via Razorpay Test Mode) ✓`,
          "success",
        );
      } else if (status === "review") {
        triggerToast(
          "Claim queued for manual fraud review. No payout yet.",
          "success",
        );
      } else if (status === "blocked") {
        triggerToast(
          claimData.error || "Claim blocked by fraud checks.",
          "error",
        );
      } else {
        triggerToast("Claim captured and pending verification.", "success");
      }
    } catch {
      triggerToast("Unable to run trigger simulation right now.", "error");
    }

    // Reset after 5s
    setTimeout(() => {
      setActiveTriggers((prev) => prev.filter((t) => t !== triggerType));
    }, 5000);

    setProcessing(null);
  };

  const recentClaimUpdates = claims
    .filter((c) => c.status === "paid" || c.status === "review")
    .slice(0, 3);

  return (
    <div className="space-y-5 max-w-120 mx-auto fade-in pb-6">
      {/* greeting */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {getGreeting()}, {worker?.name?.split(" ")[0] || "Ravi"} 👋
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {formatIndianDate(currentDate)}
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200">
          <span className="live-dot" />
          <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">
            LIVE
          </span>
        </div>
      </div>

      {/* coverage shield card */}
      <div
        className="glass-card p-6 relative overflow-hidden card-accent-left-green"
        style={{
          borderColor: "rgba(16, 185, 129, 0.3)",
          background: "rgba(16, 185, 129, 0.03)",
        }}
      >
        {/* Protected badge */}
        <div className="absolute top-4 right-4">
          <span className="badge-success inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{" "}
            Protected
          </span>
        </div>

        {/* Shield SVG */}
        <div className="flex justify-center mb-4 mt-2">
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center text-4xl relative"
            style={{
              background: "rgba(249, 115, 22, 0.1)",
              border: "1px solid rgba(249, 115, 22, 0.2)",
            }}
          >
            🛡️
            <div
              className="absolute inset-0 rounded-2xl animate-pulse"
              style={{ boxShadow: "0 0 20px rgba(16, 185, 129, 0.15)" }}
            />
          </div>
        </div>

        <div className="text-center mb-5">
          <div className="text-3xl font-extrabold text-slate-900">
            ₹{policy?.coverageAmount?.toLocaleString() || "2,940"}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Active Weekly Coverage
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 pt-4 border-t border-slate-100">
          <div className="text-center">
            <div className="text-lg font-bold text-primary-500">
              ₹{policy?.weeklyPremium || 28}
            </div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
              Weekly Premium
            </div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-slate-900">
              {daysUntilRenewal}d
            </div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
              Until Renewal
            </div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-emerald-500">
              ₹{totalEarningsProtected.toLocaleString()}
            </div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
              Earnings Protected
            </div>
          </div>
        </div>
      </div>

      {/* zone risk meter */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">
            Zone Risk Meter
          </div>
          <span className="text-xs font-semibold text-slate-800">
            {worker?.zone || "Andheri East"}
          </span>
        </div>

        {/* Risk bar */}
        <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden mb-3">
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{ width: `${riskScore}%`, background: riskColor }}
          />
        </div>
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-semibold" style={{ color: riskColor }}>
            {riskLabel} Risk
          </span>
          <span className="text-xs text-gray-500 font-mono">
            {riskScore}/100
          </span>
        </div>

        {/* Weather pills */}
        <div className="flex flex-wrap gap-2">
          {weatherPills.map((pill, i) => (
            <span
              key={i}
              className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-white border border-slate-100 shadow-sm text-slate-700"
            >
              {pill.label}
            </span>
          ))}
        </div>
      </div>

      {/* actuarial command center banner */}
      <button
        onClick={() => router.push("/actuarial")}
        className="w-full glass-card p-4 flex items-center gap-4 group hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.98] text-left"
        style={{
          background:
            "linear-gradient(135deg, rgba(15,23,42,0.04), rgba(249,115,22,0.06))",
          borderColor: "rgba(249,115,22,0.2)",
        }}
      >
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center text-xl shrink-0"
          style={{ background: "linear-gradient(135deg, #0f172a, #1e293b)" }}
        >
          🧮
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
            Actuarial Command Center
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          </div>
          <div className="text-[11px] text-gray-500">
            BCR monitoring · Stress testing · Settlement flow
          </div>
        </div>
        <span className="text-gray-400 group-hover:text-primary-500 transition-colors text-lg">
          →
        </span>
      </button>

      {/* weather intelligence — uses historical data to recommend */}
      {weatherTips && (
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">
              📅 {weatherTips.currentMonth} Risk Intelligence
            </div>
            <span
              className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase ${
                weatherTips.riskLevel === "Low"
                  ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
                  : weatherTips.riskLevel === "Moderate"
                    ? "bg-amber-50 text-amber-600 border border-amber-200"
                    : "bg-red-50 text-red-600 border border-red-200"
              }`}
            >
              {weatherTips.riskLevel}
            </span>
          </div>
          <div className="space-y-1.5">
            {weatherTips.tips.map((tip, i) => (
              <div
                key={i}
                className="text-[12px] text-gray-600 leading-relaxed"
              >
                {tip}
              </div>
            ))}
          </div>
          {weatherTips.nextMonthWarning && (
            <div className="mt-3 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-700 font-medium">
              {weatherTips.nextMonthWarning}
            </div>
          )}
          <div className="text-[9px] text-gray-400 mt-2 text-right">
            Based on 5-year IMD + CPCB historical data
          </div>
        </div>
      )}

      {/* live triggers */}
      <div>
        <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3 px-1">
          Live Triggers
        </div>
        <div className="space-y-2">
          {TRIGGERS.map((t) => {
            const isActive = activeTriggers.includes(t.type);
            return (
              <div
                key={t.type}
                className="glass-card px-4 py-3 flex items-center gap-3"
              >
                <span className="text-lg">{t.emoji}</span>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-slate-900">
                    {t.name}
                  </div>
                  <div className="text-[11px] text-gray-500">
                    {isActive ? "⚠️ TRIGGERED" : t.value}
                  </div>
                </div>
                <div
                  className={`w-2.5 h-2.5 rounded-full ${isActive ? "bg-red-500 animate-pulse" : "bg-emerald-500"}`}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* recent claim updates */}
      {recentClaimUpdates.length > 0 && (
        <div>
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3 px-1">
            Recent Claims
          </div>
          <div className="space-y-2">
            {recentClaimUpdates.map((c) => (
              <div
                key={c.id}
                className="glass-card px-4 py-3 flex items-center gap-3"
              >
                <span className="text-lg">{c.triggerEmoji}</span>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-slate-900">
                    {c.triggerName}
                  </div>
                  <div className="text-[11px] text-gray-500 flex items-center gap-2">
                    <span>{c.relativeTime}</span>
                    <span className="text-slate-300">•</span>
                    <span
                      className={
                        c.status === "paid"
                          ? "text-emerald-600 font-semibold"
                          : "text-amber-600 font-semibold"
                      }
                    >
                      {c.status === "paid"
                        ? "Approved & Paid"
                        : "Under Admin Review"}
                    </span>
                  </div>
                </div>
                <div className="text-sm font-bold text-emerald-500">
                  ₹{c.amount}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* demo simulator */}
      <div className="pt-4 border-t border-slate-100">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">
            Live Demo — Simulate Trigger
          </h3>
        </div>

        <div className="space-y-2">
          {SIMULATOR_BUTTONS.map((btn) => (
            <button
              key={btn.type}
              onClick={() => handleSimulate(btn.type)}
              disabled={processing !== null}
              className={`w-full glass-card px-4 py-3.5 flex items-center gap-3 text-left transition-all ${btn.borderColor} ${btn.hoverBg} ${processing ? "opacity-60 cursor-not-allowed" : "hover:-translate-y-0.5 active:scale-[0.99]"}`}
            >
              <span className="text-xl">{btn.emoji}</span>
              <div className="flex-1">
                <div className="text-sm font-semibold text-slate-900">
                  {btn.label}
                </div>
                <div className="text-[11px] text-gray-500">{btn.desc}</div>
              </div>
              {processing === btn.type ? (
                <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
              ) : (
                <span className="text-xs text-gray-400">→</span>
              )}
            </button>
          ))}
        </div>

        {/* Processing indicator */}
        {processing && (
          <div className="glass-card p-4 mt-3 text-center fade-in">
            <div className="flex items-center justify-center gap-2 text-sm text-primary-500 font-semibold">
              <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
              🤖 AI Fraud Detection running... Isolation Forest scoring...
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
