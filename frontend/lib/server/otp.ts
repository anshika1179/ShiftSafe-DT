import { createHash, timingSafeEqual } from "node:crypto";
import { isProduction } from "@/lib/server/env";
import {
  isValidIndianMobile,
  normalizeIndianPhone,
} from "@/backend/utils/india-market";

interface OtpVerificationResult {
  valid: boolean;
  error?: string;
  status?: number;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function safeCompare(left: string, right: string): boolean {
  const leftHash = Buffer.from(sha256(left));
  const rightHash = Buffer.from(sha256(right));
  return timingSafeEqual(leftHash, rightHash);
}

export function normalizePhone(phone: unknown): string {
  return normalizeIndianPhone(phone);
}

export function isValidIndianPhoneNumber(phone: string): boolean {
  return isValidIndianMobile(phone);
}

export function normalizeOtp(otp: unknown): string {
  return String(otp || "").trim();
}

export function verifyOtpCode(otp: string): OtpVerificationResult {
  const configuredOtp = process.env.OTP_DEMO_CODE;
  const fallbackOtp = isProduction ? "" : "123456";
  const expectedOtp = (configuredOtp && configuredOtp.trim()) || fallbackOtp;

  if (!expectedOtp) {
    return {
      valid: false,
      status: 503,
      error: "OTP provider is not configured for this environment",
    };
  }

  if (!safeCompare(otp, expectedOtp)) {
    return {
      valid: false,
      status: 401,
      error: "Invalid OTP",
    };
  }

  return { valid: true };
}
