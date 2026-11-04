// Verified onboarding creates an unpriced pending prototype record, never active cover.
import { consumeContactPhoneProof } from "@/lib/server/phone-verification";
import { consumeGoogleProof } from "@/lib/server/google-onboarding";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/backend/models/db";
import { underwriteWorker } from "@/backend/engines/underwriting-engine";
import { isProduction, getWorkerSessionSecret } from "@/lib/server/env";
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

async function insertWorkerRecord(
  db: Pick<ReturnType<typeof getDb>, "prepare">,
  input: {
    workerId: string;
    sanitizedName: string;
    sanitizedPhone: string | null;
    safeEmail: string | null;
    safePlatform: string;
    safeCity: string;
    safeZone: string;
    shiftType: string;
    safeIncome: number;
    vehicleType: string;
    insuranceOptedOut: boolean;
    normalizedPayoutMethod: string;
    safeUpiId: string;
    safeBankAccount: string | null;
    safeIfscCode: string | null;
    safeActiveDays: number;
    safeDaysWorked: number;
    activityTier: string;
  },
): Promise<void> {
  const {
    workerId,
    sanitizedName,
    sanitizedPhone,
    safeEmail,
    safePlatform,
    safeCity,
    safeZone,
    shiftType,
    safeIncome,
    vehicleType,
    insuranceOptedOut,
    normalizedPayoutMethod,
    safeUpiId,
    safeBankAccount,
    safeIfscCode,
    safeActiveDays,
    safeDaysWorked,
    activityTier,
  } = input;

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
      activityTier,
    );
}

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
  googleSubject?: string,
): NextResponse {
  const res = NextResponse.json(payload);
  const token = createWorkerSessionToken(workerId, phone, undefined, googleSubject);
  const secureCookie = shouldUseSecureCookie(req);

  res.cookies.set(WORKER_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookie,
    sameSite: "strict",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });

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
      registrationProof,
      phoneProof,
      authMethod,
      daysActiveInLast30,
      consents,
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

    let safeEmail = email
      ? String(email).trim().slice(0, 120).toLowerCase()
      : null;
    if (safeEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 },
      );
    }

    if (avgWeeklyIncome === "" || daysWorkedThisWeek === "" || totalActiveDeliveryDays === "" || daysActiveInLast30 === "") return NextResponse.json({ error: "Enter actual income and activity values" }, { status: 400 });
    const safeIncome = Number(avgWeeklyIncome);
    if (!Number.isFinite(safeIncome) || safeIncome < 500 || safeIncome > 50000) return NextResponse.json({ error: "Weekly income must be between 500 and 50000" }, { status: 400 });
    const safeDaysWorked = Number(daysWorkedThisWeek);
    const safeActiveDays = Number(totalActiveDeliveryDays);
    if (!Number.isInteger(safeDaysWorked) || safeDaysWorked < 0 || safeDaysWorked > 7 || !Number.isInteger(safeActiveDays) || safeActiveDays < 0 || safeActiveDays > 36500) {
      return NextResponse.json({ error: "Enter valid weekly and lifetime activity days" }, { status: 400 });
    }

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

    let safeUpiId = "";
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
          : "";
    }

    const monthlyDays = Number(daysActiveInLast30);
    if (!Number.isInteger(monthlyDays) || monthlyDays < 0 || monthlyDays > 30 || monthlyDays > safeActiveDays) return NextResponse.json({ error: "Enter valid activity days in the last 30 days" }, { status: 400 });
    const dpdpConsents = {
      gpsLocation: consents?.gpsLocation === true,
      bankUpi: consents?.bankUpi === true,
      platformActivity: consents?.platformActivity === true,
    };
    // Validate signing configuration before saving an account.
    try { getWorkerSessionSecret(); } catch {
      return NextResponse.json({ error: "Registration authentication is not configured" }, { status: 503 });
    }
    const proofId = String(registrationProof || "").trim();
    const googleMode = authMethod === "google";
    if (googleMode && req.headers.get("origin") !== req.nextUrl.origin) return NextResponse.json({ error: "Invalid registration origin" }, { status: 403 });
    let googleSubject: string | undefined;
    let contactPhoneVerified = false;
    if (!proofId) return NextResponse.json({ error: "Sign-in verification is required" }, { status: 401 });
    const proofDb = getDb();
    if (googleMode) {
      const identity = await consumeGoogleProof(proofId);
      if (!identity) return NextResponse.json({ error: "Open your email verification link first. The onboarding grant may have expired or already been used." }, { status: 401 });
      googleSubject = identity.subject;
      if (phoneProof) {
        contactPhoneVerified = await consumeContactPhoneProof(`google:${googleSubject}`, sanitizedPhone, String(phoneProof));
        if (!contactPhoneVerified) return NextResponse.json({ error: "Phone verification expired, mismatched or already used. Verify again." }, { status: 401 });
      }
      safeEmail = identity.email;
      const existingIdentity = await proofDb.prepare("SELECT worker_id FROM worker_identities WHERE provider = ? AND subject = ?").get("google", googleSubject);
      if (existingIdentity) return NextResponse.json({ error: "Google account already registered. Sign in instead." }, { status: 409 });
    } else {
      await proofDb.prepare("DELETE FROM registration_proofs WHERE expires_at < ?").run(Date.now() - 24 * 60 * 60 * 1000);
      const consumed = await proofDb.prepare("UPDATE registration_proofs SET consumed = 1 WHERE id = ? AND phone = ? AND consumed = 0 AND expires_at > ?").run(proofId, sanitizedPhone, Date.now());
      if (consumed.changes !== 1) return NextResponse.json({ error: "Phone verification expired or already used. Verify again." }, { status: 401 });
    }

    // Worker opted out of insurance
    const insuranceOptedOut = wantInsurance === false;

    const workerId = crypto.randomUUID();
    const policyId = crypto.randomUUID();

    const statements: { query: string; params: unknown[] }[] = [];
    const db = getDb();
    const writes = {
      prepare(query: string) {
        return {
          async run(...params: unknown[]) { statements.push({ query, params }); return { changes: 1 }; },
          async get() { throw new Error("Queued writes cannot read"); },
          async all() { throw new Error("Queued writes cannot read"); },
        };
      },
    };

    // make sure this phone number isn't already taken
    const existing = await db
      .prepare("SELECT id FROM workers WHERE phone = ?")
      .get(sanitizedPhone);
    if (!googleMode && existing) {
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
      daysActiveInLast30: monthlyDays,
      avgWeeklyIncome: safeIncome,
      vehicleType: vehicleType || "bike",
      isMultiApping: false,
      dpdpConsents,
    });

    statements.push({ query: "INSERT INTO worker_journeys (worker_id, step, eligibility_json) VALUES (?, ?, ?)", params: [workerId, "profile", JSON.stringify({ eligible: underwriting.eligible, reason: underwriting.reason, warnings: underwriting.warnings, activityTier: underwriting.activityTier, provenance: "existing-unvalidated-product-rules", insuranceOptedOut })] });

    // All account, consent, policy and audit records commit together.
    await insertWorkerRecord(writes, {
      workerId,
      sanitizedName,
      sanitizedPhone: googleMode ? null : sanitizedPhone,
      safeEmail,
      safePlatform,
      safeCity,
      safeZone,
      shiftType,
      safeIncome,
      vehicleType,
      insuranceOptedOut,
      normalizedPayoutMethod,
      safeUpiId,
      safeBankAccount,
      safeIfscCode,
      safeActiveDays,
      safeDaysWorked,
      activityTier: underwriting.activityTier,
    });

    if (googleSubject) {
      statements.push({ query: "INSERT INTO worker_identities (provider, subject, worker_id) VALUES (?, ?, ?)", params: ["google", googleSubject, workerId] });
      statements.push({ query: "INSERT INTO worker_contacts (worker_id, phone, phone_verified) VALUES (?, ?, ?)", params: [workerId, sanitizedPhone, contactPhoneVerified ? 1 : 0] });
    }

    statements.push({ query: "INSERT INTO registration_consents (worker_id, gps_location, bank_upi, platform_activity) VALUES (?, ?, ?, ?)", params: [workerId, dpdpConsents.gpsLocation ? 1 : 0, dpdpConsents.bankUpi ? 1 : 0, dpdpConsents.platformActivity ? 1 : 0] });

    // If worker opted out or not eligible — skip policy creation
    if (insuranceOptedOut) {
      await db.batch(statements);
      return buildAuthedResponse(req, workerId, googleMode ? "" : sanitizedPhone, {
        success: true,
        workerId,
        policyId: null,
        insuranceOptedOut: true,
        underwriting: {
          eligible: underwriting.eligible,
          reason: "Worker opted out of insurance coverage.",
          activityTier: underwriting.activityTier,
        },
      }, googleSubject);
    }

    if (!underwriting.eligible) {
      await db.batch(statements);
      return buildAuthedResponse(req, workerId, googleMode ? "" : sanitizedPhone, {
        success: true,
        workerId,
        policyId: null,
        underwriting: {
          eligible: false,
          reason: underwriting.reason,
          activityTier: underwriting.activityTier,
          warnings: underwriting.warnings,
        },
      }, googleSubject);
    }

    // Unpaid placeholder only. The historical quote requires an explicit schedule later.
    await writes.prepare(`INSERT INTO policies (id,worker_id,plan_name,premium_tier,weekly_premium,max_coverage_per_week,max_payout_percent,status,city_pool) VALUES (?,?,?,?,?,?,?,?,?)`).run(policyId,workerId,"Unpriced prototype record","unpriced",0,0,0,"pending",safeCity);

    // Log weekly activity
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    await writes
      .prepare(
        `INSERT INTO weekly_activity_log (id, worker_id, week_start, days_active, total_deliveries, total_earnings, is_eligible)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        workerId,
        weekStart.toISOString().split("T")[0],
        safeDaysWorked,
        0,
        safeIncome,
        underwriting.eligible ? 1 : 0,
      );

    await db.batch(statements);

    return buildAuthedResponse(req, workerId, googleMode ? "" : sanitizedPhone, {
      success: true,
      workerId,
      policyId,
      policyStatus: "pending",
      underwriting: {
        eligible: underwriting.eligible,
        reason: underwriting.reason,
        activityTier: underwriting.activityTier,
        cityPool: underwriting.cityPool,
        steps: underwriting.steps,
        warnings: underwriting.warnings,
      },
      premium: null,
      quoteStatus: "schedule_required",
    }, googleSubject);
  } catch (err) {
    console.error("Registration error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
