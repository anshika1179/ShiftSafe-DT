import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/backend/models/db";
import { resolvePhoneOwner } from "@/lib/server/phone-owner";
import { PhoneVerificationError, checkPhoneVerification, consumeContactPhoneProof } from "@/lib/server/phone-verification";
import { normalizePhone } from "@/lib/server/otp";
import { consumeRateLimit, getClientIp } from "@/lib/server/rate-limit";
export async function POST(req: NextRequest) {
  try {
    if (!consumeRateLimit(`contact_check:${getClientIp(req)}`, 20, 10 * 60 * 1000).allowed) throw new PhoneVerificationError("Too many verification attempts", 429);
    const body = await req.json();
    const owner = await resolvePhoneOwner(req, body.registrationProof);
    const result = await checkPhoneVerification(owner.key, String(body.challenge || ""), body.phone, String(body.code || ""));
    if (owner.workerId) {
      const phone = normalizePhone(body.phone);
      if (!await consumeContactPhoneProof(owner.key, phone, result.phoneProof)) throw new PhoneVerificationError("Verification already used", 401);
      await getDb().prepare("INSERT INTO worker_contacts (worker_id, phone, phone_verified) VALUES (?, ?, 1) ON CONFLICT (worker_id) DO UPDATE SET phone = excluded.phone, phone_verified = 1").run(owner.workerId, phone);
      return NextResponse.json({ phoneVerified: true, mode: "twilio_trial" });
    }
    return NextResponse.json(result);
  } catch (error) { return NextResponse.json({ error: error instanceof PhoneVerificationError ? error.message : "Phone verification is unavailable." }, { status: error instanceof PhoneVerificationError ? error.status : 503 }); }
}
