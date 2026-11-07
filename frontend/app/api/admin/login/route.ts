import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  createAdminSessionToken,
  verifyAdminCredentials,
} from "@/lib/server/admin-auth";
import { isProduction } from "@/lib/server/env";
import {
  getClientIp,
  retryAfterSeconds,
} from "@/lib/server/rate-limit";

import { consumeAdminLoginLimit } from "@/lib/server/admin-rate-limit";

export const runtime = "nodejs";

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
  if (req.headers.get("origin") !== req.nextUrl.origin) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const ip = getClientIp(req);
  let rate;
  try {
    rate = await consumeAdminLoginLimit(ip);
  } catch {
    return NextResponse.json({ error: "Admin authentication is temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: "Too many login attempts. Please try again later.",
        retryAfterSeconds: retryAfterSeconds(rate.resetAt),
      },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rate.resetAt)), "Cache-Control": "no-store" } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid login input" }, { status: 400 });
  }

  const email = String((body as { email?: unknown })?.email || "")
    .trim()
    .toLowerCase();
  const password = String((body as { password?: unknown })?.password || "");

  if (email.length > 254 || password.length > 1024 || typeof (body as { email?: unknown })?.email !== "string" || typeof (body as { password?: unknown })?.password !== "string") {
    return NextResponse.json({ error: "Invalid login input" }, { status: 400 });
  }

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 },
    );
  }

  let credentialsOk = false;
  try {
    credentialsOk = await verifyAdminCredentials(email, password);
  } catch {
    console.error("Admin credential verification unavailable");
    return NextResponse.json(
      { error: "Admin authentication is temporarily unavailable" },
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
  } catch {
    console.error("Admin session token creation unavailable");
    return NextResponse.json(
      { error: "Admin session is not configured on server" },
      { status: 503 },
    );
  }

  const res = NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
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
  if (req.headers.get("origin") !== req.nextUrl.origin) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const res = NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
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
