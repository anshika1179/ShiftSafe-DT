import { NextRequest, NextResponse } from "next/server";
import { resolvePhoneOwner } from "@/lib/server/phone-owner";
import { PhoneVerificationError, startPhoneVerification } from "@/lib/server/phone-verification";
import { consumeRateLimit, getClientIp } from "@/lib/server/rate-limit";
export async function POST(req: NextRequest) {
  try {
    if (!consumeRateLimit(`contact_send:${getClientIp(req)}`, 5, 10 * 60 * 1000).allowed) throw new PhoneVerificationError("Too many verification requests", 429);
    const body = await req.json();
    const owner = await resolvePhoneOwner(req, body.registrationProof);
    return NextResponse.json(await startPhoneVerification(owner.key, body.phone));
  } catch (error) { return NextResponse.json({ error: error instanceof PhoneVerificationError ? error.message : "Phone verification is unavailable. No delivery confirmed." }, { status: error instanceof PhoneVerificationError ? error.status : 503 }); }
}
