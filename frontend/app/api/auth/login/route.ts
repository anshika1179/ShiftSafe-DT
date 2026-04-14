import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/backend/models/db";
import { isProduction } from "@/lib/server/env";
import {
  WORKER_SESSION_COOKIE,
  createWorkerSessionToken,
} from "@/lib/server/worker-auth";
import {
  isValidIndianPhoneNumber,
  normalizeOtp,
  normalizePhone,
  verifyOtpCode,
} from "@/lib/server/otp";
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
  try {
    const ip = getClientIp(req);
    const rate = consumeRateLimit(`worker_login:${ip}`, 15, 10 * 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json(
        {
          error: "Too many login attempts. Please try again later.",
          retryAfterSeconds: retryAfterSeconds(rate.resetAt),
        },
        { status: 429 },
      );
    }

    const body = await req.json();
    const phone = normalizePhone(body?.phone);
    const otp = normalizeOtp(body?.otp);

    if (!isValidIndianPhoneNumber(phone)) {
      return NextResponse.json(
        { error: "Enter a valid Indian mobile number (starts with 6-9)." },
        { status: 400 },
      );
    }

    if (!/^\d{6}$/.test(otp)) {
      return NextResponse.json(
        { error: "OTP must be 6 digits" },
        { status: 400 },
      );
    }

    const otpResult = verifyOtpCode(otp);
    if (!otpResult.valid) {
      return NextResponse.json(
        { error: otpResult.error || "OTP verification failed" },
        { status: otpResult.status || 401 },
      );
    }

    const db = getDb();
    const worker = (await db
      .prepare("SELECT id FROM workers WHERE phone = ? LIMIT 1")
      .get(phone)) as { id: string } | undefined;

    if (!worker) {
      return NextResponse.json(
        { error: "No worker account found for this phone number" },
        { status: 404 },
      );
    }

    const token = createWorkerSessionToken(worker.id, phone);
    const res = NextResponse.json({ success: true, workerId: worker.id });
    const secureCookie = shouldUseSecureCookie(req);

    res.cookies.set(WORKER_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: "strict",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });

    return res;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const res = NextResponse.json({ success: true });
  const secureCookie = shouldUseSecureCookie(req);
  res.cookies.set(WORKER_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: secureCookie,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return res;
}
