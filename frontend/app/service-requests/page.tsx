"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAppState } from "@/frontend/components/providers/AppProvider";
import { triggerToast } from "@/frontend/components/ui/Notifications";

const CATEGORIES = [
  {
    value: "claim_dispute",
    label: "Claim Dispute",
    emoji: "⚖️",
    desc: "Dispute a rejected or blocked claim",
  },
  {
    value: "payout_issue",
    label: "Payout Issue",
    emoji: "💸",
    desc: "Payment not received or incorrect amount",
  },
  {
    value: "policy_correction",
    label: "Policy Correction",
    emoji: "📋",
    desc: "Update policy details or coverage",
  },
  {
    value: "account_update",
    label: "Account Update",
    emoji: "👤",
    desc: "Change phone, UPI ID, or zone info",
  },
  {
    value: "technical_issue",
    label: "Technical Issue",
    emoji: "🔧",
    desc: "App bugs, trigger errors, or system problems",
  },
  {
    value: "general_inquiry",
    label: "General Inquiry",
    emoji: "💬",
    desc: "Questions about coverage or platform",
  },
];

const PRIORITIES = [
  {
    value: "low",
    label: "Low",
    color: "bg-slate-100 text-slate-600 border-slate-200",
  },
  {
    value: "medium",
    label: "Medium",
    color: "bg-blue-50 text-blue-600 border-blue-200",
  },
  {
    value: "high",
    label: "High",
    color: "bg-orange-50 text-orange-600 border-orange-200",
  },
  {
    value: "urgent",
    label: "Urgent",
    color: "bg-red-50 text-red-600 border-red-200",
  },
];

interface ServiceRequest {
  id: string;
  worker_id: string;
  category: string;
  subject: string;
  description: string;
  priority: string;
  status: string;
  related_claim_id: string | null;
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
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "open":
      return "bg-blue-50 text-blue-600 border border-blue-200";
    case "in_progress":
      return "bg-orange-50 text-orange-600 border border-orange-200";
    case "resolved":
      return "bg-emerald-50 text-emerald-600 border border-emerald-200";
    case "closed":
      return "bg-slate-100 text-slate-500 border border-slate-200";
    default:
      return "bg-slate-100 text-slate-500 border border-slate-200";
  }
}

function getCategoryEmoji(category: string): string {
  return CATEGORIES.find((c) => c.value === category)?.emoji || "📋";
}

function getCategoryLabel(category: string): string {
  return (
    CATEGORIES.find((c) => c.value === category)?.label ||
    category.replace(/_/g, " ")
  );
}

function getRelativeTime(timestamp: string): string {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(diffMs / (60 * 1000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function ServiceRequestsPage() {
  const router = useRouter();
  const { worker, claims, policy, isLoggedIn, isBootstrapping } = useAppState();
  const [view, setView] = useState<"list" | "new">("list");
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [summary, setSummary] = useState({
    total: 0,
    open: 0,
    resolved: 0,
    aiClassified: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // New request form state
  const [category, setCategory] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [relatedClaimId, setRelatedClaimId] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!isBootstrapping && !isLoggedIn) router.replace("/");
  }, [isBootstrapping, isLoggedIn, router]);

  const loadRequests = useCallback(async () => {
    if (!worker?.id) return;
    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/service-requests?workerId=${encodeURIComponent(worker.id)}`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const data = await res.json();
        setRequests(data.requests || []);
        setSummary(
          data.summary || { total: 0, open: 0, resolved: 0, aiClassified: 0 },
        );
      }
    } catch {
      // Silently handle — user can retry.
    } finally {
      setIsLoading(false);
    }
  }, [worker?.id]);

  useEffect(() => {
    if (isLoggedIn && worker?.id) {
      void loadRequests();
    }
  }, [isLoggedIn, worker?.id, loadRequests]);

  if (isBootstrapping) return null;

  const handleSubmit = async () => {
    setFormError("");

    if (!category) {
      setFormError("Please select a category");
      return;
    }
    if (subject.trim().length < 5) {
      setFormError("Subject must be at least 5 characters");
      return;
    }
    if (description.trim().length < 10) {
      setFormError(
        "Please provide a detailed description (at least 10 characters)",
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/service-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workerId: worker?.id,
          category,
          subject: subject.trim(),
          description: description.trim(),
          priority,
          relatedClaimId: relatedClaimId || undefined,
          relatedPolicyId: policy?.id || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data?.error || "Unable to submit request.");
        return;
      }

      const aiMessage = data?.aiClassification
        ? ` AI triage set priority to ${String(data.priority || priority).toUpperCase()}.`
        : "";
      triggerToast(
        `Service request submitted successfully! ✓${aiMessage}`,
        "success",
      );

      // Reset form
      setCategory("");
      setSubject("");
      setDescription("");
      setPriority("medium");
      setRelatedClaimId("");
      setView("list");
      await loadRequests();
    } catch {
      setFormError("Unable to submit request right now. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const blockedClaims = claims.filter((c) => c.status === "blocked");
  const reviewClaims = claims.filter((c) => c.status === "review");

  return (
    <div className="space-y-5 max-w-120 mx-auto fade-in pb-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Service Requests
          </h1>
          <p className="text-sm text-gray-500">
            Disputes, corrections & support
          </p>
        </div>
        <button
          onClick={() => setView(view === "list" ? "new" : "list")}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            view === "new"
              ? "bg-slate-100 text-slate-600 border border-slate-200"
              : "btn btn-primary"
          }`}
        >
          {view === "new" ? "← Back" : "+ New Request"}
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="glass-card p-4 text-center">
          <div className="text-xl font-bold text-slate-900">
            {summary.total}
          </div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mt-1">
            Total
          </div>
        </div>
        <div className="glass-card p-4 text-center">
          <div className="text-xl font-bold text-blue-500">{summary.open}</div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mt-1">
            Open
          </div>
        </div>
        <div className="glass-card p-4 text-center">
          <div className="text-xl font-bold text-emerald-500">
            {summary.resolved}
          </div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mt-1">
            Resolved
          </div>
        </div>
        <div className="glass-card p-4 text-center">
          <div className="text-xl font-bold text-indigo-500">
            {summary.aiClassified}
          </div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mt-1">
            AI Triaged
          </div>
        </div>
      </div>

      {/* NEW REQUEST FORM */}
      {view === "new" && (
        <div className="space-y-4">
          {/* Category Selection */}
          <div>
            <label className="block text-[11px] font-bold tracking-widest text-gray-500 uppercase mb-2">
              What do you need help with?
            </label>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  onClick={() => setCategory(cat.value)}
                  className={`glass-card p-3 text-left transition-all ${
                    category === cat.value
                      ? "border-primary-500 bg-primary-50/50 shadow-sm"
                      : "hover:-translate-y-0.5"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{cat.emoji}</span>
                    <span className="text-xs font-bold text-slate-900">
                      {cat.label}
                    </span>
                  </div>
                  <div className="text-[10px] text-gray-500">{cat.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Subject */}
          <div>
            <label className="block text-[11px] font-bold tracking-widest text-gray-500 uppercase mb-1.5">
              Subject
            </label>
            <input
              className="input-field"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief summary of your issue"
              maxLength={200}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-[11px] font-bold tracking-widest text-gray-500 uppercase mb-1.5">
              Description
            </label>
            <textarea
              className="input-field min-h-[120px] resize-y"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your issue in detail. Include dates, amounts, and any relevant information..."
              maxLength={2000}
            />
            <div className="text-[10px] text-gray-400 mt-1 text-right">
              {description.length}/2000
            </div>
          </div>

          {/* Priority */}
          <div>
            <label className="block text-[11px] font-bold tracking-widest text-gray-500 uppercase mb-1.5">
              Priority
            </label>
            <div className="flex gap-2">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPriority(p.value)}
                  className={`flex-1 py-2 text-[11px] font-bold rounded-lg border transition-all ${
                    priority === p.value
                      ? p.color
                      : "bg-white border-slate-200 text-slate-400"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Related Claim (for disputes) */}
          {(category === "claim_dispute" || category === "payout_issue") &&
            (blockedClaims.length > 0 || reviewClaims.length > 0) && (
              <div>
                <label className="block text-[11px] font-bold tracking-widest text-gray-500 uppercase mb-1.5">
                  Related Claim (optional)
                </label>
                <select
                  className="select-field"
                  value={relatedClaimId}
                  onChange={(e) => setRelatedClaimId(e.target.value)}
                >
                  <option value="">Select a claim...</option>
                  {[...blockedClaims, ...reviewClaims].map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.triggerName} — ₹{c.amount} — {c.status.toUpperCase()} —{" "}
                      {c.relativeTime}
                    </option>
                  ))}
                </select>
              </div>
            )}

          {/* Error */}
          {formError && (
            <div className="text-xs text-red-500 font-medium bg-red-50 border border-red-200 rounded-lg p-3">
              {formError}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !category || subject.trim().length < 5}
            className="btn btn-primary w-full text-sm font-bold py-3.5 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Submitting..." : "Submit Service Request →"}
          </button>
        </div>
      )}

      {/* REQUEST LIST */}
      {view === "list" && (
        <div>
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3 px-1">
            Your Requests
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="glass-card p-4 animate-pulse">
                  <div className="h-4 bg-slate-100 rounded w-3/4 mb-2" />
                  <div className="h-3 bg-slate-100 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : requests.length === 0 ? (
            <div className="glass-card p-8 text-center">
              <div className="text-4xl mb-3">📋</div>
              <div className="text-sm font-semibold text-slate-700 mb-1">
                No service requests yet
              </div>
              <div className="text-xs text-gray-500 mb-4">
                Need help with a claim dispute, payout issue, or policy change?
              </div>
              <button
                onClick={() => setView("new")}
                className="btn btn-primary text-xs px-5 py-2 rounded-lg"
              >
                Create Your First Request
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {requests.map((req) => (
                <div
                  key={req.id}
                  className="glass-card p-4 relative overflow-hidden"
                >
                  {/* Status accent strip */}
                  <div
                    className={`absolute left-0 top-0 bottom-0 w-1 ${
                      req.status === "open"
                        ? "bg-blue-500"
                        : req.status === "in_progress"
                          ? "bg-orange-500"
                          : req.status === "resolved"
                            ? "bg-emerald-500"
                            : "bg-slate-300"
                    }`}
                  />

                  {/* Header */}
                  <div className="flex items-start gap-3 mb-2 pl-2">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg bg-slate-50 border border-slate-100 shrink-0">
                      {getCategoryEmoji(req.category)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-bold text-slate-900 truncate">
                          {req.subject}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider shrink-0 ${getStatusBadge(req.status)}`}
                        >
                          {req.status.replace(/_/g, " ")}
                        </span>
                      </div>
                      <div className="text-[11px] text-gray-500 flex items-center gap-2">
                        <span>{getCategoryLabel(req.category)}</span>
                        <span className="text-slate-300">•</span>
                        <span>{getRelativeTime(req.created_at)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Description preview */}
                  <div className="pl-2 text-[11px] text-gray-600 line-clamp-2 mb-2">
                    {req.description}
                  </div>

                  {req.ai && (
                    <div className="pl-2 mb-2 rounded-lg border border-indigo-200 bg-indigo-50/70 p-2">
                      <div className="flex flex-wrap items-center gap-1.5 text-[9px]">
                        <span className="px-2 py-0.5 rounded-full border border-indigo-200 bg-indigo-100 text-indigo-700 font-bold">
                          urgency {req.ai.urgencyScore}/100
                        </span>
                        <span className="px-2 py-0.5 rounded-full border border-indigo-200 bg-indigo-100 text-indigo-700 font-bold capitalize">
                          {req.ai.sentimentLabel}
                        </span>
                        <span className="px-2 py-0.5 rounded-full border border-indigo-200 bg-indigo-100 text-indigo-700 font-bold">
                          confidence{" "}
                          {Math.round(req.ai.categoryConfidence * 100)}%
                        </span>
                        <span className="px-2 py-0.5 rounded-full border border-indigo-200 bg-indigo-100 text-indigo-700 font-bold uppercase">
                          {req.ai_model_version || "NLP-KW-v1.2"}
                        </span>
                      </div>
                      {req.ai.autoAction && (
                        <div className="mt-1 text-[10px] text-indigo-700">
                          Suggested action: {req.ai.autoAction}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Priority + metadata */}
                  <div className="pl-2 flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase border ${
                        PRIORITIES.find((p) => p.value === req.priority)
                          ?.color ||
                        "bg-slate-100 text-slate-500 border-slate-200"
                      }`}
                    >
                      {req.priority}
                    </span>
                    {req.related_claim_id && (
                      <span className="text-[9px] text-gray-400 font-mono">
                        Claim: {req.related_claim_id.slice(0, 8)}…
                      </span>
                    )}
                  </div>

                  {/* Admin response */}
                  {req.admin_notes && (
                    <div className="mt-3 pl-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                      <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider mb-1">
                        Admin Response
                      </div>
                      <div className="text-[11px] text-emerald-800">
                        {req.admin_notes}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Workflow info */}
      <div className="glass-card p-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-600 mb-3">
          How Service Requests Work
        </h3>
        <div className="grid grid-cols-3 gap-2 text-[11px]">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="font-bold text-slate-800">1. Submit</div>
            <div className="text-slate-500 mt-1">
              File a request with details and priority level.
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="font-bold text-slate-800">2. Review</div>
            <div className="text-slate-500 mt-1">
              Admin reviews and investigates your case.
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="font-bold text-slate-800">3. Resolved</div>
            <div className="text-slate-500 mt-1">
              Action taken with full transparency.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
