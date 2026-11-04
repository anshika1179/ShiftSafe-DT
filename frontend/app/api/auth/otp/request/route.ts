import { NextRequest, NextResponse } from "next/server";
import { isProduction } from "@/lib/server/env";
import { normalizePhone, isValidIndianPhoneNumber } from "@/lib/server/otp";
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!isValidIndianPhoneNumber(normalizePhone(body?.phone))) return NextResponse.json({ error: "Enter a valid Indian mobile number" }, { status: 400 });
    if (isProduction || process.env.OTP_MODE !== "local_test" || !/^\d{6}$/.test(process.env.OTP_DEMO_CODE || "")) return NextResponse.json({ error: "SMS verification is not configured. No OTP was sent." }, { status: 503 });
    return NextResponse.json({ mode: "local_test", message: "Local test mode. No SMS was sent. Use the code configured by your local operator." });
  } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
}
