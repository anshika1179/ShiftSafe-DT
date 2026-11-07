import { authorizeWorker } from "@/lib/server/authorization";
// GET /api/claims?workerId=...  — Get claims for a worker
// POST is disabled until authoritative event ingestion is available.
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/backend/models/db";
interface ClaimRow {
  id: string;
  policy_id: string;
  worker_id: string;
  trigger_type: string;
  trigger_description: string;
  amount: number;
  status: string;
  zone: string;
  payout_method: string;
  payout_channel: string;
  settlement_status: string;
  created_at: string;
  processed_at: string | null;
}

export async function GET(req: NextRequest) {
  const workerId = req.nextUrl.searchParams.get("workerId");
  if (!workerId) {
    return NextResponse.json(
      { error: "workerId query parameter is required" },
      { status: 400 },
    );
  }

  const auth = await authorizeWorker(req, workerId);
  if (auth.response) return auth.response;
  const db = getDb();
  const rows = (await db
    .prepare(
      "SELECT * FROM claims WHERE worker_id = ? ORDER BY created_at DESC",
    )
    .all(workerId)) as ClaimRow[];

  return NextResponse.json({ claims: rows });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const auth = await authorizeWorker(req, body?.workerId);
    if (auth.response) return auth.response;
    return NextResponse.json({ error: "Client-supplied trigger claims are disabled. Verified event ingestion is not configured." }, { status: 503 });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
