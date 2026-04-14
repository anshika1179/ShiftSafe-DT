// GET /api/admin/service-requests — List all service requests for admin
// PATCH /api/admin/service-requests — Update status / add admin notes
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/backend/models/db";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-auth";

interface ServiceRequestAiMetadata {
  urgencyScore: number;
  suggestedPriority: "low" | "medium" | "high" | "urgent";
  sentimentLabel: "positive" | "neutral" | "negative" | "angry";
  categoryConfidence: number;
  autoAction: string | null;
  reasoning: string;
  generatedAt: string;
}

interface ServiceRequestRow {
  id: string;
  worker_id: string;
  category: string;
  subject: string;
  description: string;
  priority: string;
  status: string;
  admin_notes: string | null;
  created_at: string;
  ai_metadata: string | null;
  ai_model_version: string | null;
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

function isAdminAuthenticated(req: NextRequest): boolean {
  const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  return token ? verifyAdminSessionToken(token) : false;
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthenticated(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const statusFilter = req.nextUrl.searchParams.get("status") || "all";
  const db = getDb();

  const whereClause = statusFilter === "all" ? "" : "WHERE sr.status = ?";

  const rows = (await db
    .prepare(
      `SELECT sr.*, w.name as worker_name, w.phone as worker_phone, w.platform, w.city
       FROM service_requests sr
       JOIN workers w ON w.id = sr.worker_id
       ${whereClause}
       ORDER BY
         CASE sr.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         sr.created_at DESC
       LIMIT 100`,
    )
    .all(
      ...(statusFilter === "all" ? [] : [statusFilter]),
    )) as ServiceRequestRow[];

  const requests = rows.map((row) => ({
    ...row,
    ai: parseAiMetadata(row.ai_metadata),
  }));

  const summaryRows = (await db
    .prepare(
      `SELECT status, COUNT(*) as count
       FROM service_requests
       GROUP BY status`,
    )
    .all()) as Array<{ status: string; count: number }>;

  const summary = {
    open: 0,
    in_progress: 0,
    resolved: 0,
    closed: 0,
    total: 0,
    aiClassified: 0,
  };

  for (const row of summaryRows) {
    const s = String(row.status || "").toLowerCase();
    const count = Number(row.count || 0);
    if (s === "open") summary.open += count;
    else if (s === "in_progress") summary.in_progress += count;
    else if (s === "resolved") summary.resolved += count;
    else if (s === "closed") summary.closed += count;
    summary.total += count;
  }

  summary.aiClassified = requests.filter((row) => row.ai !== null).length;

  return NextResponse.json({ requests, summary });
}

export async function PATCH(req: NextRequest) {
  if (!isAdminAuthenticated(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { requestId, status, adminNotes } = body;

    const safeRequestId = String(requestId || "").trim();
    if (!safeRequestId) {
      return NextResponse.json(
        { error: "requestId is required" },
        { status: 400 },
      );
    }

    const validStatuses = ["open", "in_progress", "resolved", "closed"];
    const safeStatus = String(status || "")
      .trim()
      .toLowerCase();
    if (!validStatuses.includes(safeStatus)) {
      return NextResponse.json(
        { error: `Status must be one of: ${validStatuses.join(", ")}` },
        { status: 400 },
      );
    }

    const db = getDb();
    const existing = await db
      .prepare("SELECT id FROM service_requests WHERE id = ?")
      .get(safeRequestId);
    if (!existing) {
      return NextResponse.json(
        { error: "Service request not found" },
        { status: 404 },
      );
    }

    const safeNotes = adminNotes
      ? String(adminNotes).trim().slice(0, 1000)
      : null;
    const resolvedAt =
      safeStatus === "resolved" || safeStatus === "closed"
        ? new Date().toISOString()
        : null;

    await db
      .prepare(
        `UPDATE service_requests
         SET status = ?, admin_notes = COALESCE(?, admin_notes), resolved_at = COALESCE(?, resolved_at), updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(safeStatus, safeNotes, resolvedAt, safeRequestId);

    return NextResponse.json({
      success: true,
      requestId: safeRequestId,
      status: safeStatus,
      message: `Service request updated to ${safeStatus}`,
    });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }
}
