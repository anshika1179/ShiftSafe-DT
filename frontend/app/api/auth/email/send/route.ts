import { NextRequest, NextResponse } from "next/server";
import { verifyGoogleIdentity } from "@/lib/server/google-auth";
import { EmailOnboardingError, startEmailOnboarding } from "@/lib/server/email-onboarding";
import { consumeRateLimit, getClientIp } from "@/lib/server/rate-limit";
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== req.nextUrl.origin) return NextResponse.json({ error: "Invalid email verification origin" }, { status: 403 });
  if (!consumeRateLimit(`email-send:${getClientIp(req)}`, 10, 60 * 60 * 1000).allowed) return NextResponse.json({ error: "Too many link requests. Try later." }, { status: 429 });
  try {
    const body = await req.json();
    let identity;
    try { identity = await verifyGoogleIdentity(body.idToken); }
    catch { return NextResponse.json({ error: "Google sign-in expired. Sign in again." }, { status: 401 }); }
    return NextResponse.json(await startEmailOnboarding(identity, body.idToken, String(body.email || ""), String(body.phone || ""), req.nextUrl.origin));
  } catch (error) {
    return NextResponse.json({ error: error instanceof EmailOnboardingError ? error.message : "Email verification unavailable." }, { status: error instanceof EmailOnboardingError ? error.status : 503 });
  }
}
