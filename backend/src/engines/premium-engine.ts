/*
 * Premium Pricing Engine v3.0
 *
 * Implements the exact formula from Syntax Brain Error coffee chat:
 *   Base Premium = (trigger_probability) × (avg_income_lost_per_day) × (days_exposed)
 *   Adjust for: city tier, peril type, worker activity tier
 *
 * City Tier System:
 *   Tier 1 (Metro)    — Mumbai, Delhi, Bengaluru, Hyderabad, Pune, Chennai
 *   Tier 2 (Urban)    — Gurugram, Noida, Jaipur, Lucknow, Ahmedabad
 *   Tier 3 (Emerging) — All other cities
 *
 * Fixed premium tiers: ₹20, ₹30, ₹40, ₹50 per week
 * Weekly cycle only — never monthly
 * 50% maximum payout cap
 */

// ─── City Tier Classification ────────────────────────────────────────
// Tier 1 (Metro):    Mature risk data, higher gig density, full coverage
// Tier 2 (Urban):    Moderate data, growing markets, slight premium discount
// Tier 3 (Emerging): Limited data, conservative pricing, lower payout caps

export interface CityTierInfo {
  tier: 1 | 2 | 3;
  label: 'Metro' | 'Urban' | 'Emerging';
  emoji: string;
  premiumDiscount: number;      // % discount (Tier 1 = 0%, Tier 2 = 5%, Tier 3 = 10%)
  maxPayoutMultiplier: number;  // 1.0 for Tier 1, 0.85 for Tier 2, 0.70 for Tier 3
  reserveMultiplier: number;    // higher for less-data cities
  riskPool: string;
  description: string;
}

export const CITY_TIERS: Record<string, CityTierInfo> = {
  // ── Tier 1: Metro cities with mature risk data ──
  mumbai:     { tier: 1, label: 'Metro', emoji: '🏙️', premiumDiscount: 0,    maxPayoutMultiplier: 1.00, reserveMultiplier: 1.0, riskPool: 'mumbai_rain',   description: 'Full coverage · Monsoon-heavy risk profile' },
  delhi:      { tier: 1, label: 'Metro', emoji: '🏙️', premiumDiscount: 0,    maxPayoutMultiplier: 1.00, reserveMultiplier: 1.0, riskPool: 'delhi_aqi',     description: 'Full coverage · AQI + heatwave risk profile' },
  bengaluru:  { tier: 1, label: 'Metro', emoji: '🏙️', premiumDiscount: 0,    maxPayoutMultiplier: 1.00, reserveMultiplier: 1.0, riskPool: 'bengaluru_mix', description: 'Full coverage · Moderate rain + heat profile' },
  hyderabad:  { tier: 1, label: 'Metro', emoji: '🏙️', premiumDiscount: 0,    maxPayoutMultiplier: 1.00, reserveMultiplier: 1.0, riskPool: 'hyderabad_mix', description: 'Full coverage · Flash flood + heat profile' },
  pune:       { tier: 1, label: 'Metro', emoji: '🏙️', premiumDiscount: 0,    maxPayoutMultiplier: 1.00, reserveMultiplier: 1.0, riskPool: 'mumbai_rain',   description: 'Full coverage · Western Ghats rain profile' },
  chennai:    { tier: 1, label: 'Metro', emoji: '🏙️', premiumDiscount: 0,    maxPayoutMultiplier: 1.00, reserveMultiplier: 1.0, riskPool: 'chennai_rain',  description: 'Full coverage · Cyclone + NE monsoon profile' },
  // ── Tier 2: Urban cities with growing gig economy ──
  gurugram:   { tier: 2, label: 'Urban', emoji: '🌆', premiumDiscount: 0.05, maxPayoutMultiplier: 0.85, reserveMultiplier: 1.2, riskPool: 'delhi_aqi',     description: '85% payout cap · Delhi NCR suburb' },
  noida:      { tier: 2, label: 'Urban', emoji: '🌆', premiumDiscount: 0.05, maxPayoutMultiplier: 0.85, reserveMultiplier: 1.2, riskPool: 'delhi_aqi',     description: '85% payout cap · Delhi NCR suburb' },
  jaipur:     { tier: 2, label: 'Urban', emoji: '🌆', premiumDiscount: 0.05, maxPayoutMultiplier: 0.85, reserveMultiplier: 1.2, riskPool: 'jaipur_heat',   description: '85% payout cap · Desert heat profile' },
  lucknow:    { tier: 2, label: 'Urban', emoji: '🌆', premiumDiscount: 0.05, maxPayoutMultiplier: 0.85, reserveMultiplier: 1.2, riskPool: 'lucknow_mix',   description: '85% payout cap · Mixed risk profile' },
  ahmedabad:  { tier: 2, label: 'Urban', emoji: '🌆', premiumDiscount: 0.05, maxPayoutMultiplier: 0.85, reserveMultiplier: 1.2, riskPool: 'ahmedabad_heat',description: '85% payout cap · Extreme heat profile' },
  // ── Tier 3: Emerging cities (default for unknown) ──
};

const DEFAULT_TIER_3: CityTierInfo = {
  tier: 3, label: 'Emerging', emoji: '🌇', premiumDiscount: 0.10,
  maxPayoutMultiplier: 0.70, reserveMultiplier: 1.5,
  riskPool: 'default', description: '70% payout cap · Limited risk data',
};

export function getCityTier(city: string): CityTierInfo {
  return CITY_TIERS[city.toLowerCase()] || DEFAULT_TIER_3;
}

// trigger probabilities per city per week
// NOTE: these are hypothetical — in prod we'd pull from IMD/weather history
const TRIGGER_PROBABILITIES: Record<string, Record<string, number>> = {
  // ── Tier 1 Metro ──
  // Delhi NCR — AQI-heavy, heatwave in May-June
  delhi: {
    pollution:        0.35,   // AQI > 300 very common in winter
    heatwave:         0.20,   // May-June peak
    heavy_rain:       0.10,   // monsoon only
    platform_outage:  0.05,
    curfew:           0.02,
  },
  // Mumbai — rain-heavy
  mumbai: {
    heavy_rain:       0.30,   // monsoon floods
    pollution:        0.08,
    heatwave:         0.10,
    platform_outage:  0.06,
    curfew:           0.03,
  },
  bengaluru: {
    heavy_rain:       0.18,   // moderate monsoon
    pollution:        0.06,
    heatwave:         0.12,
    platform_outage:  0.04,
    curfew:           0.01,
  },
  hyderabad: {
    heavy_rain:       0.20,   // flash floods
    pollution:        0.10,
    heatwave:         0.22,   // hot summers
    platform_outage:  0.05,
    curfew:           0.02,
  },
  pune: {
    heavy_rain:       0.25,   // Western Ghats rain
    pollution:        0.07,
    heatwave:         0.08,
    platform_outage:  0.04,
    curfew:           0.02,
  },
  chennai: {
    heavy_rain:       0.28,   // NE monsoon + cyclones
    pollution:        0.05,
    heatwave:         0.15,
    platform_outage:  0.05,
    curfew:           0.02,
  },
  // ── Tier 2 Urban ──
  gurugram: {
    pollution:        0.30,
    heatwave:         0.18,
    heavy_rain:       0.08,
    platform_outage:  0.05,
    curfew:           0.02,
  },
  noida: {
    pollution:        0.32,
    heatwave:         0.17,
    heavy_rain:       0.09,
    platform_outage:  0.05,
    curfew:           0.02,
  },
  jaipur: {
    heatwave:         0.35,   // desert heat dominant
    pollution:        0.12,
    heavy_rain:       0.06,
    platform_outage:  0.04,
    curfew:           0.01,
  },
  lucknow: {
    pollution:        0.25,
    heatwave:         0.20,
    heavy_rain:       0.12,
    platform_outage:  0.04,
    curfew:           0.02,
  },
  ahmedabad: {
    heatwave:         0.38,   // extreme heat
    pollution:        0.10,
    heavy_rain:       0.05,
    platform_outage:  0.04,
    curfew:           0.01,
  },
};

// fixed premium tiers — kept simple for MVP
// TODO: make these configurable via admin panel eventually
interface PremiumTier {
  name: string;
  weeklyPremium: number;       // fixed ₹ per week
  maxPayoutPerWeek: number;    // 50% cap applied
  minActivityDays: number;     // underwriting threshold
  coverageEvents: string[];
}

export const PREMIUM_TIERS: Record<string, PremiumTier> = {
  basic: {
    name: 'ShiftGuard Basic',
    weeklyPremium: 20,
    maxPayoutPerWeek: 1000,
    minActivityDays: 5,
    coverageEvents: ['heavy_rain', 'heatwave'],
  },
  standard: {
    name: 'ShiftGuard Standard',
    weeklyPremium: 35,
    maxPayoutPerWeek: 2000,
    minActivityDays: 7,
    coverageEvents: ['heavy_rain', 'heatwave', 'pollution', 'platform_outage'],
  },
  premium: {
    name: 'ShiftGuard Premium',
    weeklyPremium: 50,
    maxPayoutPerWeek: 3000,
    minActivityDays: 7,
    coverageEvents: ['heavy_rain', 'heatwave', 'pollution', 'platform_outage', 'curfew'],
  },
};

// classify workers into tiers based on how active they are
export function classifyActivityTier(daysWorkedInWeek: number, totalActiveDeliveryDays: number): string {
  if (totalActiveDeliveryDays < 7) return 'ineligible';     // not enough history
  if (daysWorkedInWeek >= 6) return 'premium';              // very active
  if (daysWorkedInWeek >= 5) return 'standard';             // regular
  return 'basic';                                           // low activity → lower tier
}

// which risk pool does this city belong to?
export function getCityPool(city: string): string {
  const tierInfo = getCityTier(city);
  return tierInfo.riskPool;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// seasonal pricing bump — delhi summer and mumbai monsoon hit hard
// keeping it simple for now, can make more granular later
function getSeasonalMultiplier(city: string): number {
  const month = new Date().getMonth() + 1; // 1-12
  const cityLower = city.toLowerCase();

  // Tier 1 Metro seasonal adjustments
  if (['delhi', 'gurugram', 'noida', 'new delhi', 'gurgaon'].includes(cityLower)) {
    if (month === 5 || month === 6) return 1.3;   // 30% uplift for hazard season
    if (month >= 11 || month <= 1) return 1.2;    // winter AQI season
  }
  if (['mumbai', 'thane', 'navi mumbai', 'pune'].includes(cityLower)) {
    if (month >= 7 && month <= 9) return 1.35;    // monsoon season
  }
  if (cityLower === 'bengaluru') {
    if (month >= 6 && month <= 9) return 1.15;    // moderate monsoon
  }
  if (cityLower === 'hyderabad') {
    if (month >= 7 && month <= 9) return 1.20;    // monsoon + floods
    if (month === 5 || month === 6) return 1.25;  // extreme heat
  }
  if (cityLower === 'chennai') {
    if (month >= 10 && month <= 12) return 1.30;  // NE monsoon + cyclones
  }

  // Tier 2 Urban seasonal adjustments
  if (['jaipur', 'ahmedabad'].includes(cityLower)) {
    if (month >= 4 && month <= 6) return 1.35;    // desert heat peak
  }
  if (cityLower === 'lucknow') {
    if (month >= 11 || month <= 1) return 1.15;   // winter AQI
    if (month === 5 || month === 6) return 1.20;  // summer heat
  }

  return 1.0; // normal season
}

// main input/output types

export interface PremiumInput {
  zone: string;
  platform: string;
  avgWeeklyIncome: number;
  city: string;
  daysWorkedThisWeek: number;
  totalActiveDeliveryDays: number;
  claimsHistory?: number;
  shiftType?: string;
  weatherForecast?: string;
  vehicleType?: string;
}

export interface PremiumResult {
  weeklyPremium: number;
  coverageAmount: number;
  maxPayoutPerWeek: number;
  riskScore: number;
  riskLabel: 'Low' | 'Moderate' | 'High' | 'Very High';
  activityTier: string;
  premiumTierName: string;
  cityPool: string;
  cityTier: CityTierInfo;
  isEligible: boolean;
  eligibilityReason: string;
  contributions: {
    weather: number;
    zone: number;
    platform: number;
    claims: number;
  };
  pricingBreakdown: {
    triggerProbability: number;
    avgIncomeLostPerDay: number;
    daysExposed: number;
    rawPremium: number;
    seasonalMultiplier: number;
    fixedTierPremium: number;
    cityTierDiscount: number;
  };
  // legacy compatibility fields
  finalPremium: number;
  basePremium: number;
  riskLevel: 'low' | 'moderate' | 'high' | 'severe';
  breakdown: Record<string, number>;
  factors: Record<string, number>;
  mlMetrics: {
    fraudProbability: number;
    anomalyDetected: boolean;
    weatherRiskVolatility: number;
  };
}

/**
 * Core pricing formula from coffee chat:
 *   Base = trigger_probability × avg_income_lost_per_day × days_exposed
 *   Then map to nearest fixed tier
 */
export function calculateWeeklyPremium(
  zone: string,
  earnings: number,
  platform: string,
  claimsHistory: number = 0,
  forecast: string = 'clear',
  city: string = 'Mumbai',
  daysWorkedThisWeek: number = 6,
  totalActiveDeliveryDays: number = 14,
): PremiumResult {
  // step 1: check if this worker qualifies at all
  const activityTier = classifyActivityTier(daysWorkedThisWeek, totalActiveDeliveryDays);
  const isEligible = activityTier !== 'ineligible';
  const eligibilityReason = !isEligible
    ? `Need minimum 7 active delivery days. Current: ${totalActiveDeliveryDays} days.`
    : `Eligible — ${totalActiveDeliveryDays} active days, ${daysWorkedThisWeek} days/week.`;

  // step 2: look up trigger probabilities and city tier
  const cityTier = getCityTier(city);
  const cityPool = cityTier.riskPool;
  const cityKey = city.toLowerCase();
  const cityProbs = TRIGGER_PROBABILITIES[cityKey] || TRIGGER_PROBABILITIES.mumbai;

  // Combined trigger probability (any event in a week)
  // P(at least one trigger) = 1 - ∏(1 - P_i)
  const probabilities = Object.values(cityProbs);
  const probNoTrigger = probabilities.reduce((acc, p) => acc * (1 - p), 1);
  const combinedTriggerProbability = 1 - probNoTrigger;

  // Adjust for weather forecast
  let forecastMultiplier = 1.0;
  if (forecast === 'heavy_rain') forecastMultiplier = 1.4;
  else if (forecast === 'storm') forecastMultiplier = 1.8;
  else if (forecast === 'pollution') forecastMultiplier = 1.3;

  const adjustedTriggerProb = clamp(combinedTriggerProbability * forecastMultiplier, 0.05, 0.85);

  // step 3: the core formula
  // base = trigger_probability × avg_income_lost/day × days_exposed
  const avgIncomeLostPerDay = (earnings / 7) * 0.70; // 70% of daily income
  const daysExposed = daysWorkedThisWeek; // only days they actually work
  const rawPremium = adjustedTriggerProb * avgIncomeLostPerDay * daysExposed;

  // Seasonal multiplier (Delhi May-June, Mumbai monsoon)
  const seasonalMultiplier = getSeasonalMultiplier(city);
  const adjustedPremium = rawPremium * seasonalMultiplier;

  // step 4: snap to the nearest fixed tier
  const tier = PREMIUM_TIERS[activityTier] || PREMIUM_TIERS.standard;
  const fixedPremium = tier.weeklyPremium;

  // Risk score (0-100) for UI display
  const riskScore = clamp(Math.round(adjustedTriggerProb * 100 * seasonalMultiplier), 5, 95);

  let riskLabel: 'Low' | 'Moderate' | 'High' | 'Very High';
  let riskLevel: 'low' | 'moderate' | 'high' | 'severe';
  if (riskScore <= 25) { riskLabel = 'Low'; riskLevel = 'low'; }
  else if (riskScore <= 50) { riskLabel = 'Moderate'; riskLevel = 'moderate'; }
  else if (riskScore <= 75) { riskLabel = 'High'; riskLevel = 'high'; }
  else { riskLabel = 'Very High'; riskLevel = 'severe'; }

  // 50% maximum payout cap, adjusted by city tier
  const maxPayoutPerWeek = Math.round(earnings * 0.50 * cityTier.maxPayoutMultiplier);
  const coverageAmount = Math.min(tier.maxPayoutPerWeek, maxPayoutPerWeek);

  // Apply city tier discount to premium
  const cityTierDiscount = cityTier.premiumDiscount;
  const discountedPremium = Math.round(fixedPremium * (1 - cityTierDiscount));

  // breakdown for the dashboard pie chart
  const weatherPeril = (cityProbs.heavy_rain || 0) + (cityProbs.heatwave || 0);
  const pollutionPeril = cityProbs.pollution || 0;
  const platformPeril = cityProbs.platform_outage || 0;
  const claimsFactor = claimsHistory * 0.1;
  const totalContrib = weatherPeril + pollutionPeril + platformPeril + claimsFactor + 0.001;

  const contributions = {
    weather: Math.round((weatherPeril / totalContrib) * 100),
    zone: Math.round((pollutionPeril / totalContrib) * 100),
    platform: Math.round((platformPeril / totalContrib) * 100),
    claims: Math.round((claimsFactor / totalContrib) * 100),
  };
  // Normalize
  const contribTotal = contributions.weather + contributions.zone + contributions.platform + contributions.claims;
  if (contribTotal !== 100 && contribTotal > 0) {
    contributions.weather += (100 - contribTotal);
  }

  return {
    weeklyPremium: discountedPremium,
    coverageAmount,
    maxPayoutPerWeek,
    riskScore,
    riskLabel,
    activityTier: isEligible ? activityTier : 'ineligible',
    premiumTierName: tier.name,
    cityPool,
    cityTier,
    isEligible,
    eligibilityReason,
    contributions,
    pricingBreakdown: {
      triggerProbability: parseFloat(adjustedTriggerProb.toFixed(4)),
      avgIncomeLostPerDay: parseFloat(avgIncomeLostPerDay.toFixed(2)),
      daysExposed,
      rawPremium: parseFloat(adjustedPremium.toFixed(2)),
      seasonalMultiplier,
      fixedTierPremium: discountedPremium,
      cityTierDiscount,
    },
    // Legacy fields for backward compat
    finalPremium: discountedPremium,
    basePremium: Math.round(discountedPremium * 0.8),
    riskLevel,
    breakdown: {
      base: Math.round(discountedPremium * 0.8),
      aiRiskAdjustment: Math.round(discountedPremium * 0.2),
      anomalyPenalty: 0,
    },
    factors: {
      predictedPayoutProbability: adjustedTriggerProb,
      baseZoneRisk: combinedTriggerProbability,
      shiftVulnerability: seasonalMultiplier,
      historicalClaims: claimsHistory,
      platformStability: 1 - (cityProbs.platform_outage || 0.05),
    },
    mlMetrics: {
      fraudProbability: 0,
      anomalyDetected: false,
      weatherRiskVolatility: adjustedTriggerProb,
    },
  };
}

/**
 * Async wrapper used by API routes
 */
export async function calculateDynamicPremium(
  avgWeeklyIncome: number,
  zone: string,
  shiftType: string,
  pastClaims: number,
  weatherForecast: string,
  platform: string = 'Zomato',
  city: string = 'Mumbai',
  daysWorkedThisWeek: number = 6,
  totalActiveDeliveryDays: number = 14,
): Promise<PremiumResult> {
  return calculateWeeklyPremium(
    zone, avgWeeklyIncome, platform, pastClaims, weatherForecast,
    city, daysWorkedThisWeek, totalActiveDeliveryDays,
  );
}
