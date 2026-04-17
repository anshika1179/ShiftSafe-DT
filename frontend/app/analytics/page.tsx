"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAppState } from "@/frontend/components/providers/AppProvider";

// Dynamic import for Chart.js (client-side only)
interface ChartInstance {
  destroy: () => void;
}

interface ChartConstructor {
  new (
    canvas: HTMLCanvasElement,
    config: Record<string, unknown>,
  ): ChartInstance;
}

declare global {
  interface Window {
    Chart?: ChartConstructor;
  }
}

function useChartJs() {
  const [loaded, setLoaded] = useState(
    () => typeof window !== "undefined" && Boolean(window.Chart),
  );

  useEffect(() => {
    if (loaded) return;

    let isDisposed = false;
    const script = document.createElement("script");
    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js";
    script.onload = () => {
      if (!isDisposed) setLoaded(true);
    };
    document.head.appendChild(script);

    return () => {
      isDisposed = true;
      script.onload = null;
    };
  }, [loaded]);

  return loaded;
}

type ViewTab = "worker" | "actuarial" | "stress" | "ai_lab";

const BREAKDOWN_ITEMS = [
  { key: "weather", label: "Weather Risk", color: "#4d9fff" },
  { key: "zone", label: "Zone / AQI Risk", color: "#ff6b35" },
  { key: "platform", label: "Platform Outage", color: "#34d399" },
  { key: "claims", label: "Claims History", color: "#ff3b5c" },
];

interface ActuarialData {
  snapshot: {
    bcr: number;
    lossRatio: number;
    totalPremiumCollected: number;
    totalClaimsPaid: number;
    activePolicies: number;
    totalWorkers: number;
    isHealthy: boolean;
    recommendation: string;
  };
  liveStressTests: {
    monsoon: StressResult;
    delhiHazard: StressResult;
  };
  weeklyMetrics: Array<{
    period_start: string;
    period_end: string;
    bcr: number;
    loss_ratio: number;
    total_premium_collected: number;
    total_claims_paid: number;
  }>;
}

interface StressResult {
  scenarioName: string;
  durationDays: number;
  triggerFrequency: number;
  totalEstimatedPayout: number;
  totalPremiumInPeriod: number;
  bcrUnderStress: number;
  lossRatioUnderStress: number;
  isSustainable: boolean;
  reserveRequired: number;
  recommendation: string;
  assumptions: string[];
}

interface PremiumSimulationResult {
  weeklyPremium: number;
  riskScore: number;
  riskLabel: string;
  premiumTierName: string;
  activityTier: string;
  cityPool: string;
  cityTier: {
    tier: number;
    label: string;
    emoji: string;
    premiumDiscount: number;
    maxPayoutMultiplier: number;
    description: string;
  };
  mlMetrics: {
    fraudProbability: number;
    anomalyDetected: boolean;
    weatherRiskVolatility: number;
  };
  predictionBand: {
    optimistic: number;
    baseline: number;
    stressed: number;
  };
  modelConfidence: {
    score: number;
    label: "low" | "medium" | "high";
    rationale: string[];
  };
  pricingBreakdown: {
    triggerProbability: number;
    seasonalMultiplier: number;
    rawPremium: number;
  };
}

interface MlHealthSnapshot {
  status: string;
  runtimeSelfTest?: {
    status?: string;
    passRate?: number;
    checks?: Array<{
      name: string;
      passed: boolean;
    }>;
  };
  telemetry?: {
    status?: string;
    error?: string | null;
  };
}

export default function AnalyticsPage() {
  const router = useRouter();
  const {
    worker,
    policy,
    claims,
    totalEarningsProtected,
    isLoggedIn,
    isBootstrapping,
  } = useAppState();
  const [tab, setTab] = useState<ViewTab>("worker");
  const chartLoaded = useChartJs();
  const [actuarialData, setActuarialData] = useState<ActuarialData | null>(
    null,
  );
  const [actuarialFetchFailed, setActuarialFetchFailed] = useState(false);
  const loadingActuarial =
    (tab === "actuarial" || tab === "stress") &&
    !actuarialData &&
    !actuarialFetchFailed;

  const [simInput, setSimInput] = useState({
    city: "Mumbai",
    zone: "Andheri East",
    platform: "Zomato",
    income: 4200,
    forecast: "clear",
    daysWorked: 6,
    activeDays: 21,
    claimsHistory: 1,
  });
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState("");
  const [simResult, setSimResult] = useState<PremiumSimulationResult | null>(
    null,
  );

  const [mlHealth, setMlHealth] = useState<MlHealthSnapshot | null>(null);
  const [mlLoading, setMlLoading] = useState(false);
  const [mlError, setMlError] = useState("");

  async function runPremiumSimulation() {
    setSimLoading(true);
    setSimError("");
    try {
      const params = new URLSearchParams({
        city: simInput.city,
        zone: simInput.zone,
        platform: simInput.platform,
        income: String(simInput.income),
        forecast: simInput.forecast,
        daysWorked: String(simInput.daysWorked),
        activeDays: String(simInput.activeDays),
        claimsHistory: String(simInput.claimsHistory),
      });
      const res = await fetch(`/api/premium?${params.toString()}`);
      const data = (await res.json()) as PremiumSimulationResult;
      if (!res.ok) {
        setSimError("Unable to run premium simulation.");
        return;
      }
      setSimResult(data);
    } catch {
      setSimError("Unable to run premium simulation.");
    } finally {
      setSimLoading(false);
    }
  }

  async function runMlProbe() {
    setMlLoading(true);
    setMlError("");
    try {
      const res = await fetch("/api/ml/health", { cache: "no-store" });
      const data = (await res.json()) as MlHealthSnapshot;
      if (!res.ok) {
        setMlError("Unable to fetch model diagnostics right now.");
      }
      setMlHealth(data);
    } catch {
      setMlError("Unable to fetch model diagnostics right now.");
    } finally {
      setMlLoading(false);
    }
  }

  useEffect(() => {
    if (!worker) return;
    setSimInput((prev) => ({
      ...prev,
      city: worker.city || prev.city,
      zone: worker.zone || prev.zone,
      platform: worker.platform || prev.platform,
      income: worker.avgWeeklyEarnings || prev.income,
      claimsHistory: Math.max(claims.length, prev.claimsHistory),
    }));
  }, [worker, claims.length]);

  useEffect(() => {
    if (tab !== "ai_lab") return;
    if (!simResult && !simLoading) {
      void runPremiumSimulation();
    }
    if (!mlHealth && !mlLoading) {
      void runMlProbe();
    }
    // Intentionally excludes function refs to avoid eager reruns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, simResult, simLoading, mlHealth, mlLoading]);

  useEffect(() => {
    if (!isBootstrapping && !isLoggedIn) router.replace("/");
  }, [isBootstrapping, isLoggedIn, router]);

  // Fetch actuarial data when switching to actuarial/stress tab
  useEffect(() => {
    if (
      (tab === "actuarial" || tab === "stress") &&
      !actuarialData &&
      !actuarialFetchFailed
    ) {
      fetch("/api/actuarial")
        .then((r) => r.json() as Promise<ActuarialData>)
        .then((data) => setActuarialData(data))
        .catch(() => setActuarialFetchFailed(true));
    }
  }, [tab, actuarialData, actuarialFetchFailed]);

  const barRef = useRef<HTMLCanvasElement>(null);
  const barChartRef = useRef<ChartInstance | null>(null);

  const totalPremiumPaid =
    policy?.totalPremiumPaid || (policy?.weeklyPremium || 35) * 2;
  const claimsCount = claims.length;

  // Bar chart for Worker View
  useEffect(() => {
    if (!chartLoaded || tab !== "worker" || !barRef.current) return;

    if (barChartRef.current) barChartRef.current.destroy();

    const Chart = window.Chart;
    if (!Chart) return;

    barChartRef.current = new Chart(barRef.current, {
      type: "bar",
      data: {
        labels: ["Week 1", "Week 2", "Week 3", "Week 4"],
        datasets: [
          {
            label: "Premium Paid (₹)",
            data: [35, 35, 35, 35],
            backgroundColor: "rgba(249, 115, 22, 0.7)",
            borderColor: "#f97316",
            borderWidth: 1,
            borderRadius: 6,
          },
          {
            label: "Claims Received (₹)",
            data: [0, 300, 0, 500],
            backgroundColor: "rgba(77, 159, 255, 0.7)",
            borderColor: "#4d9fff",
            borderWidth: 1,
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            labels: { color: "#64748b", font: { size: 11 } },
          },
        },
        scales: {
          x: {
            ticks: { color: "#94a3b8", font: { size: 10 } },
            grid: { color: "rgba(0,0,0,0.05)" },
          },
          y: {
            ticks: { color: "#94a3b8", font: { size: 10 } },
            grid: { color: "rgba(0,0,0,0.05)" },
          },
        },
      },
    });
  }, [chartLoaded, tab]);

  const flaggedClaims = claims.filter((c) => c.fraudScore > 40);

  if (isBootstrapping) {
    return null;
  }

  return (
    <div className="space-y-5 max-w-120 mx-auto fade-in pb-8">
      <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
        Analytics
      </h1>

      {/* tab toggle */}
      <div className="flex p-1 rounded-xl bg-slate-100 border border-slate-200">
        {[
          { id: "worker" as ViewTab, emoji: "👤", label: "Worker" },
          { id: "actuarial" as ViewTab, emoji: "📊", label: "Actuarial" },
          { id: "stress" as ViewTab, emoji: "⚡", label: "Stress Test" },
          { id: "ai_lab" as ViewTab, emoji: "🧠", label: "AI/ML Lab" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2.5 rounded-lg text-xs font-semibold transition-all ${
              tab === t.id
                ? "bg-white text-slate-900 shadow-sm"
                : "text-gray-500"
            }`}
          >
            {t.emoji} {t.label}
          </button>
        ))}
      </div>

      {/* ═══════════ WORKER VIEW ═══════════ */}
      {tab === "worker" && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="glass-card p-4">
              <div className="text-xl font-bold text-emerald-500">
                ₹{totalEarningsProtected.toLocaleString()}
              </div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mt-1">
                Total Protected
              </div>
            </div>
            <div className="glass-card p-4">
              <div className="text-xl font-bold text-slate-900">
                {claimsCount}
              </div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mt-1">
                Claims Paid
              </div>
            </div>
            <div className="glass-card p-4">
              <div className="text-xl font-bold text-primary-500">
                ₹{totalPremiumPaid}
              </div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mt-1">
                Premium Paid
              </div>
            </div>
            <div className="glass-card p-4">
              <div className="text-xl font-bold text-amber-500">
                {policy?.riskScore || 22}/100
              </div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mt-1">
                Risk Score
              </div>
            </div>
          </div>

          {/* Weekly Premium Breakdown */}
          <div className="glass-card p-5">
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-4">
              Premium Breakdown
            </div>
            <div className="space-y-3">
              {BREAKDOWN_ITEMS.map((item) => {
                const value =
                  policy?.contributions?.[
                    item.key as keyof typeof policy.contributions
                  ] ?? 25;
                return (
                  <div
                    key={item.key}
                    className="flex items-center justify-between py-1"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded"
                        style={{ background: item.color }}
                      />
                      <span className="text-xs text-slate-700">
                        {item.label}
                      </span>
                    </div>
                    <span className="text-xs font-bold text-slate-900">
                      {value}%
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 text-center">
              <span className="text-[10px] text-emerald-600 font-mono font-semibold tracking-wider">
                Parametric Pricing Model v3.0
              </span>
            </div>
          </div>

          {/* Weekly Coverage Chart */}
          <div className="glass-card p-5">
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-4">
              Weekly Coverage Overview
            </div>
            <canvas ref={barRef} height="200" />
          </div>
        </>
      )}

      {/* ═══════════ ACTUARIAL VIEW ═══════════ */}
      {tab === "actuarial" && (
        <>
          {loadingActuarial ? (
            <div className="glass-card p-8 text-center">
              <div className="w-8 h-8 mx-auto border-3 border-primary-500 border-t-transparent rounded-full animate-spin mb-3" />
              <div className="text-sm text-gray-500">
                Loading actuarial metrics...
              </div>
            </div>
          ) : (
            <>
              {/* BCR Card */}
              <div className="glass-card p-5">
                <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">
                  Burning Cost Rate (BCR)
                </div>
                <div className="flex items-center gap-4 mb-3">
                  <div
                    className="text-4xl font-extrabold"
                    style={{
                      color:
                        (actuarialData?.snapshot?.bcr ?? 0.65) <= 0.7
                          ? "#34d399"
                          : (actuarialData?.snapshot?.bcr ?? 0.65) <= 0.85
                            ? "#f59e0b"
                            : "#ef4444",
                    }}
                  >
                    {(actuarialData?.snapshot?.bcr ?? 0.65).toFixed(2)}
                  </div>
                  <div className="flex-1">
                    <div className="text-xs text-gray-500 mb-1">
                      Target: 0.55 — 0.70
                    </div>
                    <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden relative">
                      {/* Target zone indicator */}
                      <div
                        className="absolute h-full bg-emerald-100 rounded-full"
                        style={{ left: "55%", width: "15%" }}
                      />
                      <div
                        className="h-full rounded-full transition-all duration-1000 relative z-10"
                        style={{
                          width: `${Math.min((actuarialData?.snapshot?.bcr ?? 0.65) * 100, 100)}%`,
                          background:
                            (actuarialData?.snapshot?.bcr ?? 0.65) <= 0.7
                              ? "#34d399"
                              : (actuarialData?.snapshot?.bcr ?? 0.65) <= 0.85
                                ? "#f59e0b"
                                : "#ef4444",
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-[9px] text-gray-400 mt-0.5">
                      <span>0</span>
                      <span>0.55</span>
                      <span>0.70</span>
                      <span>0.85</span>
                      <span>1.0</span>
                    </div>
                  </div>
                </div>
                <div className="text-xs text-gray-600 bg-slate-50 rounded-lg p-3">
                  {actuarialData?.snapshot?.recommendation ||
                    "✅ BCR within target range"}
                </div>
              </div>

              {/* Key Metrics Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="glass-card p-4">
                  <div className="text-xl font-bold text-emerald-500">
                    ₹
                    {(
                      actuarialData?.snapshot?.totalPremiumCollected ?? 0
                    ).toLocaleString()}
                  </div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mt-1">
                    Premium Collected
                  </div>
                </div>
                <div className="glass-card p-4">
                  <div className="text-xl font-bold text-red-400">
                    ₹
                    {(
                      actuarialData?.snapshot?.totalClaimsPaid ?? 0
                    ).toLocaleString()}
                  </div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mt-1">
                    Claims Paid
                  </div>
                </div>
                <div className="glass-card p-4">
                  <div className="text-xl font-bold text-slate-900">
                    {actuarialData?.snapshot?.activePolicies ?? 0}
                  </div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mt-1">
                    Active Policies
                  </div>
                </div>
                <div className="glass-card p-4">
                  <div className="text-xl font-bold text-amber-500">
                    {(actuarialData?.snapshot?.lossRatio ?? 0).toFixed(1)}%
                  </div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mt-1">
                    Loss Ratio
                  </div>
                </div>
              </div>

              {/* Formula Explanation */}
              <div className="glass-card p-5">
                <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">
                  How BCR Works
                </div>
                <div className="bg-slate-50 rounded-xl p-4 mb-3">
                  <div className="text-xs font-mono text-slate-700">
                    <span className="text-primary-500 font-bold">BCR</span> =
                    Total Claims Paid ÷ Total Premium Collected
                  </div>
                </div>
                <div className="space-y-2 text-[11px] text-gray-600">
                  <div className="flex items-start gap-2">
                    <span className="text-emerald-500 mt-0.5">●</span>
                    <span>
                      Target BCR: 0.55–0.70 → 65 paise per ₹1 goes to payouts
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-amber-500 mt-0.5">●</span>
                    <span>BCR &gt; 0.85 → Warning: unsustainable pricing</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-red-500 mt-0.5">●</span>
                    <span>Loss Ratio &gt; 85% → Suspend new enrollments</span>
                  </div>
                </div>
              </div>

              {/* Weekly BCR Trend */}
              {actuarialData?.weeklyMetrics &&
                actuarialData.weeklyMetrics.length > 0 && (
                  <div className="glass-card p-5">
                    <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">
                      Weekly BCR Trend
                    </div>
                    <div className="space-y-2">
                      {actuarialData.weeklyMetrics.map((m, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <div className="text-[10px] text-gray-500 w-20 shrink-0">
                            {new Date(m.period_start).toLocaleDateString(
                              "en-IN",
                              { day: "numeric", month: "short" },
                            )}
                          </div>
                          <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.min(m.bcr * 100, 100)}%`,
                                background:
                                  m.bcr <= 0.7
                                    ? "#34d399"
                                    : m.bcr <= 0.85
                                      ? "#f59e0b"
                                      : "#ef4444",
                              }}
                            />
                          </div>
                          <div
                            className="text-xs font-bold w-10 text-right"
                            style={{
                              color:
                                m.bcr <= 0.7
                                  ? "#34d399"
                                  : m.bcr <= 0.85
                                    ? "#f59e0b"
                                    : "#ef4444",
                            }}
                          >
                            {m.bcr.toFixed(2)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              {/* Fraud Detection Queue */}
              <div className="glass-card p-5">
                <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">
                  Fraud Detection Queue
                </div>
                {flaggedClaims.length === 0 ? (
                  <div className="text-sm text-emerald-600 font-medium py-2">
                    ✅ No claims under review — AI cleared all recent claims
                  </div>
                ) : (
                  <div className="space-y-2">
                    {flaggedClaims.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center gap-3 p-3 rounded-lg border border-red-100 bg-red-50"
                      >
                        <span className="text-lg">{c.triggerEmoji}</span>
                        <div className="flex-1">
                          <div className="text-sm font-semibold text-slate-900">
                            {worker?.name || "Worker"} — {c.triggerName}
                          </div>
                          <div className="text-xs text-gray-500">
                            Fraud Score: {c.fraudScore}/100
                          </div>
                        </div>
                        <span className="px-2 py-0.5 rounded-md text-[9px] font-bold uppercase bg-red-100 text-red-600 border border-red-200">
                          REVIEW
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* ═══════════ STRESS TEST VIEW ═══════════ */}
      {tab === "stress" && (
        <>
          {loadingActuarial ? (
            <div className="glass-card p-8 text-center">
              <div className="w-8 h-8 mx-auto border-3 border-primary-500 border-t-transparent rounded-full animate-spin mb-3" />
              <div className="text-sm text-gray-500">
                Loading stress scenarios...
              </div>
            </div>
          ) : (
            <>
              <div className="text-xs text-gray-500 px-1">
                Stress scenarios test how the model behaves under extreme
                conditions. At least 1 scenario is required.
              </div>

              {/* Monsoon Stress Scenario */}
              {actuarialData?.liveStressTests?.monsoon && (
                <StressScenarioCard
                  scenario={actuarialData.liveStressTests.monsoon}
                  emoji="🌧️"
                />
              )}

              {/* Delhi Hazard Scenario */}
              {actuarialData?.liveStressTests?.delhiHazard && (
                <StressScenarioCard
                  scenario={actuarialData.liveStressTests.delhiHazard}
                  emoji="🌡️"
                />
              )}

              {/* Settlement Flow */}
              <div className="glass-card p-5">
                <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">
                  Settlement Flow
                </div>
                <div className="space-y-3">
                  {[
                    {
                      step: 1,
                      name: "Trigger Confirmed",
                      desc: "Oracle / weather API confirms event threshold",
                      icon: "🔍",
                    },
                    {
                      step: 2,
                      name: "Eligibility Check",
                      desc: "Active policy, correct zone, no duplicate claim",
                      icon: "✅",
                    },
                    {
                      step: 3,
                      name: "Payout Calculated",
                      desc: "Fixed amount × trigger days, 50% cap applied",
                      icon: "🧮",
                    },
                    {
                      step: 4,
                      name: "Transfer Initiated",
                      desc: "UPI / IMPS / direct bank — under few minutes",
                      icon: "💸",
                    },
                    {
                      step: 5,
                      name: "Record Updated",
                      desc: "PolicyCenter logs payout, BillingCenter reconciles",
                      icon: "📋",
                    },
                  ].map((s) => (
                    <div key={s.step} className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-primary-500/10 border border-primary-500/20 flex items-center justify-center text-sm shrink-0">
                        {s.icon}
                      </div>
                      <div className="flex-1 pt-0.5">
                        <div className="text-sm font-semibold text-slate-900">
                          {s.step}. {s.name}
                        </div>
                        <div className="text-[11px] text-gray-500">
                          {s.desc}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <div className="text-[11px] text-emerald-700 font-medium">
                    <strong>Parametric:</strong> Trigger fires → system pays →
                    done within minutes
                  </div>
                  <div className="text-[10px] text-emerald-600 mt-0.5">
                    vs Traditional: Worker files claim → waits 15–30 days →
                    maybe paid
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ═══════════ AI/ML LAB VIEW ═══════════ */}
      {tab === "ai_lab" && (
        <>
          <div
            className="glass-card p-5"
            style={{
              borderColor: "rgba(59,130,246,0.25)",
              background:
                "linear-gradient(135deg, rgba(59,130,246,0.06) 0%, rgba(139,92,246,0.05) 55%, rgba(16,185,129,0.04) 100%)",
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                  Phase 2 Intelligence Upgrade
                </div>
                <div className="text-lg font-bold text-slate-900 mt-1">
                  AI/ML Scenario Lab
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Simulate premiums with explainable ML signals and validate
                  live model health for judge review.
                </div>
              </div>
              <button
                onClick={() => {
                  void runMlProbe();
                  void runPremiumSimulation();
                }}
                disabled={simLoading || mlLoading}
                className="px-3 py-2 rounded-lg text-[11px] font-bold border border-blue-200 bg-blue-50 text-blue-700 disabled:opacity-60 hover:bg-blue-100"
              >
                {simLoading || mlLoading ? "Refreshing..." : "Refresh Signals"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="glass-card p-4">
              <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3">
                Premium Simulator Inputs
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
                      City
                    </label>
                    <select
                      className="select-field text-xs mt-1"
                      value={simInput.city}
                      onChange={(e) =>
                        setSimInput((prev) => ({
                          ...prev,
                          city: e.target.value,
                        }))
                      }
                    >
                      {[
                        "Mumbai",
                        "Delhi",
                        "Bengaluru",
                        "Hyderabad",
                        "Pune",
                        "Chennai",
                        "Jaipur",
                        "Lucknow",
                        "Ahmedabad",
                      ].map((city) => (
                        <option key={city} value={city}>
                          {city}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
                      Forecast
                    </label>
                    <select
                      className="select-field text-xs mt-1"
                      value={simInput.forecast}
                      onChange={(e) =>
                        setSimInput((prev) => ({
                          ...prev,
                          forecast: e.target.value,
                        }))
                      }
                    >
                      <option value="clear">Clear</option>
                      <option value="heavy_rain">Heavy Rain</option>
                      <option value="storm">Storm</option>
                      <option value="pollution">Pollution Spike</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
                    Weekly Income (₹{simInput.income})
                  </label>
                  <input
                    type="range"
                    min={2500}
                    max={20000}
                    step={100}
                    value={simInput.income}
                    onChange={(e) =>
                      setSimInput((prev) => ({
                        ...prev,
                        income: Number(e.target.value),
                      }))
                    }
                    className="w-full mt-1"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
                      Days/Wk
                    </label>
                    <input
                      type="number"
                      className="input-field text-xs mt-1"
                      min={1}
                      max={7}
                      value={simInput.daysWorked}
                      onChange={(e) =>
                        setSimInput((prev) => ({
                          ...prev,
                          daysWorked: Math.max(
                            1,
                            Math.min(7, Number(e.target.value) || 1),
                          ),
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
                      Active Days
                    </label>
                    <input
                      type="number"
                      className="input-field text-xs mt-1"
                      min={1}
                      max={365}
                      value={simInput.activeDays}
                      onChange={(e) =>
                        setSimInput((prev) => ({
                          ...prev,
                          activeDays: Math.max(
                            1,
                            Math.min(365, Number(e.target.value) || 1),
                          ),
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
                      Past Claims
                    </label>
                    <input
                      type="number"
                      className="input-field text-xs mt-1"
                      min={0}
                      max={30}
                      value={simInput.claimsHistory}
                      onChange={(e) =>
                        setSimInput((prev) => ({
                          ...prev,
                          claimsHistory: Math.max(
                            0,
                            Math.min(30, Number(e.target.value) || 0),
                          ),
                        }))
                      }
                    />
                  </div>
                </div>

                <button
                  onClick={() => void runPremiumSimulation()}
                  disabled={simLoading}
                  className="w-full py-2.5 rounded-xl text-xs font-bold bg-slate-900 text-white disabled:opacity-60 hover:bg-slate-800"
                >
                  {simLoading
                    ? "Running Simulation..."
                    : "Run Premium Simulation"}
                </button>
                {simError && (
                  <div className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">
                    {simError}
                  </div>
                )}
              </div>
            </div>

            <div className="glass-card p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                  Live Model Health
                </div>
                <button
                  onClick={() => void runMlProbe()}
                  disabled={mlLoading}
                  className="px-2.5 py-1 rounded-md text-[10px] font-bold border border-indigo-200 bg-indigo-50 text-indigo-700 disabled:opacity-60"
                >
                  {mlLoading ? "Checking..." : "Run Check"}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">
                    Runtime
                  </div>
                  <div
                    className={`text-sm font-black mt-1 ${mlHealth?.runtimeSelfTest?.status === "operational" ? "text-emerald-600" : "text-red-600"}`}
                  >
                    {(
                      mlHealth?.runtimeSelfTest?.status || "unknown"
                    ).toUpperCase()}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">
                    Pass Rate
                  </div>
                  <div className="text-sm font-black mt-1 text-slate-900">
                    {mlHealth?.runtimeSelfTest?.passRate ?? 0}%
                  </div>
                </div>
              </div>

              <div className="text-[10px] text-slate-500 mb-2">
                Telemetry:{" "}
                <span
                  className={
                    mlHealth?.telemetry?.status === "operational"
                      ? "text-emerald-600 font-semibold"
                      : "text-orange-600 font-semibold"
                  }
                >
                  {(mlHealth?.telemetry?.status || "unknown").toUpperCase()}
                </span>
              </div>

              <div className="space-y-1.5 max-h-32 overflow-auto pr-1">
                {(mlHealth?.runtimeSelfTest?.checks || [])
                  .slice(0, 5)
                  .map((check) => (
                    <div
                      key={check.name}
                      className={`text-[10px] rounded-md border px-2 py-1 ${check.passed ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}
                    >
                      {check.passed ? "PASS" : "FAIL"} · {check.name}
                    </div>
                  ))}
              </div>
              {mlError && (
                <div className="mt-2 text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">
                  {mlError}
                </div>
              )}
            </div>
          </div>

          {simResult && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="glass-card p-4">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                    Weekly Premium
                  </div>
                  <div className="text-2xl font-black text-blue-600 mt-1">
                    ₹{simResult.weeklyPremium}
                  </div>
                </div>
                <div className="glass-card p-4">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                    Risk Score
                  </div>
                  <div className="text-2xl font-black text-slate-900 mt-1">
                    {simResult.riskScore}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {simResult.riskLabel}
                  </div>
                </div>
                <div className="glass-card p-4">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                    Model Confidence
                  </div>
                  <div
                    className={`text-2xl font-black mt-1 ${simResult.modelConfidence.label === "high" ? "text-emerald-600" : simResult.modelConfidence.label === "medium" ? "text-amber-600" : "text-red-600"}`}
                  >
                    {simResult.modelConfidence.score}
                  </div>
                  <div className="text-[10px] text-slate-500 uppercase">
                    {simResult.modelConfidence.label}
                  </div>
                </div>
                <div className="glass-card p-4">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                    Tier
                  </div>
                  <div className="text-xl font-black text-purple-600 mt-1">
                    {simResult.cityTier.emoji} T{simResult.cityTier.tier}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {simResult.cityTier.label}
                  </div>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="glass-card p-4">
                  <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3">
                    Predicted Payout Band
                  </div>
                  <div className="space-y-2">
                    {[
                      {
                        key: "optimistic",
                        label: "Optimistic",
                        color: "text-emerald-600",
                      },
                      {
                        key: "baseline",
                        label: "Baseline",
                        color: "text-blue-600",
                      },
                      {
                        key: "stressed",
                        label: "Stressed",
                        color: "text-red-600",
                      },
                    ].map((item) => (
                      <div
                        key={item.key}
                        className="flex justify-between text-xs"
                      >
                        <span className="text-slate-500">{item.label}</span>
                        <span className={`font-bold ${item.color}`}>
                          ₹
                          {simResult.predictionBand[
                            item.key as keyof typeof simResult.predictionBand
                          ].toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="glass-card p-4">
                  <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3">
                    ML Risk Signals
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Fraud Probability</span>
                      <span className="font-bold text-slate-800">
                        {Math.round(simResult.mlMetrics.fraudProbability * 100)}
                        %
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Weather Volatility</span>
                      <span className="font-bold text-slate-800">
                        {(
                          simResult.mlMetrics.weatherRiskVolatility * 100
                        ).toFixed(1)}
                        %
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Anomaly Flag</span>
                      <span
                        className={`font-bold ${simResult.mlMetrics.anomalyDetected ? "text-red-600" : "text-emerald-600"}`}
                      >
                        {simResult.mlMetrics.anomalyDetected
                          ? "Detected"
                          : "Normal"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">
                        Trigger Probability
                      </span>
                      <span className="font-bold text-slate-800">
                        {(
                          simResult.pricingBreakdown.triggerProbability * 100
                        ).toFixed(1)}
                        %
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="glass-card p-4">
                <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-2">
                  Why The Model Suggested This
                </div>
                <div className="space-y-1.5">
                  {simResult.modelConfidence.rationale.map((line, idx) => (
                    <div
                      key={idx}
                      className="text-xs text-slate-600 flex items-start gap-1.5"
                    >
                      <span className="text-blue-500 mt-0.5">•</span>
                      <span>{line}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// stress scenario card component
function StressScenarioCard({
  scenario,
  emoji,
}: {
  scenario: StressResult;
  emoji: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`glass-card p-5 ${!scenario.isSustainable ? "border-red-200" : "border-emerald-200"}`}
      style={{
        background: !scenario.isSustainable
          ? "rgba(239, 68, 68, 0.03)"
          : "rgba(16, 185, 129, 0.03)",
      }}
    >
      <div className="flex items-center gap-3 mb-3">
        <span className="text-2xl">{emoji}</span>
        <div className="flex-1">
          <div className="text-sm font-bold text-slate-900">
            {scenario.scenarioName}
          </div>
          <div className="text-[11px] text-gray-500">
            {scenario.durationDays} days ·{" "}
            {(scenario.triggerFrequency * 100).toFixed(0)}% trigger rate
          </div>
        </div>
        <span
          className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
            scenario.isSustainable
              ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
              : "bg-red-50 text-red-600 border border-red-200"
          }`}
        >
          {scenario.isSustainable ? "OK" : "RISK"}
        </span>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="bg-white rounded-lg p-3 border border-slate-100">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
            Est. Payout
          </div>
          <div className="text-lg font-bold text-red-400">
            ₹{scenario.totalEstimatedPayout.toLocaleString()}
          </div>
        </div>
        <div className="bg-white rounded-lg p-3 border border-slate-100">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
            Premium In Period
          </div>
          <div className="text-lg font-bold text-emerald-500">
            ₹{scenario.totalPremiumInPeriod.toLocaleString()}
          </div>
        </div>
        <div className="bg-white rounded-lg p-3 border border-slate-100">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
            BCR (Stress)
          </div>
          <div
            className="text-lg font-bold"
            style={{
              color: scenario.bcrUnderStress <= 1 ? "#f59e0b" : "#ef4444",
            }}
          >
            {scenario.bcrUnderStress.toFixed(2)}
          </div>
        </div>
        <div className="bg-white rounded-lg p-3 border border-slate-100">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
            Reserve Needed
          </div>
          <div className="text-lg font-bold text-amber-500">
            ₹{scenario.reserveRequired.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Recommendation */}
      <div
        className={`text-xs p-3 rounded-lg ${!scenario.isSustainable ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}
      >
        {scenario.recommendation}
      </div>

      {/* Expand assumptions */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-[11px] text-primary-500 font-semibold mt-3 hover:underline"
      >
        {expanded ? "▼ Hide Assumptions" : "▶ Show Assumptions"}
      </button>
      {expanded && (
        <div className="mt-2 p-3 bg-slate-50 rounded-lg space-y-1">
          {scenario.assumptions.map((a, i) => (
            <div
              key={i}
              className="text-[11px] text-gray-600 flex items-start gap-1.5"
            >
              <span className="text-gray-400 mt-0.5">•</span>
              <span>{a}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
