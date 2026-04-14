// GET /api/service-requests?workerId=...  — List service requests for a worker
// POST /api/service-requests — Create a new service request
// PATCH /api/service-requests — Method disabled (use /api/admin/service-requests)
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/backend/models/db";
import {
  WORKER_SESSION_COOKIE,
  parseWorkerSessionToken,
} from "@/lib/server/worker-auth";
import {
  consumeRateLimit,
  getClientIp,
  retryAfterSeconds,
} from "@/lib/server/rate-limit";

const VALID_CATEGORIES = [
  "claim_dispute",
  "payout_issue",
  "policy_correction",
  "account_update",
  "technical_issue",
  "general_inquiry",
] as const;

const VALID_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

interface ServiceRequestRow {
  id: string;
  worker_id: string;
  category: string;
  subject: string;
  description: string;
  priority: string;
  status: string;
  related_claim_id: string | null;
  related_policy_id: string | null;
  ai_metadata: string | null;
  ai_model_version: string | null;
  admin_notes: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ServiceRequestAiMetadata {
  urgencyScore: number;
  suggestedPriority: "low" | "medium" | "high" | "urgent";
  sentimentLabel: "positive" | "neutral" | "negative" | "angry";
  categoryConfidence: number;
  autoAction: string | null;
  reasoning: string;
  generatedAt: string;
}

function parseAiMetadata(raw: string | null): ServiceRequestAiMetadata | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const data = parsed as Partial<ServiceRequestAiMetadata>;
    if (typeof data.urgencyScore !== "number") return null;
    if (typeof data.suggestedPriority !== "string") return null;
    if (typeof data.sentimentLabel !== "string") return null;
    if (typeof data.categoryConfidence !== "number") return null;
    if (typeof data.reasoning !== "string") return null;

    return {
      urgencyScore: data.urgencyScore,
      suggestedPriority:
        data.suggestedPriority as ServiceRequestAiMetadata["suggestedPriority"],
      sentimentLabel:
        data.sentimentLabel as ServiceRequestAiMetadata["sentimentLabel"],
      categoryConfidence: data.categoryConfidence,
      autoAction:
        typeof data.autoAction === "string" || data.autoAction === null
          ? data.autoAction
          : null,
      reasoning: data.reasoning,
      generatedAt:
        typeof data.generatedAt === "string"
          ? data.generatedAt
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function getWorkerIdFromCookie(req: NextRequest): string | null {
  const token = req.cookies.get(WORKER_SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = parseWorkerSessionToken(token);
  return session?.workerId ?? null;
}

export async function GET(req: NextRequest) {
  const sessionWorkerId = getWorkerIdFromCookie(req);
  if (!sessionWorkerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requestedWorkerId = String(
    req.nextUrl.searchParams.get("workerId") || "",
  ).trim();
  if (requestedWorkerId && requestedWorkerId !== sessionWorkerId) {
    return NextResponse.json(
      { error: "Forbidden: worker mismatch" },
      { status: 403 },
    );
  }

  const workerId = sessionWorkerId;

  const db = getDb();
  const rows = (await db
    .prepare(
      "SELECT * FROM service_requests WHERE worker_id = ? ORDER BY created_at DESC LIMIT 50",
    )
    .all(workerId)) as ServiceRequestRow[];

  const requests = rows.map((row) => ({
    ...row,
    ai: parseAiMetadata(row.ai_metadata),
  }));

  // Summary counts
  const open = rows.filter(
    (r) => r.status === "open" || r.status === "in_progress",
  ).length;
  const resolved = rows.filter(
    (r) => r.status === "resolved" || r.status === "closed",
  ).length;
  const aiClassified = requests.filter((r) => r.ai !== null).length;

  return NextResponse.json({
    requests,
    summary: { total: rows.length, open, resolved, aiClassified },
  });
}

export async function POST(req: NextRequest) {
  try {
    const sessionWorkerId = getWorkerIdFromCookie(req);
    if (!sessionWorkerId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ip = getClientIp(req);
    const routeRate = consumeRateLimit(`service_req:${ip}`, 20, 15 * 60 * 1000);
    if (!routeRate.allowed) {
      return NextResponse.json(
        {
          error: "Too many requests. Please try again later.",
          retryAfterSeconds: retryAfterSeconds(routeRate.resetAt),
        },
        { status: 429 },
      );
    }

    const body = await req.json();
    const {
      workerId,
      category,
      subject,
      description,
      priority,
      relatedClaimId,
      relatedPolicyId,
    } = body;

    // Validate required fields
    const requestedWorkerId = String(workerId || "").trim();
    if (requestedWorkerId && requestedWorkerId !== sessionWorkerId) {
      return NextResponse.json(
        { error: "Forbidden: worker mismatch" },
        { status: 403 },
      );
    }

    const safeWorkerId = sessionWorkerId;
    const safeCategory = String(category || "")
      .trim()
      .toLowerCase();
    const safeSubject = String(subject || "")
      .trim()
      .slice(0, 200);
    const safeDescription = String(description || "")
      .trim()
      .slice(0, 2000);
    const safePriority = String(priority || "medium")
      .trim()
      .toLowerCase();

    if (
      !VALID_CATEGORIES.includes(
        safeCategory as (typeof VALID_CATEGORIES)[number],
      )
    ) {
      return NextResponse.json(
        {
          error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`,
        },
        { status: 400 },
      );
    }

    if (safeSubject.length < 5) {
      return NextResponse.json(
        { error: "Subject must be at least 5 characters" },
        { status: 400 },
      );
    }

    if (safeDescription.length < 10) {
      return NextResponse.json(
        { error: "Description must be at least 10 characters" },
        { status: 400 },
      );
    }

    if (
      !VALID_PRIORITIES.includes(
        safePriority as (typeof VALID_PRIORITIES)[number],
      )
    ) {
      return NextResponse.json(
        { error: "Priority must be low, medium, high, or urgent" },
        { status: 400 },
      );
    }

    const db = getDb();

    // Verify worker exists
    const worker = await db
      .prepare("SELECT id FROM workers WHERE id = ?")
      .get(safeWorkerId);
    if (!worker) {
      return NextResponse.json({ error: "Worker not found" }, { status: 404 });
    }

    // Rate-limit per worker: max 5 open requests at a time
    const openCount = (
      (await db
        .prepare(
          "SELECT COUNT(*) as cnt FROM service_requests WHERE worker_id = ? AND status IN ('open', 'in_progress')",
        )
        .get(safeWorkerId)) as { cnt: number }
    ).cnt;

    if (openCount >= 5) {
      return NextResponse.json(
        {
          error:
            "You have too many open requests. Please wait for existing ones to be resolved.",
        },
        { status: 422 },
      );
    }

    const requestId = crypto.randomUUID();
    const safeClaimId = relatedClaimId ? String(relatedClaimId).trim() : null;
    const safePolicyId = relatedPolicyId
      ? String(relatedPolicyId).trim()
      : null;

    // AI-powered classification: urgency scoring + sentiment + auto-action
    let aiClassification = null;
    try {
      const { classifyServiceRequest } =
        await import("@/backend/engines/fraud-engine");
      const blockedClaims = (
        (await db
          .prepare(
            "SELECT COUNT(*) as cnt FROM claims WHERE worker_id = ? AND status = 'blocked'",
          )
          .get(safeWorkerId)) as { cnt: number }
      ).cnt;

      aiClassification = classifyServiceRequest(
        safeSubject,
        safeDescription,
        safeCategory,
        blockedClaims,
      );
    } catch {
      // AI classifier failed — proceed without it
    }

    // Use AI-suggested priority if it's higher than user-selected
    const PRIORITY_RANK: Record<string, number> = {
      low: 0,
      medium: 1,
      high: 2,
      urgent: 3,
    };
    const finalPriority =
      aiClassification &&
      (PRIORITY_RANK[aiClassification.suggestedPriority] ?? 0) >
        (PRIORITY_RANK[safePriority] ?? 0)
        ? aiClassification.suggestedPriority
        : safePriority;

    const aiModelVersion = aiClassification ? "NLP-KW-v1.2" : null;
    const aiMetadata = aiClassification
      ? JSON.stringify({
          urgencyScore: aiClassification.urgencyScore,
          suggestedPriority: aiClassification.suggestedPriority,
          sentimentLabel: aiClassification.sentimentLabel,
          categoryConfidence: aiClassification.categoryConfidence,
          autoAction: aiClassification.autoAction,
          reasoning: aiClassification.reasoning,
          generatedAt: new Date().toISOString(),
        })
      : null;

    await db
      .prepare(
        `INSERT INTO service_requests (id, worker_id, category, subject, description, priority, status, related_claim_id, related_policy_id, ai_metadata, ai_model_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        requestId,
        safeWorkerId,
        safeCategory,
        safeSubject,
        safeDescription,
        finalPriority,
        "open",
        safeClaimId,
        safePolicyId,
        aiMetadata,
        aiModelVersion,
      );

    return NextResponse.json(
      {
        success: true,
        requestId,
        status: "open",
        priority: finalPriority,
        aiClassification: aiClassification
          ? {
              urgencyScore: aiClassification.urgencyScore,
              suggestedPriority: aiClassification.suggestedPriority,
              sentimentLabel: aiClassification.sentimentLabel,
              categoryConfidence: aiClassification.categoryConfidence,
              autoAction: aiClassification.autoAction,
              reasoning: aiClassification.reasoning,
            }
          : null,
        aiModelVersion,
        message:
          "Service request submitted successfully. Our team will review it shortly.",
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("Service request creation error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PATCH() {
  return NextResponse.json(
    { error: "Use /api/admin/service-requests for admin updates" },
    { status: 405 },
  );
}
