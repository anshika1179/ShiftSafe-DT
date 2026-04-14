// GET /api/admin/bonuses — List all risk bonuses
// POST /api/admin/bonuses — Create a new risk bonus for a worker
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/backend/models/db";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-auth";

function isAdminAuthenticated(req: NextRequest): boolean {
  const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  return token ? verifyAdminSessionToken(token) : false;
}

const BONUS_TYPES = [
  "high_risk_zone",
  "extreme_weather",
  "monsoon_warrior",
  "heatwave_hero",
  "pollution_fighter",
  "loyalty_bonus",
  "zero_claim_bonus",
  "safety_bonus",
] as const;

export async function GET(req: NextRequest) {
  if (!isAdminAuthenticated(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();

  const bonuses = await db
    .prepare(
      `SELECT rb.*, w.name as worker_name, w.phone as worker_phone, w.platform, w.city, w.zone
       FROM risk_bonuses rb
       JOIN workers w ON w.id = rb.worker_id
       ORDER BY rb.created_at DESC
       LIMIT 100`,
    )
    .all();

  const totalPaid = (await db
    .prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM risk_bonuses WHERE status = 'paid'",
    )
    .get()) as { total: number };

  const totalPending = (await db
    .prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM risk_bonuses WHERE status = 'pending'",
    )
    .get()) as { total: number };

  const totalCount = (await db
    .prepare("SELECT COUNT(*) as cnt FROM risk_bonuses")
    .get()) as { cnt: number };

  return NextResponse.json({
    bonuses,
    summary: {
      totalPaid: totalPaid.total,
      totalPending: totalPending.total,
      count: Number(totalCount.cnt || 0),
    },
  });
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthenticated(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { workerId, bonusType, amount, reason, riskZone, riskTrigger } = body;

    const safeWorkerId = String(workerId || "").trim();
    const safeBonusType = String(bonusType || "")
      .trim()
      .toLowerCase();
    const safeAmount = Math.max(10, Math.min(5000, Number(amount) || 0));
    const safeReason = String(reason || "")
      .trim()
      .slice(0, 500);

    if (!safeWorkerId) {
      return NextResponse.json(
        { error: "workerId is required" },
        { status: 400 },
      );
    }

    if (!BONUS_TYPES.includes(safeBonusType as (typeof BONUS_TYPES)[number])) {
      return NextResponse.json(
        {
          error: `Invalid bonus type. Must be one of: ${BONUS_TYPES.join(", ")}`,
        },
        { status: 400 },
      );
    }

    if (!safeReason || safeReason.length < 5) {
      return NextResponse.json(
        { error: "Reason must be at least 5 characters" },
        { status: 400 },
      );
    }

    const db = getDb();

    // Verify worker exists
    const worker = (await db
      .prepare("SELECT id, name FROM workers WHERE id = ?")
      .get(safeWorkerId)) as { id: string; name: string } | undefined;
    if (!worker) {
      return NextResponse.json({ error: "Worker not found" }, { status: 404 });
    }

    const bonusId = crypto.randomUUID();

    await db
      .prepare(
        `INSERT INTO risk_bonuses (id, worker_id, bonus_type, amount, reason, risk_zone, risk_trigger, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        bonusId,
        safeWorkerId,
        safeBonusType,
        safeAmount,
        safeReason,
        riskZone ? String(riskZone).trim() : null,
        riskTrigger ? String(riskTrigger).trim() : null,
        "pending",
      );

    return NextResponse.json(
      {
        success: true,
        bonusId,
        workerName: worker.name,
        amount: safeAmount,
        message: `₹${safeAmount} ${safeBonusType.replace(/_/g, " ")} bonus created for ${worker.name}`,
      },
      { status: 201 },
    );
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  if (!isAdminAuthenticated(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { bonusId, action } = body;

    const safeBonusId = String(bonusId || "").trim();
    const safeAction = String(action || "")
      .trim()
      .toLowerCase();

    if (!safeBonusId || !["approve", "reject"].includes(safeAction)) {
      return NextResponse.json(
        { error: "bonusId and action (approve/reject) are required" },
        { status: 400 },
      );
    }

    const db = getDb();
    const bonus = (await db
      .prepare("SELECT id, status FROM risk_bonuses WHERE id = ?")
      .get(safeBonusId)) as { id: string; status: string } | undefined;

    if (!bonus) {
      return NextResponse.json({ error: "Bonus not found" }, { status: 404 });
    }

    if (bonus.status !== "pending") {
      return NextResponse.json(
        { error: "Only pending bonuses can be updated" },
        { status: 409 },
      );
    }

    const newStatus = safeAction === "approve" ? "paid" : "rejected";
    const paidAt = safeAction === "approve" ? new Date().toISOString() : null;

    await db
      .prepare(
        `UPDATE risk_bonuses SET status = ?, paid_at = COALESCE(?, paid_at) WHERE id = ?`,
      )
      .run(newStatus, paidAt, safeBonusId);

    return NextResponse.json({
      success: true,
      bonusId: safeBonusId,
      status: newStatus,
      message: `Bonus ${newStatus}`,
    });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }
}
