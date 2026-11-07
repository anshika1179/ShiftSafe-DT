// GET /api/admin/service-requests — List all service requests for admin
// PATCH /api/admin/service-requests — Update status / add admin notes
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getAdminEmail } from "@/lib/server/env";
import { getDb } from "@/backend/models/db";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-auth";



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


function isAdminAuthenticated(req: NextRequest): boolean {
  const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  return token ? verifyAdminSessionToken(token) : false;
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthenticated(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const statusFilter = req.nextUrl.searchParams.get("status") || "all";
  if (!["all", "open", "in_progress", "resolved", "closed"].includes(statusFilter)) return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
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
    ai_metadata: null,
    ai_model_version: null,
    ai: null,
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

  const matchedTotal = statusFilter === "all" ? summary.total : Number(summary[statusFilter as "open" | "in_progress" | "resolved" | "closed"]);
  return NextResponse.json({ requests, summary, matchedTotal, limit: 100 }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: NextRequest) {
  if (!isAdminAuthenticated(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (req.headers.get("origin") !== req.nextUrl.origin) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  try {
    const { requestId, status, adminNotes, expectedUpdatedAt, expectedRevision } = body;

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
      .prepare("SELECT id, status, admin_notes, resolved_at, updated_at, last_change_id FROM service_requests WHERE id = ?")
      .get(safeRequestId);
    if (!existing) {
      return NextResponse.json(
        { error: "Service request not found" },
        { status: 404 },
      );
    }

    if (adminNotes !== undefined && (typeof adminNotes !== "string" || adminNotes.length > 1000)) return NextResponse.json({ error: "Notes must be text up to 1000 characters" }, { status: 400 });
    if (expectedUpdatedAt !== undefined && typeof expectedUpdatedAt !== "string") return NextResponse.json({ error: "Invalid revision" }, { status: 400 });
    if (expectedRevision !== undefined && typeof expectedRevision !== "string") return NextResponse.json({ error: "Invalid revision" }, { status: 400 });
    if ((expectedUpdatedAt !== undefined && expectedUpdatedAt !== existing.updated_at) || (expectedRevision !== undefined && expectedRevision !== existing.last_change_id)) return NextResponse.json({ error: "This request changed. Reload before saving." }, { status: 409 });
    const safeNotes = adminNotes === undefined ? existing.admin_notes : adminNotes.trim();
    if (safeStatus === existing.status && (safeNotes || "") === (existing.admin_notes || "")) return NextResponse.json({ success: true, requestId: safeRequestId, status: safeStatus, unchanged: true });
    const changeId = randomUUID(), changedAt = new Date().toISOString();
    const resolvedAt = safeStatus === "resolved" || safeStatus === "closed" ? changedAt : null;
    // UPDATE holds the row lock until this transaction commits. INSERT SELECT is
    // conditional on our unique change token, so a stale update creates no event.
    // A failed history write rolls back the ticket update as well.
    await db.batch([
      { query: `UPDATE service_requests SET status = ?, admin_notes = ?,
          resolved_at = CASE WHEN ? IN ('resolved', 'closed') THEN COALESCE(resolved_at, ?) ELSE NULL END,
          updated_at = ?, last_change_id = ?, history_revision = history_revision + 1 WHERE id = ? AND updated_at = ? AND last_change_id = ?`,
        params: [safeStatus, safeNotes, safeStatus, resolvedAt, changedAt, changeId, safeRequestId, existing.updated_at, existing.last_change_id] },
      { query: `INSERT INTO service_request_history (id, request_id, actor_email, revision, old_status, new_status, old_notes, new_notes, changed_at)
          SELECT ?, id, ?, history_revision, ?, status, ?, admin_notes, ? FROM service_requests WHERE id = ? AND last_change_id = ?`,
        params: [changeId, getAdminEmail(), existing.status, existing.admin_notes, changedAt, safeRequestId, changeId] },
    ]);
    if (!await db.prepare("SELECT id FROM service_request_history WHERE id = ?").get(changeId)) return NextResponse.json({ error: "This request changed. Reload before saving." }, { status: 409 });

    return NextResponse.json({
      success: true,
      requestId: safeRequestId,
      status: safeStatus,
      message: `Service request updated to ${safeStatus}`,
    });
  } catch {
    return NextResponse.json(
      { error: "Could not update request. Reload to check its current state." },
      { status: 500 },
    );
  }
}
