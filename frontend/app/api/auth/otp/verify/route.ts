import { NextRequest, NextResponse } from "next/server";
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

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rate = consumeRateLimit(`otp_verify:${ip}`, 30, 10 * 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json(
        {
          error: "Too many OTP verification attempts",
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

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }
}
