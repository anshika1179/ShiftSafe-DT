"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAppState } from "@/frontend/components/providers/AppProvider";
import { triggerToast } from "@/frontend/components/ui/Notifications";

const COVERAGE_TRIGGERS = [
  {
    emoji: "🌧️",
    name: "Heavy Rain",
    pct: "70%",
    desc: "70% of daily earnings",
  },
  {
    emoji: "🌡️",
    name: "Extreme Heat",
    pct: "50%",
    desc: "50% of daily earnings",
  },
  {
    emoji: "😷",
    name: "Severe Pollution",
    pct: "60%",
    desc: "60% of daily earnings",
  },
  {
    emoji: "📱",
    name: "Platform Outage",
    pct: "80%",
    desc: "80% of daily earnings",
  },
  {
    emoji: "🚧",
    name: "Zone Closure",
    pct: "100%",
    desc: "100% of daily earnings",
  },
];

const BREAKDOWN_BARS = [
  { key: "weather", label: "Weather Risk Contribution", color: "#4d9fff" },
  { key: "zone", label: "Zone / AQI Risk", color: "#ff6b35" },
  { key: "platform", label: "Platform Outage Frequency", color: "#34d399" },
  { key: "claims", label: "Claims History Factor", color: "#ff3b5c" },
];

const PAYOUT_CHANNELS = [
  {
    name: "UPI Transfer",
    icon: "📱",
    desc: "Instant, preferred — worker already uses it",
    status: "Primary",
  },
  {
    name: "IMPS to Bank",
    icon: "🏦",
    desc: "Fallback if UPI not linked",
    status: "Fallback",
  },
  {
    name: "Razorpay Sandbox",
    icon: "💳",
    desc: "For demo / hackathon simulation",
    status: "Demo",
  },
];

let paymentSequence = 2;

function createLocalPaymentId(): string {
  const id = `TXN-${String(paymentSequence).padStart(3, "0")}`;
  paymentSequence += 1;
  return id;
}

export default function PoliciesPage() {
  const router = useRouter();
  const { worker, policy, claims, isLoggedIn, isBootstrapping } = useAppState();
  const [insuranceActive, setInsuranceActive] = useState(
    policy?.status !== "cancelled" && policy?.status !== "expired",
  );
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [policyActionLoading, setPolicyActionLoading] = useState(false);
  const [paymentHistory, setPaymentHistory] = useState([
    {
      id: "TXN-001",
      date: "16 Mar 2026",
      amount: 35,
      status: "Paid",
      receipt: "receipt-001.pdf",
    },
  ]);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const receiptInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isBootstrapping && !isLoggedIn) router.replace("/");
  }, [isBootstrapping, isLoggedIn, router]);

  useEffect(() => {
    setInsuranceActive(
      policy?.status !== "cancelled" && policy?.status !== "expired",
    );
  }, [policy?.status]);

  if (isBootstrapping) {
    return null;
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

  const totalPaid = claims.reduce((s, c) => s + c.amount, 0);
  const weeklyPremium = policy?.weeklyPremium || 35;
  const maxPayoutCap = Math.round((worker?.avgWeeklyEarnings || 4200) * 0.5);

  const startDateFormatted = policy?.startDate
    ? new Date(policy.startDate).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "16 Mar 2026";
  const nextPaymentFormatted = policy?.nextPaymentDue
    ? new Date(policy.nextPaymentDue).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "2 Apr 2026";

  const handleOptOut = async () => {
    if (!policy?.id || !worker?.id || policyActionLoading) return;

    setPolicyActionLoading(true);
    try {
      const res = await fetch("/api/policies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policyId: policy.id,
          workerId: worker.id,
          action: "cancel",
        }),
      });

      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(String(data?.error || "Unable to cancel coverage"));
      }

      setInsuranceActive(false);
      setShowCancelConfirm(false);
      triggerToast("Coverage cancelled successfully", "success");
    } catch (error) {
      triggerToast(
        error instanceof Error
          ? error.message
          : "Unable to cancel coverage right now.",
        "error",
      );
    } finally {
      setPolicyActionLoading(false);
    }
  };

  const handleReactivate = async () => {
    if (!policy?.id || !worker?.id || policyActionLoading) return;

    setPolicyActionLoading(true);
    try {
      const res = await fetch("/api/policies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policyId: policy.id,
          workerId: worker.id,
          action: "reactivate",
        }),
      });

      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(String(data?.error || "Unable to reactivate coverage"));
      }

      setInsuranceActive(true);
      triggerToast("Coverage reactivated", "success");
    } catch (error) {
      triggerToast(
        error instanceof Error
          ? error.message
          : "Unable to reactivate coverage right now.",
        "error",
      );
    } finally {
      setPolicyActionLoading(false);
    }
  };

  const handleRenewPolicy = async () => {
    if (!policy?.id || !worker?.id || policyActionLoading) return;

    setPolicyActionLoading(true);
    try {
      const res = await fetch("/api/policies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policyId: policy.id,
          workerId: worker.id,
          action: "reactivate",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(String(data?.error || "Unable to renew policy"));
      }
      setInsuranceActive(true);
      triggerToast("Policy renewed successfully!", "success");
    } catch (error) {
      triggerToast(
        error instanceof Error
          ? error.message
          : "Unable to renew policy right now.",
        "error",
      );
    } finally {
      setPolicyActionLoading(false);
    }
  };

  const handleUploadReceipt = () => {
    if (uploadingReceipt) return;
    receiptInputRef.current?.click();
  };

  const onReceiptFileSelected = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingReceipt(true);
    setTimeout(() => {
      setPaymentHistory((prev) => [
        {
          id: createLocalPaymentId(),
          date: new Date().toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
          amount: weeklyPremium,
          status: "Paid",
          receipt: file.name,
        },
        ...prev,
      ]);
      setUploadingReceipt(false);
      triggerToast("Receipt uploaded and payment verified!", "success");
    }, 1500);
  };

  return (
    <div className="space-y-5 max-w-120 mx-auto fade-in pb-8">
      <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
        Policy Details
      </h1>

      {/* insurance opt-out toggle */}
      <div
        className={`glass-card p-4 flex items-center justify-between ${!insuranceActive ? "border-red-200" : ""}`}
        style={
          !insuranceActive ? { background: "rgba(239, 68, 68, 0.03)" } : {}
        }
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">{insuranceActive ? "🛡️" : "⚠️"}</span>
          <div>
            <div className="text-sm font-semibold text-slate-900">
              Insurance Coverage
            </div>
            <div className="text-[11px] text-gray-500">
              {insuranceActive
                ? "Your coverage is active — you are protected"
                : "Coverage cancelled — you are not covered"}
            </div>
          </div>
        </div>
        <button
          onClick={() =>
            insuranceActive ? setShowCancelConfirm(true) : handleReactivate()
          }
          className={`relative w-12 h-6 rounded-full transition-all ${insuranceActive ? "bg-emerald-500" : "bg-gray-300"}`}
        >
          <div
            className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-all ${insuranceActive ? "left-6" : "left-0.5"}`}
          />
        </button>
      </div>

      {/* cancel confirmation modal */}
      {showCancelConfirm && (
        <div
          className="glass-card p-5 border-red-200"
          style={{ background: "rgba(239, 68, 68, 0.04)" }}
        >
          <div className="text-sm font-bold text-red-600 mb-2">
            ⚠️ Cancel Insurance Coverage?
          </div>
          <p className="text-xs text-gray-600 mb-4">
            You will lose all coverage including weather, heatwave, and platform
            outage protection. You can re-enroll at any time, but a new 7-day
            activity period will be required.
          </p>
          <div className="flex gap-3">
            <button
              onClick={handleOptOut}
              disabled={policyActionLoading}
              className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 text-white text-sm font-bold hover:bg-red-600 transition-all"
            >
              {policyActionLoading ? "Processing..." : "Yes, Cancel Coverage"}
            </button>
            <button
              onClick={() => setShowCancelConfirm(false)}
              disabled={policyActionLoading}
              className="flex-1 px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200 transition-all"
            >
              Keep Active
            </button>
          </div>
        </div>
      )}

      {/* reactivation banner */}
      {!insuranceActive && (
        <div
          className="glass-card p-4 border-amber-200"
          style={{ background: "rgba(245, 158, 11, 0.05)" }}
        >
          <div className="flex items-center gap-3">
            <span className="text-xl">🔔</span>
            <div className="flex-1">
              <div className="text-sm font-semibold text-slate-900">
                Want to get protected again?
              </div>
              <div className="text-[11px] text-gray-500">
                Reactivate your coverage instantly
              </div>
            </div>
            <button
              onClick={handleReactivate}
              disabled={policyActionLoading}
              className="btn btn-primary px-4 py-2 text-xs font-bold rounded-lg"
            >
              {policyActionLoading ? "Processing..." : "Reactivate"}
            </button>
          </div>
        </div>
      )}

      {/* policy header */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold mb-1">
              Policy ID
            </div>
            <div className="text-sm font-bold text-slate-900 font-mono">
              {policy?.id || "POL-001"}
            </div>
          </div>
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${insuranceActive ? "badge-success" : "bg-red-50 text-red-600 border border-red-200"}`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${insuranceActive ? "bg-emerald-500" : "bg-red-500"}`}
            />
            {insuranceActive ? "Active" : "Cancelled"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4 text-xs text-gray-500">
          <div>
            <span className="uppercase tracking-wider text-[10px] font-semibold">
              Start Date
            </span>
            <div className="text-sm text-slate-800 font-medium mt-0.5">
              {startDateFormatted}
            </div>
          </div>
          <div>
            <span className="uppercase tracking-wider text-[10px] font-semibold">
              Next Payment
            </span>
            <div className="text-sm text-slate-800 font-medium mt-0.5">
              {insuranceActive ? nextPaymentFormatted : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* premium tier & 50% cap info */}
      <div className="grid grid-cols-2 gap-4">
        <div className="glass-card p-5 text-center">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold mb-2">
            Weekly Premium
          </div>
          <div className="text-3xl font-extrabold text-primary-500">
            ₹{weeklyPremium}
          </div>
          <div className="text-[10px] text-gray-400 mt-1">Fixed tier</div>
        </div>
        <div className="glass-card p-5 text-center">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold mb-2">
            Max Payout (50%)
          </div>
          <div className="text-3xl font-extrabold text-slate-900">
            ₹{maxPayoutCap.toLocaleString()}
          </div>
          <div className="text-[10px] text-gray-400 mt-1">
            50% of weekly income
          </div>
        </div>
      </div>

      {/* ── Razorpay Pay Premium Button ── */}
      {insuranceActive && (
        <div className="glass-card p-4" style={{ background: "linear-gradient(135deg, rgba(59,130,246,0.04), rgba(147,51,234,0.04))" }}>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-xl shrink-0"
              style={{ background: "linear-gradient(135deg, #3b82f6, #8b5cf6)" }}>
              💳
            </div>
            <div className="flex-1">
              <div className="text-sm font-bold text-slate-900">Pay Weekly Premium</div>
              <div className="text-[11px] text-gray-500">
                Razorpay Test Mode · UPI / Card / Net Banking
              </div>
            </div>
            <button
              onClick={async () => {
                setPolicyActionLoading(true);
                try {
                  const res = await fetch("/api/razorpay/order", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      amount: weeklyPremium,
                      workerId: worker?.id,
                      policyId: policy?.id,
                      type: "weekly_premium",
                    }),
                  });
                  const data = await res.json();
                  if (data.success) {
                    // Simulate successful payment in sandbox mode
                    setPaymentHistory((prev) => [
                      {
                        id: createLocalPaymentId(),
                        date: new Date().toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        }),
                        amount: weeklyPremium,
                        status: "Paid",
                        receipt: `razorpay-${data.order?.id || "demo"}.pdf`,
                      },
                      ...prev,
                    ]);
                    triggerToast(
                      `₹${weeklyPremium} premium paid via ${data.mode === "live" ? "Razorpay" : "Sandbox"}! Order: ${data.order?.id}`,
                      "success"
                    );
                  } else {
                    triggerToast("Payment order creation failed", "error");
                  }
                } catch {
                  triggerToast("Unable to process payment right now", "error");
                } finally {
                  setPolicyActionLoading(false);
                }
              }}
              disabled={policyActionLoading}
              className="px-5 py-2.5 rounded-xl text-sm font-bold text-white shadow-lg transition-all hover:shadow-xl hover:-translate-y-0.5 active:scale-95 disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, #3b82f6, #8b5cf6)" }}
            >
              {policyActionLoading ? "Processing..." : `Pay ₹${weeklyPremium}`}
            </button>
          </div>
          <div className="mt-2.5 flex items-center gap-3 text-[9px] text-gray-400">
            <span className="flex items-center gap-1">🔒 PCI-DSS Compliant</span>
            <span>•</span>
            <span>Test Card: 4111 1111 1111 1111</span>
            <span>•</span>
            <span>Test UPI: success@razorpay</span>
          </div>
        </div>
      )}

      {/* pricing formula */}
      <div className="glass-card p-5">
        <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1">
          Pricing Formula
        </div>
        <div className="text-[10px] text-gray-400 font-mono mb-3">
          Weekly Premium Calculation
        </div>
        <div className="bg-slate-50 rounded-xl p-4 mb-3">
          <div className="text-xs font-mono text-slate-700 leading-relaxed">
            <span className="text-primary-500 font-bold">Base</span> =
            trigger_probability × avg_income_lost/day × days_exposed
          </div>
          <div className="text-xs font-mono text-slate-700 mt-1.5">
            <span className="text-primary-500 font-bold">Final</span> = Base ×
            seasonal_multiplier → mapped to fixed tier
          </div>
        </div>
        <div className="text-[10px] text-gray-500 leading-relaxed">
          Premium is fixed per tier (₹20 / ₹35 / ₹50 per week). Adjusted for
          city risk pool, peril type, and worker activity tier. Weekly cycle
          matches gig payout rhythm.
        </div>
      </div>

      {/* ai risk score */}
      <div className="glass-card p-5">
        <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">
          Risk Score
        </div>
        <div className="flex items-center gap-3 mb-2">
          <div className="text-2xl font-extrabold text-slate-900">
            {riskScore}
            <span className="text-sm text-gray-400">/100</span>
          </div>
          <div className="flex-1">
            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{ width: `${riskScore}%`, background: riskColor }}
              />
            </div>
          </div>
        </div>
        <div className="text-xs font-mono" style={{ color: riskColor }}>
          {riskLabel} Risk · Parametric Pricing Model v3.0
        </div>
      </div>

      {/* ai premium breakdown */}
      <div className="glass-card p-5">
        <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1">
          Premium Breakdown
        </div>
        <div className="text-[10px] text-gray-400 font-mono mb-4">
          Risk Factor Contributions
        </div>

        <div className="space-y-4">
          {BREAKDOWN_BARS.map((b) => {
            const value =
              policy?.contributions?.[
                b.key as keyof typeof policy.contributions
              ] ?? 25;
            return (
              <div key={b.key}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-slate-700">
                    {b.label}
                  </span>
                  <span className="text-xs font-bold text-slate-900">
                    {value}%
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-1000"
                    style={{ width: `${value}%`, background: b.color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* coverage triggers */}
      <div>
        <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3 px-1">
          Coverage Triggers
        </div>
        <div className="space-y-2">
          {COVERAGE_TRIGGERS.map((t) => (
            <div
              key={t.name}
              className="glass-card px-4 py-3 flex items-center gap-3"
            >
              <span className="text-lg">{t.emoji}</span>
              <div className="flex-1">
                <div className="text-sm font-semibold text-slate-900">
                  {t.name}
                </div>
                <div className="text-[11px] text-gray-500">{t.desc}</div>
              </div>
              <span
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${insuranceActive ? "badge-success" : "bg-gray-100 text-gray-400"}`}
              >
                {insuranceActive ? "ON" : "OFF"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* settlement / payout channels */}
      <div>
        <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3 px-1">
          Payout Channels
        </div>
        <div className="space-y-2">
          {PAYOUT_CHANNELS.map((ch) => (
            <div
              key={ch.name}
              className="glass-card px-4 py-3 flex items-center gap-3"
            >
              <span className="text-lg">{ch.icon}</span>
              <div className="flex-1">
                <div className="text-sm font-semibold text-slate-900">
                  {ch.name}
                </div>
                <div className="text-[11px] text-gray-500">{ch.desc}</div>
              </div>
              <span
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${ch.status === "Primary" ? "badge-success" : "bg-slate-100 text-slate-500 border border-slate-200"}`}
              >
                {ch.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* payment history and receipt upload */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">
            Payment History & Receipts
          </div>
          <input
            ref={receiptInputRef}
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={onReceiptFileSelected}
          />
          <button
            onClick={handleUploadReceipt}
            disabled={uploadingReceipt}
            className="btn btn-primary text-[10px] px-3 py-1 rounded-md"
          >
            {uploadingReceipt ? "Uploading..." : "Upload Receipt"}
          </button>
        </div>
        <div className="space-y-3">
          {paymentHistory.map((txn) => (
            <div
              key={txn.id}
              className="flex flex-col gap-2 p-3 bg-slate-50 border border-slate-100 rounded-lg"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-800">
                    {txn.id}
                  </div>
                  <div className="text-[10px] text-gray-500">{txn.date}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-bold text-emerald-600">
                    ₹{txn.amount}
                  </div>
                  <span className="px-2 py-0.5 mt-1 inline-block rounded-md text-[9px] font-bold uppercase bg-emerald-50 text-emerald-600 border border-emerald-200">
                    {txn.status}
                  </span>
                </div>
              </div>
              <div className="border-t border-slate-200 pt-2 flex justify-end">
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    triggerToast(
                      `Receipt ${txn.receipt} download started`,
                      "success",
                    );
                  }}
                  className="text-[10px] text-primary-500 font-semibold hover:underline flex items-center gap-1"
                >
                  📥 Download Receipt
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* policy details */}
      <div className="glass-card p-5">
        <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-4">
          Policy Summary
        </div>
        <div className="space-y-3">
          {[
            { label: "Platform", value: worker?.platform || "Zomato" },
            { label: "Zone", value: worker?.zone || "Andheri East" },
            { label: "Premium Tier", value: `₹${weeklyPremium}/week (Fixed)` },
            { label: "Max Payout Cap", value: `50% (₹${maxPayoutCap})` },
            { label: "Start Date", value: startDateFormatted },
            {
              label: "Next Payment",
              value: insuranceActive ? nextPaymentFormatted : "N/A",
            },
            { label: "Total Claimed", value: `₹${totalPaid.toLocaleString()}` },
            { label: "UPI ID", value: worker?.upiId || "ravi.kumar@upi" },
          ].map((item) => (
            <div
              key={item.label}
              className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0"
            >
              <span className="text-xs text-gray-500">{item.label}</span>
              <span className="text-xs font-semibold text-slate-800">
                {item.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* renew / cancel buttons */}
      <div className="flex gap-3">
        {insuranceActive ? (
          <>
            <button
              onClick={handleRenewPolicy}
              disabled={policyActionLoading}
              className="btn btn-primary flex-1 py-3.5 text-sm font-bold tracking-wider uppercase"
            >
              {policyActionLoading ? "Processing..." : "🔄 Renew Policy"}
            </button>
            <button
              onClick={() => setShowCancelConfirm(true)}
              disabled={policyActionLoading}
              className="btn btn-ghost flex-1 py-3.5 text-sm font-bold tracking-wider uppercase text-red-500 hover:bg-red-50"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={handleReactivate}
            className="btn btn-primary w-full py-3.5 text-sm font-bold tracking-wider uppercase"
          >
            🛡️ Reactivate Coverage
          </button>
        )}
      </div>
    </div>
  );
}
