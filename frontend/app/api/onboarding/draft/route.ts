import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/backend/models/db";
import { consumeRateLimit, getClientIp } from "@/lib/server/rate-limit";

const FIELDS = ["name", "platform", "city", "zone", "customCity", "customZone", "avgWeeklyEarnings", "hoursPerDay", "daysWorkedThisWeek", "totalActiveDeliveryDays", "daysActiveInLast30", "consentGps", "consentPayout", "consentActivity", "wantInsurance"];
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== req.nextUrl.origin) return NextResponse.json({ error: "Invalid draft origin" }, { status: 403 });
  if (!consumeRateLimit(`draft:${getClientIp(req)}`, 120, 10 * 60 * 1000).allowed) return NextResponse.json({ error: "Too many draft requests" }, { status: 429 });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid draft" }, { status: 400 }); }
  if (typeof body.registrationProof !== "string" || body.registrationProof.length > 100) return NextResponse.json({ error: "Email-link grant required" }, { status: 401 });
  const id = createHash("sha256").update(body.registrationProof).digest("hex");
  const db = getDb();
  const proof = await db.prepare("SELECT expires_at FROM google_registration_proofs WHERE id = ? AND consumed = 0 AND email_link_verified = 1 AND expires_at > ?").get(id, Date.now());
  if (!proof) return NextResponse.json({ error: "Onboarding grant expired. Request a new email link." }, { status: 401 });
  if (body.action === "read") {
    const row = await db.prepare("SELECT draft_json FROM onboarding_drafts WHERE proof_id = ? AND expires_at > ?").get(id, Date.now());
    let draft = null;
    try { draft = row ? JSON.parse(row.draft_json) : null; } catch { /* Malformed drafts never supply values. */ }
    return NextResponse.json({ draft });
  }
  if (body.action !== "save" || !body.draft || typeof body.draft !== "object") return NextResponse.json({ error: "Unknown draft action" }, { status: 400 });
  const form: Record<string, string | boolean> = {};
  for (const key of FIELDS) {
    const value = body.draft.form?.[key];
    if (typeof value === "boolean") form[key] = value;
    else if (typeof value === "string" && value.length <= 120) form[key] = value;
  }
  const step = body.draft.step === "profile" ? "profile" : "persona";
  const draft = { form, step, selectedPersona: "food_delivery" };
  await db.prepare("DELETE FROM onboarding_drafts WHERE expires_at < ?").run(Date.now());
  await db.prepare("INSERT INTO onboarding_drafts (proof_id, draft_json, expires_at) VALUES (?, ?, ?) ON CONFLICT (proof_id) DO UPDATE SET draft_json = EXCLUDED.draft_json, expires_at = EXCLUDED.expires_at").run(id, JSON.stringify(draft), proof.expires_at);
  return NextResponse.json({ saved: true, expiresAt: proof.expires_at });
}
