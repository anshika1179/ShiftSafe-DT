import { NextRequest, NextResponse } from "next/server";
import { EmailOnboardingError, redeemEmailOnboarding } from "@/lib/server/email-onboarding";
import { consumeRateLimit, getClientIp } from "@/lib/server/rate-limit";
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== req.nextUrl.origin) return NextResponse.json({ error: "Invalid email verification origin" }, { status: 403 });
  if (!consumeRateLimit(`email-redeem:${getClientIp(req)}`, 20, 10 * 60 * 1000).allowed) return NextResponse.json({ error: "Too many link checks. Try later." }, { status: 429 });
  try {
    const body = await req.json();
    return NextResponse.json(await redeemEmailOnboarding(String(body.nonce || "")), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof EmailOnboardingError ? error.message : "Email verification unavailable. Request a new link." }, { status: error instanceof EmailOnboardingError ? error.status : 503 });
  }
}
