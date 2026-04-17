"use client";
import { useCallback, useEffect, useState } from "react";
import { downloadClaimsCSV } from "@/lib/receipt-generator";

/* ─── Type Definitions ─── */
type AdminTab =
  | "overview"
  | "claims"
  | "workers"
  | "service_requests"
  | "bonuses";
type ClaimFilter = "review" | "paid" | "blocked" | "all";
type ClaimAction = "approve" | "reject";
type SRFilter = "all" | "open" | "in_progress" | "resolved";

interface AdminMetrics {
  stats?: {
    totalWorkers?: number;
    activePolicies?: number;
    weeklyPremiumsCollected?: number;
    totalPayouts?: number;
    totalClaims?: number;
    reviewClaims?: number;
    blockedClaims?: number;
    claimApprovalRate?: string;
    optedOutWorkers?: number;
    ineligibleWorkers?: number;
  };
  actuarial?: {
    lossRatio?: number;
    bcr?: number;
    currentReserveRatio?: number;
  };
  predictiveAnalytics?: {
    projectedClaimsNextWeek?: number;
    projectedPayoutNextWeek?: number;
    topRiskTrigger?: string | null;
    confidence?: string;
    seasonalMultiplier?: number;
  };
  automationHealth?: {
    status?: string;
    monitorRunsLast24h?: number;
    failedMonitorRunsLast24h?: number;
    latestMonitorRun?: { status: string; started_at: string } | null;
  };
  cityPools?: { city_pool: string; count: number; total_premium: number }[];
  premiumTiers?: {
    premium_tier: string;
    count: number;
    total_premium: number;
  }[];
  mlHealth?: {
    fraudEngine?: string;
    modelVersion?: string;
    runtimeValidation?: {
      status?: string;
      passRate?: number;
      passedChecks?: number;
      totalChecks?: number;
      failedChecks?: string[];
      generatedAt?: string;
    };
    cleanSample?: {
      score?: number;
      decision?: string;
    };
    suspiciousSample?: {
      score?: number;
      decision?: string;
    };
    serviceRequestAI?: {
      status?: string;
      sample?: {
        urgencyScore?: number;
        suggestedPriority?: string;
        sentimentLabel?: string;
        categoryConfidence?: number;
      };
    };
  };
}

interface AdminClaim {
  id: string;
  workerId: string;
  workerName: string;
  workerPhone: string;
  platform: string;
  city: string;
  zone: string;
  triggerType: string;
  triggerDescription: string;
  amount: number;
  status: string;
  createdAt: string;
  processedAt: string | null;
  fraudScore: number;
  fraudLabel: string;
  reviewPriority: string;
  settlement: {
    channel: string | null;
    status: string | null;
    transactionRef: string | null;
  };
}

interface AdminWorker {
  id: string;
  name: string;
  phone: string;
  platform: string;
  city: string;
  zone: string;
  avg_weekly_income: number;
  activity_tier: string;
  insurance_opted_out: number;
  policy_status: string | null;
  weekly_premium: number | null;
  total_claims: number;
  approved_claims: number;
  total_payouts: number;
  total_bonuses: number;
  created_at: string;
}

interface ServiceRequest {
  id: string;
  worker_id: string;
  worker_name: string;
  worker_phone: string;
  platform: string;
  city: string;
  category: string;
  subject: string;
  description: string;
  priority: string;
  status: string;
  admin_notes: string | null;
  ai_model_version?: string | null;
  ai?: {
    urgencyScore: number;
    suggestedPriority: string;
    sentimentLabel: string;
    categoryConfidence: number;
    autoAction: string | null;
    reasoning: string;
    generatedAt: string;
  } | null;
  created_at: string;
}

interface RiskBonus {
  id: string;
  worker_id: string;
  worker_name: string;
  worker_phone: string;
  platform: string;
  city: string;
  zone: string;
  bonus_type: string;
  amount: number;
  reason: string;
  risk_zone: string | null;
  risk_trigger: string | null;
  status: string;
  created_at: string;
}

interface MlHealthProbe {
  status?: string;
  generatedAt?: string;
  telemetry?: {
    status?: string;
    error?: string | null;
  };
  runtimeSelfTest?: {
    status?: string;
    passRate?: number;
    passedChecks?: number;
    totalChecks?: number;
    failedChecks?: string[];
    generatedAt?: string;
    checks?: Array<{
      name: string;
      passed: boolean;
      expected: string;
      actual: string;
    }>;
  };
  usage?: {
    claims30d?: {
      total?: number;
      scored?: number;
      scoringCoverage?: number;
      averageFraudScore?: number;
      blockedRate?: number;
    };
    serviceRequests30d?: {
      total?: number;
      classified?: number;
      classificationCoverage?: number;
      averageUrgencyScore?: number;
      averageCategoryConfidence?: number;
      autoEscalatedPriority?: number;
    };
  };
}

/* ─── Helpers ─── */
function fmt(ts: string | null): string {
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ago(ts: string): string {
  const ms = Date.now() - new Date(ts).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function mask(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.length === 10 ? `+91-${d.slice(0, 2)}****${d.slice(6)}` : phone;
}

function statusColor(s: string): string {
  const n = s.toLowerCase();
  if (n === "review" || n === "open" || n === "pending")
    return "bg-orange-50 text-orange-700 border border-orange-200";
  if (n === "auto_approved")
    return "bg-cyan-50 text-cyan-700 border border-cyan-200";
  if (n === "paid" || n === "resolved" || n === "approved")
    return "bg-emerald-50 text-emerald-700 border border-emerald-200";
  if (n === "in_progress")
    return "bg-blue-50 text-blue-700 border border-blue-200";
  return "bg-red-50 text-red-700 border border-red-200";
}

function statusLabel(s: string): string {
  const n = s.toLowerCase();
  if (n === "auto_approved") return "⚡ Auto-Approved";
  if (n === "paid") return "✅ Paid";
  if (n === "review") return "👁️ Review";
  if (n === "blocked") return "🚫 Blocked";
  return s;
}

function fraudColor(score: number): string {
  if (score <= 24) return "text-emerald-600";
  if (score <= 44) return "text-blue-600";
  if (score <= 69) return "text-orange-600";
  return "text-red-600";
}

const BONUS_TYPES = [
  { value: "high_risk_zone", label: "High Risk Zone", emoji: "🔴" },
  { value: "extreme_weather", label: "Extreme Weather", emoji: "⛈️" },
  { value: "monsoon_warrior", label: "Monsoon Warrior", emoji: "🌊" },
  { value: "heatwave_hero", label: "Heatwave Hero", emoji: "🔥" },
  { value: "pollution_fighter", label: "Pollution Fighter", emoji: "😷" },
  { value: "loyalty_bonus", label: "Loyalty Bonus", emoji: "⭐" },
  { value: "zero_claim_bonus", label: "Zero Claim Bonus", emoji: "🏆" },
  { value: "safety_bonus", label: "Safety Bonus", emoji: "🛡️" },
];

const SR_CATEGORIES: Record<string, string> = {
  claim_dispute: "⚖️ Claim Dispute",
  payout_issue: "💸 Payout Issue",
  policy_correction: "📋 Policy Correction",
  account_update: "👤 Account Update",
  technical_issue: "🔧 Technical Issue",
  general_inquiry: "💬 General Inquiry",
};

/* ─── Main Component ─── */
export default function AdminDashboard() {
  const [mounted, setMounted] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [tab, setTab] = useState<AdminTab>("overview");
  const [claimFilter, setClaimFilter] = useState<ClaimFilter>("review");
  const [srFilter, setSrFilter] = useState<SRFilter>("all");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [claims, setClaims] = useState<AdminClaim[]>([]);
  const [claimSummary, setClaimSummary] = useState({
    review: 0,
    paid: 0,
    blocked: 0,
    total: 0,
  });
  const [workers, setWorkers] = useState<AdminWorker[]>([]);
  const [serviceRequests, setServiceRequests] = useState<ServiceRequest[]>([]);
  const [srSummary, setSrSummary] = useState({
    open: 0,
    in_progress: 0,
    resolved: 0,
    closed: 0,
    total: 0,
    aiClassified: 0,
  });
  const [bonuses, setBonuses] = useState<RiskBonus[]>([]);
  const [bonusSummary, setBonusSummary] = useState({
    totalPaid: 0,
    totalPending: 0,
    count: 0,
  });
  const [mlProbe, setMlProbe] = useState<MlHealthProbe | null>(null);
  const [isRunningMlSelfTest, setIsRunningMlSelfTest] = useState(false);

  // Bonus form
  const [bonusForm, setBonusForm] = useState({
    workerId: "",
    bonusType: "",
    amount: "",
    reason: "",
    riskZone: "",
  });
  const [showBonusForm, setShowBonusForm] = useState(false);

  // SR response form
  const [srResponseId, setSrResponseId] = useState<string | null>(null);
  const [srResponseNotes, setSrResponseNotes] = useState("");
  const [srResponseStatus, setSrResponseStatus] = useState("resolved");

  /* ── Auth ── */
  useEffect(() => {
    let alive = true;
    async function check() {
      setMounted(true);
      try {
        const res = await fetch("/api/admin/session", { cache: "no-store" });
        const data = await res.json();
        if (!alive) return;
        setIsAuthenticated(Boolean(data?.authenticated));
      } catch {
        if (!alive) return;
        setIsAuthenticated(false);
      } finally {
        if (alive) setAuthChecked(true);
      }
    }
    check();
    return () => {
      alive = false;
    };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Unable to sign in.");
        return;
      }
      setIsAuthenticated(true);
      setPassword("");
    } catch {
      setError("Unable to sign in right now.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/admin/login", { method: "DELETE" });
    } catch {
      /* ignore */
    }
    setIsAuthenticated(false);
    setEmail("");
    setPassword("");
  };

  /* ── Data Loading ── */
  const loadDashboard = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/dashboard", { cache: "no-store" });
      if (res.ok) setMetrics(await res.json());
    } catch {
      /* ignore */
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const loadClaims = useCallback(async (filter: ClaimFilter) => {
    setIsRefreshing(true);
    try {
      const res = await fetch(`/api/admin/claims?status=${filter}`, {
        cache: "no-store",
      });
      if (res.status === 401) {
        setIsAuthenticated(false);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setClaims(data.claims || []);
        setClaimSummary(
          data.summary || { review: 0, paid: 0, blocked: 0, total: 0 },
        );
      }
    } catch {
      /* ignore */
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const loadWorkers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/workers", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setWorkers(data.workers || []);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const loadServiceRequests = useCallback(async (filter: SRFilter) => {
    try {
      const res = await fetch(`/api/admin/service-requests?status=${filter}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setServiceRequests(data.requests || []);
        setSrSummary(
          data.summary || {
            open: 0,
            in_progress: 0,
            resolved: 0,
            closed: 0,
            total: 0,
            aiClassified: 0,
          },
        );
      }
    } catch {
      /* ignore */
    }
  }, []);

  const loadBonuses = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/bonuses", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setBonuses(data.bonuses || []);
        setBonusSummary(
          data.summary || { totalPaid: 0, totalPending: 0, count: 0 },
        );
      }
    } catch {
      /* ignore */
    }
  }, []);

  const loadMlHealth = useCallback(async (silent: boolean = true) => {
    if (!silent) {
      setIsRunningMlSelfTest(true);
      setNotice("");
      setError("");
    }

    try {
      const res = await fetch("/api/ml/health", { cache: "no-store" });
      const data = (await res.json()) as MlHealthProbe;

      if (!res.ok) {
        if (!silent) {
          setError("ML self-test failed. Please retry.");
        }
        return;
      }

      setMlProbe(data);
      setMetrics((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          mlHealth: {
            ...prev.mlHealth,
            fraudEngine:
              data.runtimeSelfTest?.status ||
              data.status ||
              prev.mlHealth?.fraudEngine,
            runtimeValidation: {
              ...prev.mlHealth?.runtimeValidation,
              status: data.runtimeSelfTest?.status,
              passRate: data.runtimeSelfTest?.passRate,
              passedChecks: data.runtimeSelfTest?.passedChecks,
              totalChecks: data.runtimeSelfTest?.totalChecks,
              failedChecks: data.runtimeSelfTest?.failedChecks,
              generatedAt: data.runtimeSelfTest?.generatedAt,
            },
          },
        };
      });

      if (!silent) {
        const status = String(
          data.runtimeSelfTest?.status || data.status || "unknown",
        );
        const passRate = data.runtimeSelfTest?.passRate ?? 0;
        setNotice(
          `ML self-test complete: ${status.toUpperCase()} (${passRate}% pass rate)`,
        );
      }
    } catch {
      if (!silent) {
        setError("Unable to run ML self-test right now.");
      }
    } finally {
      if (!silent) {
        setIsRunningMlSelfTest(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    void loadDashboard();
    void loadClaims(claimFilter);
    void loadMlHealth(true);
  }, [isAuthenticated, loadDashboard, loadClaims, loadMlHealth, claimFilter]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (tab === "workers" || tab === "bonuses") void loadWorkers();
    if (tab === "service_requests") void loadServiceRequests(srFilter);
    if (tab === "bonuses") void loadBonuses();
  }, [
    isAuthenticated,
    tab,
    srFilter,
    loadWorkers,
    loadServiceRequests,
    loadBonuses,
  ]);

  /* ── Actions ── */
  const handleClaimAction = async (claimId: string, action: ClaimAction) => {
    setNotice("");
    setError("");
    setActiveAction(`${claimId}:${action}`);
    try {
      const res = await fetch("/api/admin/claims", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimId, action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Unable to process.");
        return;
      }
      setNotice(String(data?.message || "Done."));
      await loadClaims(claimFilter);
    } catch {
      setError("Action failed.");
    } finally {
      setActiveAction(null);
    }
  };

  const handleSRAction = async (
    requestId: string,
    status: string,
    notes: string,
  ) => {
    setNotice("");
    setError("");
    setActiveAction(`sr:${requestId}`);
    try {
      const res = await fetch("/api/admin/service-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, status, adminNotes: notes }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Failed.");
        return;
      }
      setNotice(data?.message || "Updated.");
      setSrResponseId(null);
      setSrResponseNotes("");
      await loadServiceRequests(srFilter);
    } catch {
      setError("Action failed.");
    } finally {
      setActiveAction(null);
    }
  };

  const handleCreateBonus = async () => {
    setNotice("");
    setError("");
    setActiveAction("bonus:create");
    try {
      const res = await fetch("/api/admin/bonuses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workerId: bonusForm.workerId,
          bonusType: bonusForm.bonusType,
          amount: parseFloat(bonusForm.amount) || 100,
          reason: bonusForm.reason,
          riskZone: bonusForm.riskZone || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Failed.");
        return;
      }
      setNotice(data?.message || "Bonus created.");
      setShowBonusForm(false);
      setBonusForm({
        workerId: "",
        bonusType: "",
        amount: "",
        reason: "",
        riskZone: "",
      });
      await loadBonuses();
    } catch {
      setError("Failed to create bonus.");
    } finally {
      setActiveAction(null);
    }
  };

  const handleBonusAction = async (
    bonusId: string,
    action: "approve" | "reject",
  ) => {
    setActiveAction(`bonus:${bonusId}`);
    try {
      const res = await fetch("/api/admin/bonuses", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bonusId, action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Failed.");
        return;
      }
      setNotice(data?.message || "Done.");
      await loadBonuses();
    } catch {
      setError("Bonus action failed.");
    } finally {
      setActiveAction(null);
    }
  };

  const refreshAll = async () => {
    setIsRefreshing(true);
    await Promise.all([
      loadDashboard(),
      loadClaims(claimFilter),
      loadMlHealth(true),
    ]);
    if (tab === "workers") await loadWorkers();
    if (tab === "service_requests") await loadServiceRequests(srFilter);
    if (tab === "bonuses") await loadBonuses();
    setIsRefreshing(false);
  };

  /* ── Render Gates ── */
  if (!mounted || !authChecked) return null;

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 fade-in">
        <div className="glass-card p-6 w-full max-w-sm">
          <div className="text-center mb-6">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-3 text-3xl"
              style={{
                background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
              }}
            >
              👑
            </div>
            <h1 className="text-xl font-bold text-slate-800">
              Admin Command Center
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Insurer / Review-Gated Claim Console
            </p>
          </div>
          <form className="space-y-4" onSubmit={handleLogin}>
            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">
                Admin Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@shiftsafe.in"
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">
                Security PIN
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none"
              />
            </div>
            {error && (
              <div className="text-xs text-red-500 font-bold bg-red-50 p-2 rounded">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 rounded-lg font-bold text-white shadow-md disabled:opacity-60"
              style={{
                background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
              }}
            >
              {isSubmitting ? "Verifying..." : "Verify Access →"}
            </button>
          </form>
          <div className="text-center mt-4">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 text-[10px] text-slate-500 font-semibold">
              💡 Demo: admin@shiftsafe.in / shiftsafe2026
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Dashboard Layout ── */
  const TABS: { id: AdminTab; label: string; emoji: string; badge?: number }[] =
    [
      { id: "overview", label: "Overview", emoji: "📊" },
      {
        id: "claims",
        label: "Claims",
        emoji: "📋",
        badge: claimSummary.review,
      },
      {
        id: "workers",
        label: "Workers",
        emoji: "👥",
        badge: metrics?.stats?.totalWorkers,
      },
      {
        id: "service_requests",
        label: "Requests",
        emoji: "🎫",
        badge: srSummary.open,
      },
      { id: "bonuses", label: "Bonuses", emoji: "🏆" },
    ];

  const mlRuntimeStatus =
    metrics?.mlHealth?.runtimeValidation?.status || "unknown";
  const mlRuntimeLabel =
    mlRuntimeStatus === "operational"
      ? "runtime checks passing"
      : mlRuntimeStatus === "degraded"
        ? "runtime check failures"
        : "waiting for runtime data";
  const mlRuntimeBadgeClass =
    mlRuntimeStatus === "operational"
      ? "bg-emerald-100 text-emerald-700"
      : mlRuntimeStatus === "degraded"
        ? "bg-red-100 text-red-700"
        : "bg-slate-100 text-slate-600";

  return (
    <div className="space-y-4 max-w-6xl mx-auto fade-in pb-8 px-3 sm:px-6 overflow-x-hidden">
      {/* Header */}
      <div className="glass-card p-4 sm:p-5 mt-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <span
                className="w-9 h-9 rounded-xl flex items-center justify-center text-lg"
                style={{
                  background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
                }}
              >
                <span className="text-white text-sm">👑</span>
              </span>
              Admin Command Center
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Review-gated claim settlement · Risk management · Worker analytics
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refreshAll}
              className="px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              {isRefreshing ? "⟳ Refreshing..." : "⟳ Refresh"}
            </button>
            <button
              onClick={handleLogout}
              className="px-3 py-2 rounded-lg text-xs font-bold border border-red-200 text-red-600 hover:bg-red-50"
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="mt-4 -mx-4 sm:-mx-5 px-4 sm:px-5">
          <div className="flex items-center gap-2 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all shrink-0 ${
                  tab === t.id
                    ? "bg-slate-900 text-white shadow-md"
                    : "bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"
                }`}
              >
                <span>{t.emoji}</span>
                {t.label}
                {t.badge !== undefined && t.badge > 0 && (
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${tab === t.id ? "bg-white/20 text-white" : "bg-orange-100 text-orange-700"}`}
                  >
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {notice && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-2.5">
          {notice}
        </div>
      )}
      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
          {error}
        </div>
      )}

      {/* ═══ TAB: OVERVIEW ═══ */}
      {tab === "overview" && (
        <div className="space-y-4">
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              {
                title: "Active Policies",
                value: String(metrics?.stats?.activePolicies ?? 0),
                hint: "Insured workers",
                cls: "bg-blue-50 text-blue-700 border-blue-200",
                emoji: "🛡️",
              },
              {
                title: "Weekly Premium Pool",
                value: `₹${(metrics?.stats?.weeklyPremiumsCollected ?? 0).toLocaleString()}`,
                hint: "Collected this cycle",
                cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
                emoji: "💰",
              },
              {
                title: "Total Payouts",
                value: `₹${(metrics?.stats?.totalPayouts ?? 0).toLocaleString()}`,
                hint: "Claims settled",
                cls: "bg-orange-50 text-orange-700 border-orange-200",
                emoji: "📤",
              },
              {
                title: "Approval Rate",
                value: metrics?.stats?.claimApprovalRate || "N/A",
                hint: "Last 30 days",
                cls: "bg-purple-50 text-purple-700 border-purple-200",
                emoji: "✅",
              },
            ].map((c) => (
              <div key={c.title} className={`border rounded-2xl p-4 ${c.cls}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">{c.emoji}</span>
                  <span className="text-[10px] uppercase tracking-wider font-bold opacity-80">
                    {c.title}
                  </span>
                </div>
                <div className="text-2xl sm:text-3xl font-black">{c.value}</div>
                <div className="text-[10px] mt-1 opacity-70">{c.hint}</div>
              </div>
            ))}
          </div>

          {/* Second Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              {
                title: "Review Queue",
                value: String(claimSummary.review),
                cls: "bg-orange-50 text-orange-700 border-orange-200",
              },
              {
                title: "Settled Claims",
                value: String(claimSummary.paid),
                cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
              },
              {
                title: "Blocked Claims",
                value: String(claimSummary.blocked),
                cls: "bg-red-50 text-red-700 border-red-200",
              },
              {
                title: "Total Workers",
                value: String(metrics?.stats?.totalWorkers ?? 0),
                cls: "bg-slate-100 text-slate-700 border-slate-200",
              },
            ].map((c) => (
              <div key={c.title} className={`border rounded-2xl p-3 ${c.cls}`}>
                <div className="text-[10px] uppercase tracking-wider font-bold opacity-80">
                  {c.title}
                </div>
                <div className="text-xl font-black mt-1">{c.value}</div>
              </div>
            ))}
          </div>

          {/* Predictive + Actuarial + Automation */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="glass-card p-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-600 mb-3 flex items-center gap-1.5">
                <span>🔮</span> Next-Week Forecast
              </h3>
              <div className="space-y-2 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-500">Projected Claims</span>
                  <span className="font-bold text-slate-800">
                    {metrics?.predictiveAnalytics?.projectedClaimsNextWeek ?? 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Projected Payout</span>
                  <span className="font-bold text-slate-800">
                    ₹
                    {(
                      metrics?.predictiveAnalytics?.projectedPayoutNextWeek ?? 0
                    ).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Top Risk</span>
                  <span className="font-bold text-orange-600">
                    {(
                      metrics?.predictiveAnalytics?.topRiskTrigger || "None"
                    ).replace(/_/g, " ")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Confidence</span>
                  <span className="font-bold text-slate-800">
                    {metrics?.predictiveAnalytics?.confidence || "N/A"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Seasonal Multiplier</span>
                  <span className="font-bold text-purple-600">
                    ×
                    {metrics?.predictiveAnalytics?.seasonalMultiplier?.toFixed(
                      2,
                    ) ?? "1.00"}
                  </span>
                </div>
              </div>
            </div>

            <div className="glass-card p-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-600 mb-3 flex items-center gap-1.5">
                <span>📈</span> Actuarial Health
              </h3>
              <div className="space-y-2 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-500">Loss Ratio</span>
                  <span
                    className={`font-bold ${(metrics?.actuarial?.lossRatio ?? 0) > 100 ? "text-red-600" : "text-emerald-600"}`}
                  >
                    {metrics?.actuarial?.lossRatio?.toFixed(1) ?? 0}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">BCR</span>
                  <span className="font-bold text-slate-800">
                    {metrics?.actuarial?.bcr?.toFixed(2) ?? "0.00"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Opted Out</span>
                  <span className="font-bold text-slate-800">
                    {metrics?.stats?.optedOutWorkers ?? 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Ineligible</span>
                  <span className="font-bold text-slate-800">
                    {metrics?.stats?.ineligibleWorkers ?? 0}
                  </span>
                </div>
              </div>
            </div>

            <div className="glass-card p-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-600 mb-3 flex items-center gap-1.5">
                <span>🤖</span> Automation Health
              </h3>
              <div className="space-y-2 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-500">Status</span>
                  <span
                    className={`font-bold ${metrics?.automationHealth?.status === "healthy" ? "text-emerald-600" : metrics?.automationHealth?.status === "degraded" ? "text-orange-600" : "text-red-600"}`}
                  >
                    {metrics?.automationHealth?.status === "healthy"
                      ? "✅ Healthy"
                      : metrics?.automationHealth?.status === "degraded"
                        ? "⚠️ Degraded"
                        : "❌ Critical"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Monitor Runs (24h)</span>
                  <span className="font-bold text-slate-800">
                    {metrics?.automationHealth?.monitorRunsLast24h ?? 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Failed Runs</span>
                  <span className="font-bold text-slate-800">
                    {metrics?.automationHealth?.failedMonitorRunsLast24h ?? 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Last Run</span>
                  <span className="font-bold text-slate-800">
                    {metrics?.automationHealth?.latestMonitorRun
                      ? ago(
                          metrics.automationHealth.latestMonitorRun.started_at,
                        )
                      : "Never"}
                  </span>
                </div>
              </div>

              {/* Auto-settlement threshold info */}
              <div className="mt-3 pt-3 border-t border-slate-100">
                <div className="text-[10px] font-bold text-slate-500 uppercase mb-2">Auto-Settlement Rules</div>
                <div className="space-y-1.5 text-[10px]">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-slate-600">Fraud Score ≤ 25 → <strong className="text-emerald-600">Auto-Approve + Instant UPI Payout</strong></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-orange-500" />
                    <span className="text-slate-600">Fraud Score 26-60 → <strong className="text-orange-600">Admin Review Queue</strong></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="text-slate-600">Fraud Score &gt; 60 → <strong className="text-red-600">Auto-Block</strong></span>
                  </div>
                </div>
              </div>
            </div>

            {/* ─── Automation Pipeline Visualization ─── */}
            <div className="glass-card p-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-600 mb-3 flex items-center gap-1.5">
                <span>⚙️</span> Claim Processing Pipeline
              </h3>
              <div className="space-y-0">
                {[
                  { icon: "🌡️", title: "Environmental Monitor", desc: "OpenWeather + AQICN live APIs", status: "Active", color: "#f97316" },
                  { icon: "📍", title: "GPS Verification", desc: "Browser Geolocation + zone match", status: "Active", color: "#3b82f6" },
                  { icon: "🤖", title: "Isolation Forest ML", desc: "8-factor fraud scoring engine", status: "Active", color: "#8b5cf6" },
                  { icon: "⚡", title: "Smart Settlement", desc: "Auto-approve (≤25) or admin review", status: "Auto", color: "#10b981" },
                  { icon: "💰", title: "UPI Instant Payout", desc: "Razorpay sandbox settlement", status: "Ready", color: "#f59e0b" },
                ].map((step, i) => (
                  <div key={i} className="flex gap-2.5">
                    <div className="flex flex-col items-center">
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-sm"
                        style={{ background: `${step.color}15`, border: `1.5px solid ${step.color}40` }}
                      >
                        {step.icon}
                      </div>
                      {i < 4 && <div className="w-px h-4" style={{ background: `${step.color}30` }} />}
                    </div>
                    <div className="flex-1 pb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-bold text-slate-800">{step.title}</span>
                        <span
                          className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full"
                          style={{ background: `${step.color}15`, color: step.color }}
                        >
                          {step.status}
                        </span>
                      </div>
                      <div className="text-[9px] text-slate-500">{step.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ═══ AI/ML Intelligence Panel ═══ */}
          <div
            className="glass-card p-4"
            style={{
              borderColor: "#8b5cf622",
              background:
                "linear-gradient(135deg, #faf5ff 0%, #f1f0ff 50%, #eff6ff 100%)",
            }}
          >
            <h3
              className="text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-2"
              style={{ color: "#6d28d9" }}
            >
              <span
                className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px]"
                style={{
                  background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
                }}
              >
                <span className="text-white">🧠</span>
              </span>
              AI/ML Intelligence Center
              <span
                className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${mlRuntimeBadgeClass}`}
              >
                {mlRuntimeLabel}
              </span>
            </h3>

            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-[10px] text-slate-500">
                Last self-test:{" "}
                {mlProbe?.runtimeSelfTest?.generatedAt
                  ? ago(mlProbe.runtimeSelfTest.generatedAt)
                  : "Not run in this session"}
              </div>
              <button
                onClick={() => void loadMlHealth(false)}
                disabled={isRunningMlSelfTest}
                className="px-3 py-1.5 rounded-lg text-[10px] font-bold border border-indigo-200 bg-indigo-50 text-indigo-700 disabled:opacity-60 hover:bg-indigo-100"
              >
                {isRunningMlSelfTest
                  ? "Running ML Self-Test..."
                  : "Run ML Self-Test"}
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {/* Isolation Forest Model */}
              <div className="rounded-xl border border-purple-200 bg-white/80 p-3.5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] bg-purple-100 text-purple-700">
                    🌲
                  </span>
                  <span className="text-[11px] font-bold text-purple-800">
                    Isolation Forest Fraud Engine
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-purple-100 text-purple-700">
                    {metrics?.mlHealth?.modelVersion || "IF-v2.1"}
                  </span>
                </div>
                <div className="space-y-1.5 text-[10px]">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Architecture</span>
                    <span className="font-semibold text-slate-800">
                      100 trees × depth 10
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Feature Inputs</span>
                    <span className="font-semibold text-slate-800">
                      15-dimensional vector
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Scoring</span>
                    <span className="font-semibold text-slate-800">
                      60% ML + 40% Rules (Hybrid)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">GPS Validation</span>
                    <span className="font-semibold text-emerald-600">
                      ✓ Haversine + Geofencing
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Spoof Detection</span>
                    <span className="font-semibold text-emerald-600">
                      ✓ Accuracy + Speed analysis
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Reproducibility</span>
                    <span className="font-semibold text-emerald-600">
                      ✓ Seeded PRNG (det.)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Runtime Checks</span>
                    <span
                      className={`font-semibold ${mlRuntimeStatus === "operational" ? "text-emerald-600" : mlRuntimeStatus === "degraded" ? "text-red-600" : "text-slate-500"}`}
                    >
                      {metrics?.mlHealth?.runtimeValidation?.passedChecks ?? 0}/
                      {metrics?.mlHealth?.runtimeValidation?.totalChecks ?? 0}{" "}
                      passing
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Pass Rate</span>
                    <span className="font-semibold text-slate-800">
                      {metrics?.mlHealth?.runtimeValidation?.passRate ?? 0}%
                    </span>
                  </div>
                </div>
                {/* Live sample diagnostics */}
                <div className="mt-2.5 pt-2.5 border-t border-purple-100">
                  <div className="text-[9px] uppercase font-bold text-purple-500 mb-1.5">
                    Live Model Diagnostics
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2 text-center">
                      <div className="text-[9px] text-emerald-600 font-bold">
                        Clean Sample
                      </div>
                      <div className="text-lg font-black text-emerald-700">
                        {metrics?.mlHealth?.cleanSample?.score ?? "—"}
                      </div>
                      <div className="text-[8px] text-emerald-500">
                        score / CLEAN
                      </div>
                    </div>
                    <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-center">
                      <div className="text-[9px] text-red-600 font-bold">
                        Fraud Sample
                      </div>
                      <div className="text-lg font-black text-red-700">
                        {metrics?.mlHealth?.suspiciousSample?.score ?? "—"}
                      </div>
                      <div className="text-[8px] text-red-500">
                        score /{" "}
                        {metrics?.mlHealth?.suspiciousSample?.decision ??
                          "BLOCKED"}
                      </div>
                    </div>
                  </div>

                  {metrics?.mlHealth?.runtimeValidation?.failedChecks &&
                    metrics.mlHealth.runtimeValidation.failedChecks.length >
                      0 && (
                      <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2">
                        <div className="text-[9px] font-bold uppercase tracking-wider text-red-600">
                          Failed Runtime Checks
                        </div>
                        <div className="mt-1 text-[10px] text-red-700">
                          {metrics.mlHealth.runtimeValidation.failedChecks.join(
                            " | ",
                          )}
                        </div>
                      </div>
                    )}
                </div>
              </div>

              {/* Feature Importance + NLP Classifier */}
              <div className="space-y-3">
                {/* Feature Importance */}
                <div className="rounded-xl border border-blue-200 bg-white/80 p-3.5">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] bg-blue-100 text-blue-700">
                      📊
                    </span>
                    <span className="text-[11px] font-bold text-blue-800">
                      Feature Importance (15D)
                    </span>
                  </div>
                  <div className="space-y-1">
                    {[
                      { name: "GPS Distance", weight: 15, color: "#8b5cf6" },
                      { name: "Amount Ratio", weight: 12, color: "#f59e0b" },
                      { name: "Claim Freq.", weight: 10, color: "#3b82f6" },
                      { name: "Multi-Login", weight: 8, color: "#ef4444" },
                      { name: "GPS Accuracy", weight: 8, color: "#10b981" },
                      { name: "Speed Check", weight: 8, color: "#6366f1" },
                      { name: "Duplicate", weight: 7, color: "#ec4899" },
                      { name: "Policy", weight: 7, color: "#14b8a6" },
                      { name: "Device Swap", weight: 5, color: "#a855f7" },
                      { name: "Hour Bucket", weight: 5, color: "#0ea5e9" },
                      { name: "Integrity", weight: 4, color: "#d946ef" },
                      { name: "Bank Match", weight: 3, color: "#f43f5e" },
                      { name: "Time Gap", weight: 3, color: "#84cc16" },
                      { name: "Battery", weight: 3, color: "#64748b" },
                      { name: "Altitude", weight: 2, color: "#06b6d4" },
                    ].map((f) => (
                      <div
                        key={f.name}
                        className="flex items-center gap-2 text-[10px]"
                      >
                        <span className="w-16 text-slate-500 shrink-0">
                          {f.name}
                        </span>
                        <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${f.weight * 4.5}%`,
                              background: f.color,
                            }}
                          />
                        </div>
                        <span className="font-bold text-slate-700 w-8 text-right">
                          {f.weight}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* NLP Service Request Classifier */}
                <div className="rounded-xl border border-indigo-200 bg-white/80 p-3.5">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] bg-indigo-100 text-indigo-700">
                      💬
                    </span>
                    <span className="text-[11px] font-bold text-indigo-800">
                      NLP Service Request Classifier
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${metrics?.mlHealth?.serviceRequestAI?.status === "degraded" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}
                    >
                      {metrics?.mlHealth?.serviceRequestAI?.status ===
                      "degraded"
                        ? "DEGRADED"
                        : "ONLINE"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {[
                      "Urgency Scoring",
                      "Sentiment Analysis",
                      "Auto-Priority",
                      "Category Confidence",
                      "Auto-Action",
                    ].map((cap) => (
                      <span
                        key={cap}
                        className="px-2 py-0.5 rounded-full text-[8px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200"
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2 text-[10px]">
                    <div className="rounded-md bg-indigo-50 border border-indigo-200 px-2 py-1.5">
                      <div className="text-[9px] uppercase font-bold tracking-wider text-indigo-500">
                        Sample Urgency
                      </div>
                      <div className="font-bold text-indigo-800">
                        {metrics?.mlHealth?.serviceRequestAI?.sample
                          ?.urgencyScore ?? 0}
                        /100
                      </div>
                    </div>
                    <div className="rounded-md bg-indigo-50 border border-indigo-200 px-2 py-1.5">
                      <div className="text-[9px] uppercase font-bold tracking-wider text-indigo-500">
                        Sample Sentiment
                      </div>
                      <div className="font-bold text-indigo-800 capitalize">
                        {metrics?.mlHealth?.serviceRequestAI?.sample
                          ?.sentimentLabel || "unknown"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 bg-white/80 p-3.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                  ML Usage Last 30 Days
                </div>
                {mlProbe?.telemetry?.status === "degraded" && (
                  <div className="mb-2 rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-[10px] text-orange-700">
                    Telemetry degraded: live usage stats may be partial.
                  </div>
                )}
                <div className="space-y-1.5 text-[10px]">
                  <div className="flex justify-between">
                    <span className="text-slate-500">
                      Claims Scoring Coverage
                    </span>
                    <span className="font-semibold text-slate-800">
                      {mlProbe?.usage?.claims30d?.scoringCoverage ?? 0}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Claims Scored</span>
                    <span className="font-semibold text-slate-800">
                      {mlProbe?.usage?.claims30d?.scored ?? 0}/
                      {mlProbe?.usage?.claims30d?.total ?? 0}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Avg Fraud Score</span>
                    <span className="font-semibold text-slate-800">
                      {mlProbe?.usage?.claims30d?.averageFraudScore ?? 0}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Request AI Coverage</span>
                    <span className="font-semibold text-slate-800">
                      {mlProbe?.usage?.serviceRequests30d
                        ?.classificationCoverage ?? 0}
                      %
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Avg AI Urgency</span>
                    <span className="font-semibold text-slate-800">
                      {mlProbe?.usage?.serviceRequests30d
                        ?.averageUrgencyScore ?? 0}
                      /100
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white/80 p-3.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                  Latest Runtime Check Details
                </div>
                <div className="space-y-1.5 text-[10px] max-h-36 overflow-auto pr-1">
                  {(mlProbe?.runtimeSelfTest?.checks || []).length === 0 ? (
                    <div className="text-slate-500">
                      Run self-test to view detailed checks.
                    </div>
                  ) : (
                    (mlProbe?.runtimeSelfTest?.checks || []).map((check) => (
                      <div
                        key={check.name}
                        className={`rounded-md border px-2 py-1 ${check.passed ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}
                      >
                        <div
                          className={`font-bold ${check.passed ? "text-emerald-700" : "text-red-700"}`}
                        >
                          {check.passed ? "PASS" : "FAIL"} · {check.name}
                        </div>
                        {!check.passed && (
                          <div className="mt-0.5 text-red-700">
                            expected {check.expected} · actual {check.actual}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* City Pools & Premium Tiers */}
          {(metrics?.cityPools || metrics?.premiumTiers) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {metrics?.cityPools && metrics.cityPools.length > 0 && (
                <div className="glass-card p-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-600 mb-3">
                    🏙️ City Pool Breakdown
                  </h3>
                  <div className="space-y-2">
                    {metrics.cityPools.map((cp, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between text-[11px] bg-slate-50 rounded-lg p-2.5"
                      >
                        <span className="font-semibold text-slate-700">
                          {cp.city_pool}
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="text-slate-500">
                            {cp.count} policies
                          </span>
                          <span className="font-bold text-slate-800">
                            ₹{Number(cp.total_premium || 0).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {metrics?.premiumTiers && metrics.premiumTiers.length > 0 && (
                <div className="glass-card p-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-600 mb-3">
                    📊 Premium Tier Mix
                  </h3>
                  <div className="space-y-2">
                    {metrics.premiumTiers.map((pt, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between text-[11px] bg-slate-50 rounded-lg p-2.5"
                      >
                        <span className="font-semibold text-slate-700 capitalize">
                          {pt.premium_tier}
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="text-slate-500">
                            {pt.count} workers
                          </span>
                          <span className="font-bold text-slate-800">
                            ₹{Number(pt.total_premium || 0).toLocaleString()}/wk
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Workflow */}
          <div className="glass-card p-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-600 mb-3">
              ⚙️ Workflow Guardrails
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-[11px]">
              {[
                {
                  step: "1",
                  title: "Trigger Detected",
                  desc: "5-source parametric engine fires claim",
                  icon: "📡",
                },
                {
                  step: "2",
                  title: "Fraud Scored",
                  desc: "Isolation Forest ML model evaluates risk",
                  icon: "🤖",
                },
                {
                  step: "3",
                  title: "Admin Review",
                  desc: "No auto-payout — manual approval required",
                  icon: "👁️",
                },
                {
                  step: "4",
                  title: "UPI Settlement",
                  desc: "Approved claims paid instantly via UPI",
                  icon: "💰",
                },
              ].map((s) => (
                <div
                  key={s.step}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span>{s.icon}</span>
                    <span className="font-bold text-slate-800">{s.title}</span>
                  </div>
                  <div className="text-slate-500">{s.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ TAB: CLAIMS ═══ */}
      {tab === "claims" && (
        <div className="glass-card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-600">
              Claim Queue
            </h2>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {(["review", "paid", "blocked", "all"] as ClaimFilter[]).map(
                (f) => (
                  <button
                    key={f}
                    onClick={() => setClaimFilter(f)}
                    className={`px-3 py-1.5 rounded-full text-[11px] font-bold uppercase whitespace-nowrap border ${claimFilter === f ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"}`}
                  >
                    {f}
                  </button>
                ),
              )}
              <div className="w-[1px] h-6 bg-slate-200 mx-1 shrink-0"></div>
              <button
                onClick={() => downloadClaimsCSV(filteredClaims, "All Workers")}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 border border-blue-200 rounded-full text-[11px] font-bold uppercase whitespace-nowrap hover:bg-blue-100 transition-colors"
                title="Download as CSV"
              >
                <span>⬇️</span> Export CSV
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {isRefreshing && !claims.length ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="animate-pulse bg-slate-50 rounded-2xl p-4 h-24"
                  />
                ))}
              </div>
            ) : claims.length ? (
              claims.map((c) => (
                <div
                  key={c.id}
                  className="border border-slate-200 rounded-2xl p-4 bg-white"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-mono text-slate-400">
                        {c.id.slice(0, 12)}…
                      </div>
                      <div className="text-sm font-bold text-slate-900 mt-0.5">
                        {c.workerName} · {mask(c.workerPhone)}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {c.platform} · {c.city} · {c.zone}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase ${statusColor(c.status)}`}
                    >
                      {statusLabel(c.status)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-[11px]">
                    <div className="bg-slate-50 rounded-lg p-2">
                      <div className="text-slate-500 uppercase font-bold text-[9px]">
                        Trigger
                      </div>
                      <div className="font-semibold text-slate-800 mt-1">
                        {c.triggerType.replace(/_/g, " ").toUpperCase()}
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2">
                      <div className="text-slate-500 uppercase font-bold text-[9px]">
                        Amount
                      </div>
                      <div className="font-semibold text-slate-800 mt-1">
                        ₹{c.amount.toLocaleString()}
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2">
                      <div className="text-slate-500 uppercase font-bold text-[9px]">
                        Fraud Score
                      </div>
                      <div
                        className={`font-semibold mt-1 ${fraudColor(c.fraudScore)}`}
                      >
                        {c.fraudLabel}
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2">
                      <div className="text-slate-500 uppercase font-bold text-[9px]">
                        Priority
                      </div>
                      <div className="font-semibold text-slate-800 mt-1">
                        {c.reviewPriority.toUpperCase()}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-3 text-[11px] text-slate-500">
                    <span>Submitted: {fmt(c.createdAt)}</span>
                    <span>Processed: {fmt(c.processedAt)}</span>
                    {c.settlement.transactionRef && (
                      <span>Txn: {c.settlement.transactionRef}</span>
                    )}
                  </div>
                  {c.status === "review" && (
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => void handleClaimAction(c.id, "approve")}
                        disabled={activeAction !== null}
                        className="flex-1 px-3 py-2 rounded-lg text-xs font-bold bg-emerald-600 text-white disabled:opacity-60 hover:bg-emerald-700 transition-all"
                      >
                        {activeAction === `${c.id}:approve`
                          ? "Approving..."
                          : "✓ Approve & Settle"}
                      </button>
                      <button
                        onClick={() => void handleClaimAction(c.id, "reject")}
                        disabled={activeAction !== null}
                        className="flex-1 px-3 py-2 rounded-lg text-xs font-bold bg-red-600 text-white disabled:opacity-60 hover:bg-red-700 transition-all"
                      >
                        {activeAction === `${c.id}:reject`
                          ? "Rejecting..."
                          : "✕ Reject"}
                      </button>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-6 text-center">
                <div className="text-3xl mb-2">📋</div>
                No claims found for &quot;{claimFilter}&quot; filter.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ TAB: WORKERS ═══ */}
      {tab === "workers" && (
        <div className="glass-card p-4">
          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-600 mb-4">
            👥 Worker Directory
          </h2>
          {workers.length === 0 ? (
            <div className="text-sm text-slate-500 text-center p-6">
              Loading workers...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-slate-200">
                    {[
                      "Worker",
                      "Platform",
                      "City / Zone",
                      "Income / Wk",
                      "Tier",
                      "Policy",
                      "Claims",
                      "Payouts",
                      "Bonuses",
                      "Joined",
                    ].map((h) => (
                      <th
                        key={h}
                        className="text-left py-2 px-2 text-[9px] font-bold uppercase tracking-wider text-slate-500"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {workers.map((w) => (
                    <tr
                      key={w.id}
                      className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                    >
                      <td className="py-2.5 px-2">
                        <div className="font-bold text-slate-800">{w.name}</div>
                        <div className="text-slate-400 font-mono text-[9px]">
                          {mask(w.phone)}
                        </div>
                      </td>
                      <td className="py-2.5 px-2 text-slate-700">
                        {w.platform}
                      </td>
                      <td className="py-2.5 px-2">
                        <div className="text-slate-700">{w.city}</div>
                        <div className="text-slate-400 text-[9px]">
                          {w.zone}
                        </div>
                      </td>
                      <td className="py-2.5 px-2 font-semibold text-slate-800">
                        ₹{Number(w.avg_weekly_income || 0).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-2">
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-slate-100 text-slate-600 border border-slate-200 capitalize">
                          {w.activity_tier}
                        </span>
                      </td>
                      <td className="py-2.5 px-2">
                        {w.insurance_opted_out ? (
                          <span className="text-slate-400">Opted out</span>
                        ) : w.policy_status ? (
                          <span
                            className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${statusColor(w.policy_status)}`}
                          >
                            {w.policy_status}
                          </span>
                        ) : (
                          <span className="text-slate-400">None</span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-slate-700">
                        {w.total_claims}{" "}
                        <span className="text-slate-400">
                          ({w.approved_claims} ✓)
                        </span>
                      </td>
                      <td className="py-2.5 px-2 font-semibold text-emerald-600">
                        ₹{Number(w.total_payouts || 0).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-2 font-semibold text-purple-600">
                        ₹{Number(w.total_bonuses || 0).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-2 text-slate-400">
                        {ago(w.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ TAB: SERVICE REQUESTS ═══ */}
      {tab === "service_requests" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {[
              {
                label: "Open",
                val: srSummary.open,
                cls: "bg-blue-50 text-blue-700 border-blue-200",
              },
              {
                label: "In Progress",
                val: srSummary.in_progress,
                cls: "bg-orange-50 text-orange-700 border-orange-200",
              },
              {
                label: "Resolved",
                val: srSummary.resolved,
                cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
              },
              {
                label: "Closed",
                val: srSummary.closed,
                cls: "bg-slate-100 text-slate-600 border-slate-200",
              },
              {
                label: "AI Classified",
                val: srSummary.aiClassified,
                cls: "bg-indigo-50 text-indigo-700 border-indigo-200",
              },
            ].map((s) => (
              <div
                key={s.label}
                className={`border rounded-xl p-3 text-center ${s.cls}`}
              >
                <div className="text-lg font-black">{s.val}</div>
                <div className="text-[9px] uppercase font-bold tracking-wider">
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold uppercase tracking-widest text-slate-600">
                🎫 Service Requests
              </h2>
              <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                {(["all", "open", "in_progress", "resolved"] as SRFilter[]).map(
                  (f) => (
                    <button
                      key={f}
                      onClick={() => setSrFilter(f)}
                      className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase border ${srFilter === f ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200"}`}
                    >
                      {f.replace(/_/g, " ")}
                    </button>
                  ),
                )}
              </div>
            </div>

            <div className="space-y-3">
              {serviceRequests.length === 0 ? (
                <div className="text-sm text-slate-500 text-center p-6 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="text-3xl mb-2">🎫</div>No service requests
                  found.
                </div>
              ) : (
                serviceRequests.map((sr: ServiceRequest) => (
                  <div
                    key={sr.id}
                    className="border border-slate-200 rounded-2xl p-4 bg-white"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold text-slate-900">
                          {sr.subject}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {SR_CATEGORIES[sr.category] || sr.category} ·{" "}
                          {sr.worker_name} · {sr.platform} · {sr.city}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase ${
                            sr.priority === "urgent"
                              ? "bg-red-100 text-red-700 border border-red-200"
                              : sr.priority === "high"
                                ? "bg-orange-100 text-orange-700 border border-orange-200"
                                : "bg-slate-100 text-slate-600 border border-slate-200"
                          }`}
                        >
                          {sr.priority}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase ${statusColor(sr.status)}`}
                        >
                          {sr.status.replace(/_/g, " ")}
                        </span>
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-600 mt-2 line-clamp-2">
                      {sr.description}
                    </div>

                    {sr.ai && (
                      <div className="mt-2 rounded-lg border border-indigo-200 bg-indigo-50/60 p-2.5">
                        <div className="flex flex-wrap items-center gap-1.5 text-[9px]">
                          <span className="px-2 py-0.5 rounded-full font-bold bg-indigo-100 text-indigo-700 border border-indigo-200">
                            AI urgency {sr.ai.urgencyScore}/100
                          </span>
                          <span className="px-2 py-0.5 rounded-full font-bold bg-indigo-100 text-indigo-700 border border-indigo-200 capitalize">
                            {sr.ai.sentimentLabel}
                          </span>
                          <span className="px-2 py-0.5 rounded-full font-bold bg-indigo-100 text-indigo-700 border border-indigo-200">
                            confidence{" "}
                            {Math.round(sr.ai.categoryConfidence * 100)}%
                          </span>
                          <span className="px-2 py-0.5 rounded-full font-bold bg-indigo-100 text-indigo-700 border border-indigo-200 uppercase">
                            {sr.ai_model_version || "NLP-KW-v1.2"}
                          </span>
                        </div>
                        {sr.ai.autoAction && (
                          <div className="mt-1.5 text-[10px] text-indigo-700">
                            Suggested action: {sr.ai.autoAction}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="text-[10px] text-slate-400 mt-1">
                      {ago(sr.created_at)}
                    </div>

                    {sr.admin_notes && (
                      <div className="mt-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-[11px] text-emerald-700">
                        <span className="font-bold">Admin Response:</span>{" "}
                        {sr.admin_notes}
                      </div>
                    )}

                    {(sr.status === "open" || sr.status === "in_progress") && (
                      <div className="mt-3">
                        {srResponseId === sr.id ? (
                          <div className="space-y-2">
                            <textarea
                              className="input-field text-xs min-h-15"
                              value={srResponseNotes}
                              onChange={(e) =>
                                setSrResponseNotes(e.target.value)
                              }
                              placeholder="Admin response / resolution notes..."
                            />
                            <div className="flex gap-2">
                              <select
                                className="select-field text-xs shrink-0 w-auto"
                                value={srResponseStatus}
                                onChange={(e) =>
                                  setSrResponseStatus(e.target.value)
                                }
                              >
                                <option value="in_progress">In Progress</option>
                                <option value="resolved">Resolved</option>
                                <option value="closed">Closed</option>
                              </select>
                              <button
                                onClick={() =>
                                  void handleSRAction(
                                    sr.id,
                                    srResponseStatus,
                                    srResponseNotes,
                                  )
                                }
                                disabled={activeAction !== null}
                                className="flex-1 px-3 py-2 rounded-lg text-xs font-bold bg-emerald-600 text-white disabled:opacity-60 hover:bg-emerald-700"
                              >
                                {activeAction === `sr:${sr.id}`
                                  ? "Saving..."
                                  : "Submit Response"}
                              </button>
                              <button
                                onClick={() => setSrResponseId(null)}
                                className="px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 text-slate-500"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setSrResponseId(sr.id);
                              setSrResponseNotes(sr.admin_notes || "");
                            }}
                            className="px-4 py-2 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 transition-all"
                          >
                            📝 Respond
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ TAB: BONUSES ═══ */}
      {tab === "bonuses" && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="border rounded-xl p-3 text-center bg-emerald-50 text-emerald-700 border-emerald-200">
              <div className="text-lg font-black">
                ₹{bonusSummary.totalPaid.toLocaleString()}
              </div>
              <div className="text-[9px] uppercase font-bold tracking-wider">
                Total Paid
              </div>
            </div>
            <div className="border rounded-xl p-3 text-center bg-orange-50 text-orange-700 border-orange-200">
              <div className="text-lg font-black">
                ₹{bonusSummary.totalPending.toLocaleString()}
              </div>
              <div className="text-[9px] uppercase font-bold tracking-wider">
                Pending
              </div>
            </div>
            <div className="border rounded-xl p-3 text-center bg-purple-50 text-purple-700 border-purple-200">
              <div className="text-lg font-black">{bonusSummary.count}</div>
              <div className="text-[9px] uppercase font-bold tracking-wider">
                Total Bonuses
              </div>
            </div>
          </div>

          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold uppercase tracking-widest text-slate-600">
                🏆 Risk Bonus System
              </h2>
              <button
                onClick={() => setShowBonusForm(!showBonusForm)}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${showBonusForm ? "bg-slate-100 text-slate-600 border border-slate-200" : "bg-purple-600 text-white hover:bg-purple-700"}`}
              >
                {showBonusForm ? "← Cancel" : "⊕ New Bonus"}
              </button>
            </div>

            {/* Create Bonus Form */}
            {showBonusForm && (
              <div className="mb-4 p-4 bg-purple-50/50 border border-purple-200 rounded-xl space-y-3">
                <div className="text-xs font-bold text-purple-800 mb-2">
                  Create Risk Bonus
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">
                      Worker ID
                    </label>
                    <select
                      className="select-field text-xs"
                      value={bonusForm.workerId}
                      onChange={(e) =>
                        setBonusForm((p) => ({
                          ...p,
                          workerId: e.target.value,
                        }))
                      }
                    >
                      <option value="">Select worker...</option>
                      {workers.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name} — {w.platform} — {w.city}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">
                      Bonus Type
                    </label>
                    <select
                      className="select-field text-xs"
                      value={bonusForm.bonusType}
                      onChange={(e) =>
                        setBonusForm((p) => ({
                          ...p,
                          bonusType: e.target.value,
                        }))
                      }
                    >
                      <option value="">Select type...</option>
                      {BONUS_TYPES.map((bt) => (
                        <option key={bt.value} value={bt.value}>
                          {bt.emoji} {bt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">
                      Amount (₹)
                    </label>
                    <input
                      className="input-field text-xs"
                      type="number"
                      value={bonusForm.amount}
                      onChange={(e) =>
                        setBonusForm((p) => ({ ...p, amount: e.target.value }))
                      }
                      placeholder="100"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">
                      Risk Zone
                    </label>
                    <input
                      className="input-field text-xs"
                      value={bonusForm.riskZone}
                      onChange={(e) =>
                        setBonusForm((p) => ({
                          ...p,
                          riskZone: e.target.value,
                        }))
                      }
                      placeholder="e.g. Andheri East"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">
                    Reason
                  </label>
                  <textarea
                    className="input-field text-xs min-h-15"
                    value={bonusForm.reason}
                    onChange={(e) =>
                      setBonusForm((p) => ({ ...p, reason: e.target.value }))
                    }
                    placeholder="Why this bonus? e.g. Worked during AQI 400+ conditions..."
                  />
                </div>
                <button
                  onClick={handleCreateBonus}
                  disabled={
                    activeAction === "bonus:create" ||
                    !bonusForm.workerId ||
                    !bonusForm.bonusType ||
                    !bonusForm.reason
                  }
                  className="w-full py-2.5 rounded-lg text-xs font-bold bg-purple-600 text-white disabled:opacity-50 hover:bg-purple-700 transition-all"
                >
                  {activeAction === "bonus:create"
                    ? "Creating..."
                    : "🏆 Create Bonus"}
                </button>
              </div>
            )}

            {/* Bonus Info Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              {BONUS_TYPES.slice(0, 4).map((bt) => (
                <div
                  key={bt.value}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center"
                >
                  <div className="text-xl mb-1">{bt.emoji}</div>
                  <div className="text-[10px] font-bold text-slate-700">
                    {bt.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Bonus List */}
            <div className="space-y-3">
              {bonuses.length === 0 ? (
                <div className="text-sm text-slate-500 text-center p-6 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="text-3xl mb-2">🏆</div>
                  No bonuses created yet. Use the form above to reward workers
                  for risk-taking.
                </div>
              ) : (
                bonuses.map((b: RiskBonus) => (
                  <div
                    key={b.id}
                    className="border border-slate-200 rounded-2xl p-4 bg-white"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-lg">
                            {BONUS_TYPES.find((bt) => bt.value === b.bonus_type)
                              ?.emoji || "🏆"}
                          </span>
                          <span className="text-sm font-bold text-slate-900">
                            {BONUS_TYPES.find((bt) => bt.value === b.bonus_type)
                              ?.label || b.bonus_type}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {b.worker_name} · {b.platform} · {b.city}
                        </div>
                        <div className="text-[11px] text-slate-600 mt-1">
                          {b.reason}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-lg font-black text-purple-600">
                          ₹{Number(b.amount).toLocaleString()}
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase ${statusColor(b.status)}`}
                        >
                          {b.status}
                        </span>
                      </div>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-2">
                      {ago(b.created_at)}
                      {b.risk_zone ? ` · Zone: ${b.risk_zone}` : ""}
                    </div>

                    {b.status === "pending" && (
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() =>
                            void handleBonusAction(b.id, "approve")
                          }
                          disabled={activeAction !== null}
                          className="flex-1 px-3 py-2 rounded-lg text-xs font-bold bg-emerald-600 text-white disabled:opacity-60 hover:bg-emerald-700"
                        >
                          ✓ Approve & Pay
                        </button>
                        <button
                          onClick={() => void handleBonusAction(b.id, "reject")}
                          disabled={activeAction !== null}
                          className="flex-1 px-3 py-2 rounded-lg text-xs font-bold bg-red-600 text-white disabled:opacity-60 hover:bg-red-700"
                        >
                          ✕ Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
