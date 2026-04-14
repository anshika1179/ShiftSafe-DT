"use client";
import { useState, useEffect, useRef } from "react";

// types for the actuarial API response
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
  liveStressTests: { monsoon: StressResult; delhiHazard: StressResult };
  weeklyMetrics: Array<{
    period_start: string;
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

// smooth counter animation — ease-out cubic for that satisfying feel
function useAnimatedValue(target: number, duration = 1200) {
  const [value, setValue] = useState(0);
  const ref = useRef<number>(0);
  useEffect(() => {
    const start = ref.current;
    const startTime = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = start + (target - start) * eased;
      setValue(current);
      ref.current = current;
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [target, duration]);
  return value;
}

// the SVG arc gauge for BCR display
function BCRGauge({ bcr }: { bcr: number }) {
  const animatedBcr = useAnimatedValue(bcr);
  const normalizedBcr = Math.min(animatedBcr, 1.5);
  const percentage = (normalizedBcr / 1.5) * 100;
  const circumference = 2 * Math.PI * 80;
  const offset = circumference - (percentage / 100) * circumference * 0.75;
  const color =
    animatedBcr <= 0.55
      ? "#10b981"
      : animatedBcr <= 0.7
        ? "#34d399"
        : animatedBcr <= 0.85
          ? "#f59e0b"
          : "#ef4444";

  return (
    <div className="relative w-52 h-52 mx-auto">
      <svg viewBox="0 0 200 200" className="transform -rotate-135">
        <circle
          cx="100"
          cy="100"
          r="80"
          fill="none"
          stroke="rgba(100,116,139,0.15)"
          strokeWidth="14"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * 0.25}
          strokeLinecap="round"
        />
        <circle
          cx="100"
          cy="100"
          r="80"
          fill="none"
          stroke={color}
          strokeWidth="14"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{
            transition:
              "stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1), stroke 0.5s",
          }}
        />
        {/* Target zone markers */}
        <circle
          cx="100"
          cy="100"
          r="80"
          fill="none"
          stroke="rgba(52,211,153,0.3)"
          strokeWidth="14"
          strokeDasharray={`${circumference * 0.075} ${circumference * 0.925}`}
          strokeDashoffset={circumference - (0.55 / 1.5) * circumference * 0.75}
          strokeLinecap="butt"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center pt-4">
        <div className="text-4xl font-black" style={{ color }}>
          {animatedBcr.toFixed(2)}
        </div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mt-1">
          Burning Cost Rate
        </div>
      </div>
    </div>
  );
}

// animated step-through of the 5-stage settlement pipeline
function SettlementFlow() {
  const [activeStep, setActiveStep] = useState(0);
  const steps = [
    {
      icon: "🔍",
      title: "Trigger Confirmed",
      detail: "Weather API: Rainfall > 50mm in Andheri East",
      time: "0.0s",
    },
    {
      icon: "✅",
      title: "Eligibility Check",
      detail: "Policy active • Zone match • No duplicate • 7+ active days",
      time: "0.2s",
    },
    {
      icon: "🧮",
      title: "Payout Calculated",
      detail: "₹350 × 50% cap = ₹350 (within weekly limit)",
      time: "0.4s",
    },
    {
      icon: "💸",
      title: "UPI Transfer",
      detail: "ravi.kumar@upi • Ref: UPI-TXN-8721634 • Instant",
      time: "0.8s",
    },
    {
      icon: "📋",
      title: "Record Updated",
      detail: "PolicyCenter logged • SMS sent • BCR recalculated",
      time: "1.2s",
    },
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % (steps.length + 2));
    }, 1500);
    return () => clearInterval(interval);
  }, [steps.length]);

  return (
    <div className="space-y-1">
      {steps.map((s, i) => {
        const isActive = i === activeStep;
        const isDone = i < activeStep;
        return (
          <div
            key={i}
            className={`flex items-start gap-3 p-3 rounded-xl transition-all duration-500 ${isActive ? "bg-primary-500/10 border border-primary-500/30 scale-[1.02]" : isDone ? "opacity-70" : "opacity-40"}`}
          >
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 transition-all duration-500 ${isDone ? "bg-emerald-500/20 border border-emerald-500/30" : isActive ? "bg-primary-500/20 border border-primary-500/30 animate-pulse" : "bg-slate-100 border border-slate-200"}`}
            >
              {isDone ? "✓" : s.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <div className="text-sm font-bold text-slate-900">
                  {s.title}
                </div>
                <span className="text-[10px] font-mono text-gray-400">
                  {s.time}
                </span>
              </div>
              <div
                className={`text-[11px] text-gray-500 transition-all duration-300 ${isActive ? "opacity-100" : "opacity-60"}`}
              >
                {s.detail}
              </div>
            </div>
          </div>
        );
      })}
      <div className="text-center pt-2">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-bold text-emerald-600 uppercase tracking-wider">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Total Settlement: {"<"} 1.2 seconds
        </span>
      </div>
    </div>
  );
}

// collapsible card for each stress scenario
function StressCard({
  scenario,
  emoji,
  isRunning,
  onRun,
}: {
  scenario: StressResult;
  emoji: string;
  isRunning: boolean;
  onRun: () => void;
}) {
  const [showAssumptions, setShowAssumptions] = useState(false);
  const animPayout = useAnimatedValue(
    isRunning ? scenario.totalEstimatedPayout : 0,
  );
  const animPremium = useAnimatedValue(
    isRunning ? scenario.totalPremiumInPeriod : 0,
  );
  const animBcr = useAnimatedValue(isRunning ? scenario.bcrUnderStress : 0);
  const animReserve = useAnimatedValue(
    isRunning ? scenario.reserveRequired : 0,
  );

  return (
    <div
      className={`glass-card p-5 transition-all duration-500 ${isRunning ? (scenario.isSustainable ? "border-emerald-300 shadow-emerald-100/50 shadow-lg" : "border-red-300 shadow-red-100/50 shadow-lg") : ""}`}
    >
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl"
          style={{ background: "rgba(249,115,22,0.1)" }}
        >
          {emoji}
        </div>
        <div className="flex-1">
          <div className="text-sm font-bold text-slate-900">
            {scenario.scenarioName}
          </div>
          <div className="text-[11px] text-gray-500">
            {scenario.durationDays} days ·{" "}
            {(scenario.triggerFrequency * 100).toFixed(0)}% daily trigger rate
          </div>
        </div>
        <button
          onClick={onRun}
          disabled={isRunning}
          className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${isRunning ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "bg-linear-to-r from-orange-500 to-red-500 text-white shadow-md hover:shadow-lg hover:-translate-y-0.5 active:scale-95"}`}
        >
          {isRunning ? "● Running..." : "▶ Simulate"}
        </button>
      </div>

      {isRunning && (
        <div className="fade-in">
          <div className="grid grid-cols-4 gap-2 mb-4">
            {[
              {
                label: "Total Payout",
                value: `₹${Math.round(animPayout).toLocaleString()}`,
                color: "#ef4444",
              },
              {
                label: "Premium In",
                value: `₹${Math.round(animPremium).toLocaleString()}`,
                color: "#10b981",
              },
              {
                label: "Stress BCR",
                value: animBcr.toFixed(1),
                color: animBcr > 1.5 ? "#ef4444" : "#f59e0b",
              },
              {
                label: "Reserve",
                value: `₹${Math.round(animReserve).toLocaleString()}`,
                color: "#f59e0b",
              },
            ].map((m) => (
              <div
                key={m.label}
                className="bg-white rounded-xl p-3 border border-slate-100 text-center"
              >
                <div className="text-lg font-black" style={{ color: m.color }}>
                  {m.value}
                </div>
                <div className="text-[8px] text-gray-400 uppercase tracking-wider font-bold mt-0.5">
                  {m.label}
                </div>
              </div>
            ))}
          </div>

          <div
            className={`p-3 rounded-xl text-xs font-medium ${scenario.isSustainable ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`}
          >
            {scenario.isSustainable ? "✅" : "🚨"} {scenario.recommendation}
          </div>

          <button
            onClick={() => setShowAssumptions(!showAssumptions)}
            className="text-[11px] text-primary-500 font-semibold mt-3 hover:underline"
          >
            {showAssumptions
              ? "▼ Hide Assumptions"
              : "▶ View All Assumptions (Transparency)"}
          </button>
          {showAssumptions && (
            <div className="mt-2 p-3 bg-slate-50 rounded-xl space-y-1 fade-in">
              {scenario.assumptions.map((a, i) => (
                <div
                  key={i}
                  className="text-[11px] text-gray-600 flex items-start gap-1.5"
                >
                  <span className="text-primary-500 text-xs mt-0.5">→</span>
                  <span>{a}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ActuarialPage() {
  const [data, setData] = useState<ActuarialData | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningScenario, setRunningScenario] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "stress" | "settlement">(
    "overview",
  );

  useEffect(() => {
    fetch("/api/actuarial")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="max-w-150 mx-auto min-h-[60vh] flex flex-col items-center justify-center">
        <div className="w-16 h-16 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mb-4" />
        <div className="text-sm text-gray-500">
          Initializing Actuarial Command Center...
        </div>
      </div>
    );
  }

  const bcr = data?.snapshot?.bcr ?? 0.65;
  const lossRatio = data?.snapshot?.lossRatio ?? 65;

  return (
    <div className="space-y-6 max-w-150 mx-auto fade-in pb-10 px-1">
      {/* header */}
      <div className="text-center pt-2">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-900 text-white text-[10px] font-bold uppercase tracking-[0.2em] mb-3">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />{" "}
          Live Actuarial Engine
        </div>
        <h1 className="text-3xl font-black text-slate-900 tracking-tight">
          Command Center
        </h1>
        <p className="text-xs text-gray-500 mt-1">
          Real-time underwriting intelligence · BCR monitoring · Stress
          simulation
        </p>
      </div>

      {/* tabs */}
      <div className="flex p-1 rounded-2xl bg-slate-100 border border-slate-200">
        {[
          { id: "overview" as const, emoji: "📊", label: "BCR Overview" },
          { id: "stress" as const, emoji: "⚡", label: "Stress Tests" },
          { id: "settlement" as const, emoji: "💸", label: "Settlement" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-3 rounded-xl text-xs font-bold transition-all ${tab === t.id ? "bg-white text-slate-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
          >
            {t.emoji} {t.label}
          </button>
        ))}
      </div>

      {/* bcr overview */}
      {tab === "overview" && (
        <>
          {/* BCR Gauge */}
          <div className="glass-card p-6">
            <BCRGauge bcr={bcr} />
            <div className="flex justify-center gap-6 mt-4 text-[10px]">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />{" "}
                &lt;0.55 Strong
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />{" "}
                0.55-0.70 Target
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-500" /> 0.70-0.85
                Warning
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500" /> &gt;0.85
                Critical
              </span>
            </div>
          </div>

          {/* Key Metrics */}
          <div className="grid grid-cols-3 gap-3">
            {[
              {
                label: "Loss Ratio",
                value: `${lossRatio.toFixed(0)}%`,
                color:
                  lossRatio <= 70
                    ? "#10b981"
                    : lossRatio <= 85
                      ? "#f59e0b"
                      : "#ef4444",
              },
              {
                label: "Active Policies",
                value: `${data?.snapshot?.activePolicies ?? 0}`,
                color: "#4d9fff",
              },
              {
                label: "Workers",
                value: `${data?.snapshot?.totalWorkers ?? 0}`,
                color: "#8b5cf6",
              },
            ].map((m) => (
              <div key={m.label} className="glass-card p-4 text-center">
                <div className="text-2xl font-black" style={{ color: m.color }}>
                  {m.value}
                </div>
                <div className="text-[9px] text-gray-400 uppercase tracking-wider font-bold mt-1">
                  {m.label}
                </div>
              </div>
            ))}
          </div>

          {/* Financial Breakdown */}
          <div className="grid grid-cols-2 gap-3">
            <div className="glass-card p-4">
              <div className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">
                Premium Collected
              </div>
              <div className="text-2xl font-black text-emerald-500">
                ₹{(data?.snapshot?.totalPremiumCollected ?? 0).toLocaleString()}
              </div>
            </div>
            <div className="glass-card p-4">
              <div className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">
                Claims Paid
              </div>
              <div className="text-2xl font-black text-red-400">
                ₹{(data?.snapshot?.totalClaimsPaid ?? 0).toLocaleString()}
              </div>
            </div>
          </div>

          {/* BCR Health Status */}
          <div
            className={`glass-card p-4 ${data?.snapshot?.isHealthy ? "border-emerald-200" : "border-red-200"}`}
            style={{
              background: data?.snapshot?.isHealthy
                ? "rgba(16,185,129,0.03)"
                : "rgba(239,68,68,0.03)",
            }}
          >
            <div className="text-sm text-gray-700">
              {data?.snapshot?.recommendation}
            </div>
          </div>

          {/* Weekly BCR Trend */}
          {data?.weeklyMetrics && data.weeklyMetrics.length > 0 && (
            <div className="glass-card p-5">
              <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-4">
                Weekly BCR Trend
              </div>
              <div className="space-y-2.5">
                {data.weeklyMetrics.map((m, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="text-[10px] text-gray-500 w-16 shrink-0 font-mono">
                      {new Date(m.period_start).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                      })}
                    </div>
                    <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden relative">
                      {/* Target zone (0.55-0.70) */}
                      <div
                        className="absolute h-full bg-emerald-100/60 rounded-full"
                        style={{
                          left: `${(0.55 / 1.2) * 100}%`,
                          width: `${(0.15 / 1.2) * 100}%`,
                        }}
                      />
                      <div
                        className="h-full rounded-full transition-all duration-700 relative z-10"
                        style={{
                          width: `${Math.min((m.bcr / 1.2) * 100, 100)}%`,
                          background:
                            m.bcr <= 0.7
                              ? "linear-gradient(90deg, #34d399, #10b981)"
                              : m.bcr <= 0.85
                                ? "linear-gradient(90deg, #fbbf24, #f59e0b)"
                                : "linear-gradient(90deg, #f87171, #ef4444)",
                        }}
                      />
                    </div>
                    <div
                      className="text-xs font-bold w-10 text-right font-mono"
                      style={{
                        color:
                          m.bcr <= 0.7
                            ? "#10b981"
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

          {/* Pricing Formula */}
          <div className="glass-card p-5">
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">
              Pricing Engine v3.0
            </div>
            <div className="bg-slate-900 rounded-xl p-4 font-mono text-xs leading-relaxed">
              <div className="text-emerald-400">
                {"// Weekly premium calculation"}
              </div>
              <div className="text-slate-300 mt-1">
                <span className="text-amber-400">base</span> ={" "}
                <span className="text-cyan-400">P(trigger)</span> ×{" "}
                <span className="text-cyan-400">avg_income_lost/day</span> ×{" "}
                <span className="text-cyan-400">days_exposed</span>
              </div>
              <div className="text-slate-300 mt-1">
                <span className="text-amber-400">premium</span> ={" "}
                <span className="text-amber-400">base</span> ×{" "}
                <span className="text-cyan-400">seasonal_multiplier</span> →{" "}
                <span className="text-emerald-400">fixed_tier</span>
              </div>
              <div className="text-gray-500 mt-2">
                {"// Tiers: ₹20 (Basic) | ₹35 (Standard) | ₹50 (Premium)"}
              </div>
              <div className="text-gray-500">
                {"// Max payout: 50% of weekly income (hard cap)"}
              </div>
            </div>
          </div>
        </>
      )}

      {/* stress tests */}
      {tab === "stress" && (
        <>
          <div className="text-xs text-gray-500 px-1">
            Run simulations to test model sustainability under extreme
            conditions. Every scenario discloses all assumptions.
          </div>

          {data?.liveStressTests?.monsoon && (
            <StressCard
              scenario={data.liveStressTests.monsoon}
              emoji="🌧️"
              isRunning={
                runningScenario === "monsoon" || runningScenario === "both"
              }
              onRun={() => setRunningScenario("monsoon")}
            />
          )}

          {data?.liveStressTests?.delhiHazard && (
            <StressCard
              scenario={data.liveStressTests.delhiHazard}
              emoji="🌡️"
              isRunning={
                runningScenario === "delhi" || runningScenario === "both"
              }
              onRun={() => setRunningScenario("delhi")}
            />
          )}

          <button
            onClick={() => setRunningScenario("both")}
            className="w-full py-4 rounded-2xl bg-linear-to-r from-slate-900 to-slate-800 text-white text-sm font-bold uppercase tracking-wider shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all active:scale-[0.98]"
          >
            ⚡ Run All Scenarios Simultaneously
          </button>

          {/* BCR Formula */}
          <div className="glass-card p-4">
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">
              Sustainability Formula
            </div>
            <div className="text-xs font-mono text-slate-700 leading-relaxed">
              <div>
                <span className="text-primary-500 font-bold">BCR</span> = Σ
                Claims ÷ Σ Premium
              </div>
              <div className="mt-1">
                <span className="text-primary-500 font-bold">Reserve</span> =
                max(0, EstimatedPayout − PremiumInPeriod)
              </div>
              <div className="mt-1">
                <span className="text-primary-500 font-bold">Sustainable</span>{" "}
                = BCR ≤ 1.5 (with reserve buffer)
              </div>
            </div>
          </div>
        </>
      )}

      {/* settlement */}
      {tab === "settlement" && (
        <>
          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">
                Live Settlement Flow
              </div>
            </div>
            <SettlementFlow />
          </div>

          {/* Channels */}
          <div className="glass-card p-5">
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">
              Payout Channels
            </div>
            <div className="space-y-3">
              {[
                {
                  icon: "📱",
                  name: "UPI Transfer",
                  status: "Primary",
                  time: "< 2 min",
                  desc: "Instant — worker already uses it daily",
                },
                {
                  icon: "🏦",
                  name: "IMPS to Bank",
                  status: "Fallback",
                  time: "< 5 min",
                  desc: "Bank transfer if UPI not linked",
                },
                {
                  icon: "💳",
                  name: "Razorpay Sandbox",
                  status: "Demo",
                  time: "< 1 min",
                  desc: "Hackathon simulation mode",
                },
              ].map((ch) => (
                <div
                  key={ch.name}
                  className="flex items-center gap-3 p-3 bg-white rounded-xl border border-slate-100"
                >
                  <span className="text-xl">{ch.icon}</span>
                  <div className="flex-1">
                    <div className="text-sm font-bold text-slate-900">
                      {ch.name}{" "}
                      <span className="text-[9px] font-mono text-gray-400">
                        {ch.time}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-500">{ch.desc}</div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase ${ch.status === "Primary" ? "bg-emerald-50 text-emerald-600 border border-emerald-200" : "bg-slate-50 text-slate-400 border border-slate-200"}`}
                  >
                    {ch.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Rollback Logic */}
          <div className="glass-card p-5">
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">
              Rollback Logic
            </div>
            <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-[11px] text-gray-600">
              <div className="flex items-start gap-2">
                <span className="text-red-500 mt-0.5 font-bold">1.</span>
                <span>
                  If UPI transfer fails (timeout / invalid ID) → auto-retry once
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-amber-500 mt-0.5 font-bold">2.</span>
                <span>If retry fails → fallback to IMPS bank transfer</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5 font-bold">3.</span>
                <span>
                  If no fallback channel → flag for manual review (SLA: 4 hours)
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-emerald-500 mt-0.5 font-bold">4.</span>
                <span>
                  All failed attempts logged with reason code for audit trail
                </span>
              </div>
            </div>
          </div>

          {/* Comparison */}
          <div className="glass-card p-5">
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">
              ShiftSafe vs Traditional
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-200">
                <div className="text-xs font-bold text-emerald-700 mb-2">
                  🛡️ ShiftSafe (Parametric)
                </div>
                <div className="space-y-1 text-[10px] text-emerald-600">
                  <div>• Trigger fires → auto-pay</div>
                  <div>• Settlement: {"<"} 2 minutes</div>
                  <div>• Zero paperwork</div>
                  <div>• Fraud check BEFORE payment</div>
                </div>
              </div>
              <div className="bg-red-50 rounded-xl p-3 border border-red-200">
                <div className="text-xs font-bold text-red-700 mb-2">
                  📄 Traditional Insurance
                </div>
                <div className="space-y-1 text-[10px] text-red-600">
                  <div>• Worker files manual claim</div>
                  <div>• Settlement: 15–30 days</div>
                  <div>• Documentation required</div>
                  <div>• Adjuster reviews after</div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
