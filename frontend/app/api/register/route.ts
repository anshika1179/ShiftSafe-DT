// handles new worker registration + underwriting + auto-creates policy
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/backend/models/db";
import { calculateDynamicPremium } from "@/backend/engines/premium-engine";
import { underwriteWorker } from "@/backend/engines/underwriting-engine";
import { isProduction } from "@/lib/server/env";
import {
  WORKER_SESSION_COOKIE,
  createWorkerSessionToken,
} from "@/lib/server/worker-auth";
import {
  consumeRateLimit,
  getClientIp,
  retryAfterSeconds,
} from "@/lib/server/rate-limit";
import {
  isValidIndianMobile,
  normalizeIndianCityName,
  normalizeIndianPhone,
} from "@/backend/utils/india-market";

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

function buildAuthedResponse(
  req: NextRequest,
  workerId: string,
  phone: string,
  payload: unknown,
): NextResponse {
  const res = NextResponse.json(payload);
  try {
    const token = createWorkerSessionToken(workerId, phone);
    const secureCookie = shouldUseSecureCookie(req);

    res.cookies.set(WORKER_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: "strict",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });
  } catch (error) {
    console.error("Failed to create worker session token:", error);
  }

  return res;
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rate = consumeRateLimit(`register:${ip}`, 20, 15 * 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json(
        {
          error: "Too many registration attempts. Please try again later.",
          retryAfterSeconds: retryAfterSeconds(rate.resetAt),
        },
        { status: 429 },
      );
    }

    const body = await req.json();
    const {
      name,
      phone,
      email,
      platform,
      city,
      zone,
      shiftType,
      avgWeeklyIncome,
      vehicleType,
      daysWorkedThisWeek,
      totalActiveDeliveryDays,
      wantInsurance,
      payoutMethod,
      upiId,
      bankAccount,
      ifscCode,
    } = body;

    if (!name || !phone) {
      return NextResponse.json(
        { error: "Name and phone are required" },
        { status: 400 },
      );
    }

    // sanitize everything before touching the database
    const sanitizedName = String(name).trim().slice(0, 100);
    const sanitizedPhone = normalizeIndianPhone(phone);
    if (!isValidIndianMobile(sanitizedPhone)) {
      return NextResponse.json(
        { error: "Enter a valid Indian mobile number (starts with 6-9)." },
        { status: 400 },
      );
    }
    if (sanitizedName.length < 2) {
      return NextResponse.json(
        { error: "Name must be at least 2 characters" },
        { status: 400 },
      );
    }
    const ALLOWED_PLATFORMS = [
      "Zomato",
      "Swiggy",
      "Amazon Flex",
      "Blinkit",
      "Zepto",
    ];
    if (!ALLOWED_PLATFORMS.includes(platform)) {
      return NextResponse.json(
        { error: "Unsupported platform selected" },
        { status: 400 },
      );
    }

    const safePlatform = platform;
    const safeZone = String(zone || "")
      .trim()
      .slice(0, 80);
    const safeCity = normalizeIndianCityName(String(city || "").slice(0, 60));

    if (safeZone.length < 2) {
      return NextResponse.json({ error: "Zone is required" }, { status: 400 });
    }

    const safeEmail = email
      ? String(email).trim().slice(0, 120).toLowerCase()
      : null;
    if (safeEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 },
      );
    }

    const safeIncome = Math.max(
      500,
      Math.min(50000, Number(avgWeeklyIncome) || 4000),
    );
    const safeDaysWorked = Math.min(
      7,
      Math.max(0, Number(daysWorkedThisWeek) || 6),
    );
    const safeActiveDays = Math.max(0, Number(totalActiveDeliveryDays) || 14);

    const normalizedPayoutMethod =
      String(payoutMethod || "upi")
        .trim()
        .toLowerCase() === "bank"
        ? "bank"
        : "upi";
    const normalizedUpiId = String(upiId || "")
      .trim()
      .toLowerCase();
    const normalizedBankAccount = String(bankAccount || "")
      .trim()
      .replace(/\s+/g, "");
    const normalizedIfscCode = String(ifscCode || "")
      .trim()
      .toUpperCase();

    const upiPattern = /^[a-z0-9._-]{2,}@[a-z][a-z0-9.-]{1,}$/i;
    const bankAccountPattern = /^\d{9,18}$/;
    const ifscPattern = /^[A-Z]{4}0[A-Z0-9]{6}$/;

    let safeUpiId = `${sanitizedPhone}@upi`;
    let safeBankAccount: string | null = null;
    let safeIfscCode: string | null = null;

    if (normalizedPayoutMethod === "upi") {
      if (normalizedUpiId && !upiPattern.test(normalizedUpiId)) {
        return NextResponse.json(
          { error: "Invalid UPI ID format" },
          { status: 400 },
        );
      }
      if (normalizedUpiId) {
        safeUpiId = normalizedUpiId;
      }
    } else {
      if (!bankAccountPattern.test(normalizedBankAccount)) {
        return NextResponse.json(
          {
            error:
              "Bank account must be 9-18 digits when payout method is bank",
          },
          { status: 400 },
        );
      }
      if (!ifscPattern.test(normalizedIfscCode)) {
        return NextResponse.json(
          { error: "Invalid IFSC code format" },
          { status: 400 },
        );
      }
      safeBankAccount = normalizedBankAccount;
      safeIfscCode = normalizedIfscCode;
      safeUpiId =
        normalizedUpiId && upiPattern.test(normalizedUpiId)
          ? normalizedUpiId
          : `${sanitizedPhone}@upi`;
    }

    // Worker opted out of insurance
    const insuranceOptedOut = wantInsurance === false;

    const workerId = crypto.randomUUID();
    const policyId = crypto.randomUUID();

    const db = getDb();

    // make sure this phone number isn't already taken
    const existing = await db
      .prepare("SELECT id FROM workers WHERE phone = ?")
      .get(sanitizedPhone);
    if (existing) {
      return NextResponse.json(
        { error: "Phone number already registered" },
        { status: 409 },
      );
    }

    // underwriting check
    const underwriting = underwriteWorker({
      platform: safePlatform,
      city: safeCity,
      zone: safeZone,
      totalActiveDeliveryDays: safeActiveDays,
      daysWorkedThisWeek: safeDaysWorked,
      daysActiveInLast30: safeActiveDays, // use total as proxy
      avgWeeklyIncome: safeIncome,
      vehicleType: vehicleType || "bike",
    });

    // save the worker record
    await db
      .prepare(
        `INSERT INTO workers (id, name, phone, email, platform, city, zone, shift_type, avg_weekly_income, vehicle_type, insurance_opted_out, payout_method, upi_id, bank_account, ifsc_code, active_delivery_days, days_worked_this_week, activity_tier)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        workerId,
        sanitizedName,
        sanitizedPhone,
        safeEmail,
        safePlatform,
        safeCity,
        safeZone,
        shiftType || "full_day",
        safeIncome,
        vehicleType || "bike",
        insuranceOptedOut ? 1 : 0,
        normalizedPayoutMethod,
        safeUpiId,
        safeBankAccount,
        safeIfscCode,
        safeActiveDays,
        safeDaysWorked,
        underwriting.activityTier,
      );

    // If worker opted out or not eligible — skip policy creation
    if (insuranceOptedOut) {
      return buildAuthedResponse(req, workerId, sanitizedPhone, {
        success: true,
        workerId,
        policyId: null,
        insuranceOptedOut: true,
        underwriting: {
          eligible: underwriting.eligible,
          reason: "Worker opted out of insurance coverage.",
          activityTier: underwriting.activityTier,
        },
      });
    }

    if (!underwriting.eligible) {
      return buildAuthedResponse(req, workerId, sanitizedPhone, {
        success: true,
        workerId,
        policyId: null,
        underwriting: {
          eligible: false,
          reason: underwriting.reason,
          activityTier: underwriting.activityTier,
          warnings: underwriting.warnings,
        },
      });
    }

    // run the pricing engine
    const premium = await calculateDynamicPremium(
      safeIncome,
      safeZone,
      shiftType || "full_day",
      0,
      "clear",
      safePlatform,
      safeCity,
      safeDaysWorked,
      safeActiveDays,
    );

    // create their first active policy with fixed tier
    await db
      .prepare(
        `INSERT INTO policies (id, worker_id, plan_name, premium_tier, weekly_premium, max_coverage_per_week, max_payout_percent, status, city_pool)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        policyId,
        workerId,
        premium.premiumTierName,
        premium.activityTier,
        premium.weeklyPremium,
        premium.maxPayoutPerWeek,
        50.0,
        "active",
        premium.cityPool,
      );

    // save the full calculation for audit trail
    await db
      .prepare(
        `INSERT INTO premium_calculations (id, worker_id, base_premium, zone_risk_factor, weather_risk_factor, historical_claim_factor, platform_risk_factor, final_premium, factors_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        workerId,
        premium.basePremium,
        premium.factors.baseZoneRisk,
        premium.mlMetrics.weatherRiskVolatility,
        premium.factors.historicalClaims,
        premium.factors.platformStability,
        premium.finalPremium,
        JSON.stringify(premium),
      );

    // Log weekly activity
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    await db
      .prepare(
        `INSERT INTO weekly_activity_log (id, worker_id, week_start, days_active, total_deliveries, total_earnings, is_eligible)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        workerId,
        weekStart.toISOString().split("T")[0],
        safeDaysWorked,
        safeDaysWorked * 7,
        safeIncome,
        underwriting.eligible ? 1 : 0,
      );

    return buildAuthedResponse(req, workerId, sanitizedPhone, {
      success: true,
      workerId,
      policyId,
      underwriting: {
        eligible: underwriting.eligible,
        reason: underwriting.reason,
        activityTier: underwriting.activityTier,
        cityPool: underwriting.cityPool,
        steps: underwriting.steps,
        warnings: underwriting.warnings,
      },
      premium: {
        weekly: premium.finalPremium,
        tierName: premium.premiumTierName,
        maxPayoutPerWeek: premium.maxPayoutPerWeek,
        breakdown: premium.breakdown,
        riskLevel: premium.riskLevel,
        pricingBreakdown: premium.pricingBreakdown,
      },
    });
  } catch (err) {
    console.error("Registration error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
