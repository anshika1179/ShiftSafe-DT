"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAppState } from "@/frontend/components/providers/AppProvider";
import {
  triggerNotification,
  triggerToast,
} from "@/frontend/components/ui/Notifications";
import { getTriggerEmoji, getTriggerName } from "@/backend/utils/store";

const SIMULATOR_BUTTONS = [
  {
    type: "heavy_rain",
    emoji: "🌧️",
    label: "Trigger Heavy Rain",
    desc: "Simulates 67.5mm rainfall → fraud screening",
  },
  {
    type: "heatwave",
    emoji: "🌡️",
    label: "Trigger Extreme Heat",
    desc: "Simulates 43.2°C → fraud screening",
  },
  {
    type: "platform_outage",
    emoji: "📵",
    label: "Trigger Platform Outage",
    desc: "Simulates 95-min Zomato outage → fraud screening",
  },
  {
    type: "pollution",
    emoji: "😷",
    label: "Trigger Severe Pollution",
    desc: "Simulates AQI 480 → fraud screening",
  },
];

const TRIGGER_DETAILS: Record<string, string> = {
  heavy_rain: "67.5mm in 2 hours · Threshold exceeded",
  heatwave: "43.2°C for 4+ hours · Threshold exceeded",
  pollution: "AQI 480 · Hazardous level detected",
  platform_outage: "95-min Zomato outage · Service disruption",
};

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

function getStatusBadgeClass(
  status: "paid" | "pending" | "review" | "blocked",
): string {
  if (status === "paid") {
    return "bg-emerald-50 text-emerald-600 border border-emerald-200";
  }
  if (status === "review") {
    return "bg-orange-50 text-orange-600 border border-orange-200";
  }
  if (status === "blocked") {
    return "bg-red-50 text-red-600 border border-red-200";
  }
  return "bg-slate-100 text-slate-600 border border-slate-200";
}

export default function ClaimsPage() {
  const router = useRouter();
  const { worker, claims, addClaim, isLoggedIn, isBootstrapping } =
    useAppState();
  const [processing, setProcessing] = useState<string | null>(null);
  const [fraudRunning, setFraudRunning] = useState(false);

  useEffect(() => {
    if (!isBootstrapping && !isLoggedIn) router.replace("/");
  }, [isBootstrapping, isLoggedIn, router]);

  if (isBootstrapping) {
    return (
      <div className="space-y-4 max-w-120 mx-auto fade-in pb-8">
        <div className="h-7 w-32 bg-slate-200 rounded-lg animate-pulse" />
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass-card p-4 text-center space-y-2">
              <div className="h-6 w-12 mx-auto bg-slate-200 rounded animate-pulse" />
              <div className="h-3 w-16 mx-auto bg-slate-100 rounded animate-pulse" />
            </div>
          ))}
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="glass-card p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-200 animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-28 bg-slate-200 rounded animate-pulse" />
              <div className="h-3 w-20 bg-slate-100 rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const totalPaid = claims
    .filter((c) => c.status === "paid")
    .reduce((s, c) => s + c.amount, 0);

  const handleSimulate = async (triggerType: string) => {
    if (processing) return;
    if (!worker?.id) {
      triggerToast("Worker profile missing. Please login again.", "error");
      return;
    }

    setProcessing(triggerType);

    const emoji = getTriggerEmoji(triggerType);
    const name = getTriggerName(triggerType);
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

    // Step 1: Push notification
    triggerNotification({
      emoji,
      title: `${name} Detected — Fraud Screening Started`,
      subtitle: TRIGGER_DETAILS[triggerType] || "Threshold exceeded",
      value: "Risk + eligibility checks running",
      amount,
    });

    // Step 2: Show fraud detection running
    await new Promise((r) => setTimeout(r, 1000));
    setFraudRunning(true);

    // Step 3: Create claim after fraud check
    await new Promise((r) => setTimeout(r, 1500));
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
          `₹${settledAmount} approved via ${claimData.settlement?.channel || "UPI"} ✓`,
          "success",
        );
      } else if (status === "review") {
        triggerToast("Claim submitted to admin review queue.", "success");
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
    } finally {
      setFraudRunning(false);
      setProcessing(null);
    }
  };

  return (
    <div className="space-y-5 max-w-120 mx-auto fade-in pb-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Claims
          </h1>
          <p className="text-sm text-gray-500">
            Review-gated parametric claims
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200">
          <span className="live-dot" />
          <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">
            Admin Review Queue
          </span>
        </div>
      </div>

      {/* summary stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="glass-card p-4 text-center">
          <div className="text-xl font-bold text-slate-900">
            {claims.length}
          </div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mt-1">
            Total Claims
          </div>
        </div>
        <div className="glass-card p-4 text-center">
          <div className="text-xl font-bold text-emerald-500">
            ₹{totalPaid.toLocaleString()}
          </div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mt-1">
            Total Paid
          </div>
        </div>
        <div className="glass-card p-4 text-center">
          <div className="text-xl font-bold text-slate-900">&lt;30m</div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mt-1">
            Review SLA
          </div>
        </div>
      </div>

      {/* demo simulator */}
      <div
        className="glass-card p-5"
        style={{ borderColor: "rgba(239, 68, 68, 0.15)" }}
      >
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">
            🔴 Live Demo — Simulate Trigger
          </h2>
        </div>

        <div className="space-y-2">
          {SIMULATOR_BUTTONS.map((btn) => (
            <button
              key={btn.type}
              onClick={() => handleSimulate(btn.type)}
              disabled={processing !== null}
              className={`w-full glass-card px-4 py-3 flex items-center gap-3 text-left transition-all ${processing ? "opacity-60 cursor-not-allowed" : "hover:-translate-y-0.5 hover:border-primary-500/30 active:scale-[0.99]"}`}
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
                <span className="text-xs text-gray-400">▶</span>
              )}
            </button>
          ))}
        </div>

        {/* Fraud detection animation */}
        {fraudRunning && (
          <div className="mt-4 p-3 rounded-xl bg-slate-50 border border-slate-100 text-center fade-in">
            <div className="flex items-center justify-center gap-2 text-sm text-primary-500 font-semibold">
              <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
              🤖 AI Fraud Detection running... Isolation Forest scoring...
            </div>
          </div>
        )}
      </div>

      {/* claims history */}
      <div>
        <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3 px-1">
          Claims History
        </div>
        <div className="space-y-3">
          {claims.length === 0 ? (
            <div className="glass-card p-8 text-center">
              <div className="text-4xl mb-3">📋</div>
              <div className="text-sm font-semibold text-slate-700 mb-1">No claims yet</div>
              <div className="text-xs text-gray-500">Use the simulator above to trigger a claim and see the full fraud-screening pipeline in action.</div>
            </div>
          ) : (
            claims.map((c) => (
            <div key={c.id} className="glass-card p-4 relative overflow-hidden">
              {/* Top row */}
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg bg-orange-50 border border-slate-100 shrink-0">
                  {c.triggerEmoji}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-bold text-slate-900">
                      {c.triggerName}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider ${getStatusBadgeClass(c.status)}`}
                    >
                      {c.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-500">
                    {c.relativeTime}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-lg font-bold text-emerald-500">
                    ₹{c.amount}
                  </div>
                </div>
              </div>

              {/* Detail row (monospace) */}
              <div className="bg-slate-50 rounded-lg p-3 text-[11px] font-mono space-y-1.5 border border-slate-100">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Trigger</span>
                  <span className="text-slate-800">{c.triggerValue}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Fraud Score</span>
                  <span
                    style={{ color: c.fraudColor }}
                    className="font-semibold"
                  >
                    {c.fraudLabel}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Payout Ref</span>
                  <span className="text-slate-800">{c.payoutRef}</span>
                </div>
                <div className="pt-1 border-t border-slate-100">
                  {c.status === "paid" ? (
                    <span className="text-emerald-600 font-semibold">
                      ⚡ Admin-approved payout completed
                    </span>
                  ) : c.status === "review" ? (
                    <span className="text-orange-600 font-semibold">
                      🛡️ Manual fraud review in progress
                    </span>
                  ) : c.status === "blocked" ? (
                    <span className="text-red-600 font-semibold">
                      🚫 Blocked by fraud rules
                    </span>
                  ) : (
                    <span className="text-slate-600 font-semibold">
                      ⏳ Awaiting settlement confirmation
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
          )}
        </div>
      </div>
    </div>
  );
}
