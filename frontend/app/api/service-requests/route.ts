// GET /api/service-requests?workerId=...  — List service requests for a worker
// POST /api/service-requests — Create a new service request
// PATCH /api/service-requests — Method disabled (use /api/admin/service-requests)
import { NextRequest, NextResponse } from "next/server";
import { authorizeWorker } from "@/lib/server/authorization";
import { getDb } from "@/backend/models/db";
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




export async function GET(req: NextRequest) {
  const auth = await authorizeWorker(req);
  if (auth.response) return auth.response;
  const sessionWorkerId = auth.workerId;
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
    ai_metadata: null,
    ai_model_version: null,
    ai: null,
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
    const auth = await authorizeWorker(req);
  if (auth.response) return auth.response;
  const sessionWorkerId = auth.workerId;
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

    // Preserve user's priority. No unvalidated NLP output is presented as trained AI.
    const finalPriority = safePriority;
    const aiModelVersion = null;
    const aiMetadata = null;

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
        aiClassification: null,
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
