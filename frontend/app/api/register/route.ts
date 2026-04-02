// handles new worker registration + underwriting + auto-creates policy
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/backend/models/db';
import { calculateDynamicPremium } from '@/backend/engines/premium-engine';
import { underwriteWorker } from '@/backend/engines/underwriting-engine';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      name, phone, email, platform, city, zone, shiftType,
      avgWeeklyIncome, vehicleType, daysWorkedThisWeek,
      totalActiveDeliveryDays, wantInsurance,
    } = body;

    if (!name || !phone) {
      return NextResponse.json({ error: 'Name and phone are required' }, { status: 400 });
    }

    // sanitize everything before touching the database
    const sanitizedName = String(name).trim().slice(0, 100);
    const sanitizedPhone = String(phone).replace(/\D/g, '');
    if (sanitizedPhone.length !== 10) {
      return NextResponse.json({ error: 'Phone must be exactly 10 digits' }, { status: 400 });
    }
    if (sanitizedName.length < 2) {
      return NextResponse.json({ error: 'Name must be at least 2 characters' }, { status: 400 });
    }
    const ALLOWED_PLATFORMS = ['Zomato', 'Swiggy', 'Amazon Flex', 'Blinkit', 'Zepto'];
    const ALLOWED_ZONES = [
      'Andheri East', 'Andheri West', 'Bandra', 'Dharavi', 'Kurla', 'Powai', 'Worli', 'Thane', 'Navi Mumbai',
      'Connaught Place', 'Lajpat Nagar', 'Saket', 'Dwarka', 'Cyber City',
    ];
    const safePlatform = ALLOWED_PLATFORMS.includes(platform) ? platform : 'Zomato';
    const safeZone = ALLOWED_ZONES.includes(zone) ? zone : 'Andheri West';
    const safeCity = city || 'Mumbai';
    const safeIncome = Math.max(500, Math.min(50000, Number(avgWeeklyIncome) || 4000));
    const safeDaysWorked = Math.min(7, Math.max(0, Number(daysWorkedThisWeek) || 6));
    const safeActiveDays = Math.max(0, Number(totalActiveDeliveryDays) || 14);

    // Worker opted out of insurance
    const insuranceOptedOut = wantInsurance === false;

    const workerId = crypto.randomUUID();
    const policyId = crypto.randomUUID();

    const db = getDb();

    // make sure this phone number isn't already taken
    const existing = await db.prepare('SELECT id FROM workers WHERE phone = ?').get(sanitizedPhone);
    if (existing) {
      return NextResponse.json({ error: 'Phone number already registered' }, { status: 409 });
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
      vehicleType: vehicleType || 'bike',
    });

    // save the worker record
    await db.prepare(`INSERT INTO workers (id, name, phone, email, platform, city, zone, shift_type, avg_weekly_income, vehicle_type, insurance_opted_out, active_delivery_days, days_worked_this_week, activity_tier)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      workerId, sanitizedName, sanitizedPhone, email || null,
      safePlatform, safeCity, safeZone,
      shiftType || 'full_day', safeIncome, vehicleType || 'bike',
      insuranceOptedOut ? 1 : 0, safeActiveDays, safeDaysWorked,
      underwriting.activityTier,
    );

    // If worker opted out or not eligible — skip policy creation
    if (insuranceOptedOut) {
      return NextResponse.json({
        success: true,
        workerId,
        policyId: null,
        insuranceOptedOut: true,
        underwriting: {
          eligible: underwriting.eligible,
          reason: 'Worker opted out of insurance coverage.',
          activityTier: underwriting.activityTier,
        },
      });
    }

    if (!underwriting.eligible) {
      return NextResponse.json({
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
      safeIncome, safeZone, shiftType || 'full_day', 0, 'clear',
      safePlatform, safeCity, safeDaysWorked, safeActiveDays,
    );

    // create their first active policy with fixed tier
    await db.prepare(`INSERT INTO policies (id, worker_id, plan_name, premium_tier, weekly_premium, max_coverage_per_week, max_payout_percent, status, city_pool)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      policyId, workerId, premium.premiumTierName, premium.activityTier,
      premium.weeklyPremium, premium.maxPayoutPerWeek, 50.0,
      'active', premium.cityPool,
    );

    // save the full calculation for audit trail
    await db.prepare(`INSERT INTO premium_calculations (id, worker_id, base_premium, zone_risk_factor, weather_risk_factor, historical_claim_factor, platform_risk_factor, final_premium, factors_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      crypto.randomUUID(), workerId, premium.basePremium,
      premium.factors.baseZoneRisk, premium.mlMetrics.weatherRiskVolatility,
      premium.factors.historicalClaims, premium.factors.platformStability,
      premium.finalPremium, JSON.stringify(premium),
    );

    // Log weekly activity
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    await db.prepare(`INSERT INTO weekly_activity_log (id, worker_id, week_start, days_active, total_deliveries, total_earnings, is_eligible)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      crypto.randomUUID(), workerId, weekStart.toISOString().split('T')[0],
      safeDaysWorked, safeDaysWorked * 7, safeIncome, underwriting.eligible ? 1 : 0,
    );

    return NextResponse.json({
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
    console.error('Registration error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
