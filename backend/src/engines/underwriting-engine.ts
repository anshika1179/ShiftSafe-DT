/*
 * Underwriting Engine — Who Gets Covered
 *
 * Underwriting Core Algorithms:
 *   - Active gig worker on Zomato / Swiggy / Zepto / Blinkit / Amazon Flex
 *   - Minimum 7 active delivery days before cover starts
 *   - City-based pools — Delhi AQI pool ≠ Mumbai rain pool
 *   - Workers with < 5 active days in 30 → lower tier
 *   - Keep underwriting and onboarding under 4-5 steps
 */

import { classifyActivityTier, getCityPool, PREMIUM_TIERS } from './premium-engine';

export interface UnderwritingInput {
  platform: string;
  isMultiApping: boolean; // e.g., working for Swiggy and Zomato
  city: string;
  zone: string;
  totalActiveDeliveryDays: number;   // lifetime active days
  daysWorkedThisWeek: number;        // current week activity
  daysActiveInLast30: number;        // monthly activity
  avgWeeklyIncome: number;
  vehicleType: string;
  // SS Code & DPDP Act 2023 Compliance
  dpdpConsents: {
    gpsLocation: boolean;   // Separate consent screen required
    bankUpi: boolean;       // Explicit consent + KYC
    platformActivity: boolean; // Data sharing agreement
  };
}

export interface UnderwritingResult {
  eligible: boolean;
  reason: string;
  activityTier: 'basic' | 'standard' | 'premium' | 'ineligible';
  cityPool: string;
  recommendedPlan: string;
  weeklyPremium: number;
  maxPayoutPerWeek: number;
  warnings: string[];
  steps: string[];
}

const ALLOWED_PLATFORMS = ['Zomato', 'Swiggy', 'Amazon Flex', 'Blinkit', 'Zepto'];

export function underwriteWorker(input: UnderwritingInput): UnderwritingResult {
  const warnings: string[] = [];
  const steps: string[] = [];

  // DPDP Act 2023 Compliance Checks
  steps.push('DPDP Act 2023 Consent Verification');
  if (!input.dpdpConsents.gpsLocation || !input.dpdpConsents.bankUpi || !input.dpdpConsents.platformActivity) {
    return {
      eligible: false,
      reason: `Missing DPDP Act 2023 Consents. GPS, Bank, and Platform Activity tracking must be explicitly approved.`,
      activityTier: 'ineligible',
      cityPool: getCityPool(input.city),
      recommendedPlan: 'None',
      weeklyPremium: 0,
      maxPayoutPerWeek: 0,
      warnings: ['DPDP Act Consents Missing'],
      steps,
    };
  }

  // step 1: make sure they're on a supported platform
  steps.push('Platform verification');
  if (!ALLOWED_PLATFORMS.includes(input.platform)) {
    return {
      eligible: false,
      reason: `Platform "${input.platform}" is not supported. Supported: ${ALLOWED_PLATFORMS.join(', ')}`,
      activityTier: 'ineligible',
      cityPool: getCityPool(input.city),
      recommendedPlan: 'None',
      weeklyPremium: 0,
      maxPayoutPerWeek: 0,
      warnings: ['Unsupported gig platform'],
      steps,
    };
  }

  // Social Security Code 2020: 90/120-Day Engagement Rule
  steps.push('Social Security Code 2020 Eligibility');
  const requiredDays = input.isMultiApping ? 120 : 90;
  if (input.totalActiveDeliveryDays < requiredDays) {
    return {
      eligible: false,
      reason: `SS Code 2020 requires ${requiredDays} active days. Current: ${input.totalActiveDeliveryDays} days. Need ${requiredDays - input.totalActiveDeliveryDays} more days.`,
      activityTier: 'ineligible',
      cityPool: getCityPool(input.city),
      recommendedPlan: 'None',
      weeklyPremium: 0,
      maxPayoutPerWeek: 0,
      warnings: [`${requiredDays - input.totalActiveDeliveryDays} more active days needed for State ID eligibility`],
      steps,
    };
  }

  // step 3: figure out which tier they fall into
  steps.push('Activity tier classification');
  const activityTier = classifyActivityTier(input.daysWorkedThisWeek, input.totalActiveDeliveryDays);

  // Workers with < 15 active days in last 30 → lower tier
  let adjustedTier = activityTier;
  if (input.daysActiveInLast30 < 15) {
    adjustedTier = 'basic';
    warnings.push('Low activity in last 30 days — assigned Basic tier');
  } else if (input.daysActiveInLast30 < 22) {
    if (adjustedTier === 'premium') adjustedTier = 'standard';
    warnings.push('Moderate activity — tier may be adjusted');
  }

  // step 4: assign their risk pool by city
  steps.push('City pool assignment');
  const cityPool = getCityPool(input.city);

  // step 5: match them with a plan
  steps.push('Plan recommendation');
  const tier = PREMIUM_TIERS[adjustedTier as keyof typeof PREMIUM_TIERS] || PREMIUM_TIERS.basic;
  const maxPayoutPerWeek = Math.round(input.avgWeeklyIncome * 0.50); // 50% max cap

  if (input.daysWorkedThisWeek < tier.minActivityDays) {
    warnings.push(`Current week activity (${input.daysWorkedThisWeek} days) is below tier requirement (${tier.minActivityDays} days). Coverage may be limited.`);
  }

  return {
    eligible: true,
    reason: `SS Code 2020 Eligible! Covered for ${tier.name}. ${input.totalActiveDeliveryDays} active days logged.`,
    activityTier: adjustedTier as 'basic' | 'standard' | 'premium',
    cityPool,
    recommendedPlan: tier.name,
    weeklyPremium: tier.weeklyPremium,
    maxPayoutPerWeek: Math.min(tier.maxPayoutPerWeek, maxPayoutPerWeek),
    warnings,
    steps,
  };
}
