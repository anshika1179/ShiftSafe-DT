import { NextRequest, NextResponse } from "next/server";
import { verifyGoogleIdentity } from "@/lib/server/google-auth";
import { finishGoogleSignIn } from "@/lib/server/google-onboarding";
import { getWorkerSessionSecret } from "@/lib/server/env";
import { WORKER_SESSION_COOKIE } from "@/lib/server/worker-auth";
import { consumeRateLimit, getClientIp } from "@/lib/server/rate-limit";
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== req.nextUrl.origin) return NextResponse.json({ error: "Invalid sign-in origin" }, { status: 403 });
  if (!consumeRateLimit(`google:${getClientIp(req)}`, 15, 10 * 60 * 1000).allowed) return NextResponse.json({ error: "Too many sign-in attempts" }, { status: 429 });
  try { getWorkerSessionSecret(); if (!process.env.FIREBASE_PROJECT_ID) throw new Error(); }
  catch { return NextResponse.json({ error: "Google sign-in is not configured" }, { status: 503 }); }
  let identity;
  try { identity = await verifyGoogleIdentity((await req.json()).idToken); }
  catch { return NextResponse.json({ error: "Unable to verify Google sign-in" }, { status: 401 }); }
  try {
    const result = await finishGoogleSignIn(identity);
    if (result.registered) {
      const response = NextResponse.json({ registered: true });
      response.cookies.set(WORKER_SESSION_COOKIE, result.token, { httpOnly: true, secure: req.nextUrl.protocol === "https:", sameSite: "strict", path: "/", maxAge: 7 * 24 * 60 * 60 });
      return response;
    }
    return NextResponse.json(result);
  } catch { return NextResponse.json({ error: "Sign-in is unavailable. Check database setup or account status." }, { status: 503 }); }
}
