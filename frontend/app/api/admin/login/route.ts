import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  createAdminSessionToken,
  verifyAdminCredentials,
} from "@/lib/server/admin-auth";
import { isProduction } from "@/lib/server/env";
import {
  consumeRateLimit,
  getClientIp,
  retryAfterSeconds,
} from "@/lib/server/rate-limit";

function shouldUseSecureCookie(req: NextRequest): boolean {
  const host = req.nextUrl.hostname;
  const isLocalhost = host === "localhost" || host === "127.0.0.1";
  const forwardedProto = req.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    ?.toLowerCase();
  const isHttps =
    req.nextUrl.protocol === "https:" || forwardedProto === "https";

  if (isHttps) return true;
  if (isProduction && !isLocalhost) return true;
  return false;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rate = consumeRateLimit(`admin_login:${ip}`, 8, 15 * 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: "Too many login attempts. Please try again later.",
        retryAfterSeconds: retryAfterSeconds(rate.resetAt),
      },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const email = String((body as { email?: unknown })?.email || "")
    .trim()
    .toLowerCase();
  const password = String((body as { password?: unknown })?.password || "");

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 },
    );
  }

  let credentialsOk = false;
  try {
    credentialsOk = verifyAdminCredentials(email, password);
  } catch (error) {
    console.error("Admin credential verification failed:", error);
    return NextResponse.json(
      { error: "Admin authentication is not configured on server" },
      { status: 503 },
    );
  }

  if (!credentialsOk) {
    return NextResponse.json(
      { error: "Invalid email or password" },
      { status: 401 },
    );
  }

  let token: string;
  try {
    token = createAdminSessionToken(email);
  } catch (error) {
    console.error("Admin session token creation failed:", error);
    return NextResponse.json(
      { error: "Admin session is not configured on server" },
      { status: 503 },
    );
  }

  const res = NextResponse.json({ success: true });
  const secureCookie = shouldUseSecureCookie(req);

  res.cookies.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookie,
    sameSite: "strict",
    path: "/",
    maxAge: 8 * 60 * 60,
  });

  return res;
}

export async function DELETE(req: NextRequest) {
  const res = NextResponse.json({ success: true });
  const secureCookie = shouldUseSecureCookie(req);
  res.cookies.set(ADMIN_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: secureCookie,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return res;
}
