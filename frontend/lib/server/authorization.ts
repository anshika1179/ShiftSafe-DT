import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/backend/models/db";
import { WORKER_SESSION_COOKIE, parseWorkerSessionToken } from "@/lib/server/worker-auth";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "@/lib/server/admin-auth";

export async function authorizeWorker(req: NextRequest, requestedId?: unknown) {
  const token = req.cookies.get(WORKER_SESSION_COOKIE)?.value;
  const session = token ? parseWorkerSessionToken(token) : null;
  if (!session) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), workerId: null };
  if (requestedId !== undefined && requestedId !== null && String(requestedId).trim() && String(requestedId).trim() !== session.workerId) {
    return { response: NextResponse.json({ error: "Forbidden: worker mismatch" }, { status: 403 }), workerId: null };
  }
  const worker = await getDb().prepare("SELECT id, phone, is_active FROM workers WHERE id = ?").get(session.workerId);
  if (!worker || (!session.googleSubject && worker.phone !== session.phone) || !worker.is_active) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), workerId: null };
  if (session.googleSubject) {
    const identity = await getDb().prepare("SELECT subject FROM worker_identities WHERE worker_id = ? AND provider = ?").get(session.workerId, "google");
    if (identity?.subject !== session.googleSubject) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), workerId: null };
  }
  return { response: null, workerId: session.workerId };
}

export function authorizeAdmin(req: NextRequest): NextResponse | null {
  const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token || !verifyAdminSessionToken(token)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}
