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
  city: string;
  zone: string;
  totalActiveDeliveryDays: number;   // lifetime active days
  daysWorkedThisWeek: number;        // current week activity
  daysActiveInLast30: number;        // monthly activity
  avgWeeklyIncome: number;
  vehicleType: string;
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

  // step 2: need at least 7 active days before we cover them
  steps.push('Activity history check');
  if (input.totalActiveDeliveryDays < 7) {
    return {
      eligible: false,
      reason: `Minimum 7 active delivery days required before coverage starts. Current: ${input.totalActiveDeliveryDays} days. Need ${7 - input.totalActiveDeliveryDays} more days.`,
      activityTier: 'ineligible',
      cityPool: getCityPool(input.city),
      recommendedPlan: 'None',
      weeklyPremium: 0,
      maxPayoutPerWeek: 0,
      warnings: [`${7 - input.totalActiveDeliveryDays} more active days needed for eligibility`],
      steps,
    };
  }

  // step 3: figure out which tier they fall into
  steps.push('Activity tier classification');
  const activityTier = classifyActivityTier(input.daysWorkedThisWeek, input.totalActiveDeliveryDays);

  // Workers with < 5 active days in last 30 → lower tier
  let adjustedTier = activityTier;
  if (input.daysActiveInLast30 < 5) {
    adjustedTier = 'basic';
    warnings.push('Low activity in last 30 days — assigned Basic tier');
  } else if (input.daysActiveInLast30 < 15) {
    if (adjustedTier === 'premium') adjustedTier = 'standard';
    warnings.push('Moderate activity — tier may be adjusted');
  }

  // step 4: assign their risk pool by city
  steps.push('City pool assignment');
  const cityPool = getCityPool(input.city);

  // step 5: match them with a plan
  steps.push('Plan recommendation');
  const tier = PREMIUM_TIERS[adjustedTier] || PREMIUM_TIERS.basic;
  const maxPayoutPerWeek = Math.round(input.avgWeeklyIncome * 0.50); // 50% max cap

  if (input.daysWorkedThisWeek < tier.minActivityDays) {
    warnings.push(`Current week activity (${input.daysWorkedThisWeek} days) is below tier requirement (${tier.minActivityDays} days). Coverage may be limited.`);
  }

  return {
    eligible: true,
    reason: `Eligible for ${tier.name}. ${input.totalActiveDeliveryDays} active days, ${input.daysWorkedThisWeek}/week.`,
    activityTier: adjustedTier as 'basic' | 'standard' | 'premium',
    cityPool,
    recommendedPlan: tier.name,
    weeklyPremium: tier.weeklyPremium,
    maxPayoutPerWeek: Math.min(tier.maxPayoutPerWeek, maxPayoutPerWeek),
    warnings,
    steps,
  };
}
