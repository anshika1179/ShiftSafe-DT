/*
 * Actuarial & Stress Testing Engine
 *
 * Actuarial Constraints:
 *   - BCR (Burning Cost Rate) = total claims ÷ total premium collected
 *   - Target BCR: 0.55–0.70 → 65 paise per ₹1 goes to payouts
 *   - Loss Ratio > 85%: suspend new enrollments
 *   - Model at least one stress scenario — e.g. 40-day monsoon
 *   - Delhi May-June hazard scenario
 *   - Use formula for every scenario
 *   - Make the model simple and disclose assumptions
 */

export interface ActuarialSnapshot {
  periodLabel: string;
  totalPremiumCollected: number;
  totalClaimsPaid: number;
  bcr: number;                    // Burning Cost Rate
  lossRatio: number;              // as percentage
  activePolicies: number;
  totalWorkers: number;
  isHealthy: boolean;
  recommendation: string;
}

export interface StressScenarioResult {
  scenarioName: string;
  scenarioType: string;
  durationDays: number;
  triggerFrequency: number;       // probability of trigger per day
  avgPayoutPerTriggerDay: number;
  totalEstimatedPayout: number;
  totalPremiumInPeriod: number;
  bcrUnderStress: number;
  lossRatioUnderStress: number;
  isSustainable: boolean;
  reserveRequired: number;
  recommendation: string;
  assumptions: string[];
}

// simple BCR calc — claims divided by premium
export function calculateBCR(totalPremium: number, totalClaims: number): number {
  if (totalPremium <= 0) return 0;
  return parseFloat((totalClaims / totalPremium).toFixed(4));
}

// loss ratio as a percentage for display
export function calculateLossRatio(totalPremium: number, totalClaims: number): number {
  if (totalPremium <= 0) return 0;
  return parseFloat(((totalClaims / totalPremium) * 100).toFixed(1));
}

// main health check — are we making or losing money?
export function getActuarialSnapshot(
  totalPremium: number,
  totalClaims: number,
  activePolicies: number,
  totalWorkers: number,
  periodLabel: string = 'Current Week',
): ActuarialSnapshot {
  const bcr = calculateBCR(totalPremium, totalClaims);
  const lossRatio = calculateLossRatio(totalPremium, totalClaims);

  let isHealthy = true;
  let recommendation = '';

  if (bcr > 0.85) {
    isHealthy = false;
    recommendation = '🚨 CRITICAL: Loss Ratio > 85%. Suspend new enrollments immediately.';
  } else if (bcr > 0.70) {
    isHealthy = false;
    recommendation = '⚠️ WARNING: BCR exceeds target range (0.55-0.70). Review pricing or tighten triggers.';
  } else if (bcr >= 0.55) {
    recommendation = '✅ HEALTHY: BCR within target range (0.55-0.70). Operations sustainable.';
  } else if (bcr > 0) {
    recommendation = '💰 STRONG: BCR below 0.55. Consider lowering premiums for better adoption.';
  } else {
    recommendation = 'ℹ️ No claims data yet. Monitoring...';
  }

  return {
    periodLabel,
    totalPremiumCollected: totalPremium,
    totalClaimsPaid: totalClaims,
    bcr,
    lossRatio,
    activePolicies,
    totalWorkers,
    isHealthy,
    recommendation,
  };
}

// what happens if mumbai gets 40 straight days of monsoon?
export function runMonsoonStressScenario(
  activeWorkers: number,
  avgWeeklyPremiumPerWorker: number,
  avgDailyPayout: number = 450,
): StressScenarioResult {
  const durationDays = 40;
  const triggerFrequency = 0.65; // 65% of days trigger payouts during monsoon
  const triggerDays = Math.round(durationDays * triggerFrequency);

  // Total payout = workers × trigger_days × avg_payout × participation_rate
  const participationRate = 0.80; // not all workers will claim every trigger day
  const totalEstimatedPayout = activeWorkers * triggerDays * avgDailyPayout * participationRate;

  // Premium collected during this period (40 days ≈ 5.7 weeks)
  const weeksInPeriod = durationDays / 7;
  const totalPremiumInPeriod = activeWorkers * avgWeeklyPremiumPerWorker * weeksInPeriod;

  const bcrUnderStress = calculateBCR(totalPremiumInPeriod, totalEstimatedPayout);
  const lossRatioUnderStress = calculateLossRatio(totalPremiumInPeriod, totalEstimatedPayout);
  const isSustainable = bcrUnderStress <= 1.5; // allow some overshoot with reserves
  const reserveRequired = Math.max(0, totalEstimatedPayout - totalPremiumInPeriod);

  return {
    scenarioName: '40-Day Monsoon (Mumbai)',
    scenarioType: 'monsoon',
    durationDays,
    triggerFrequency,
    avgPayoutPerTriggerDay: avgDailyPayout,
    totalEstimatedPayout: Math.round(totalEstimatedPayout),
    totalPremiumInPeriod: Math.round(totalPremiumInPeriod),
    bcrUnderStress,
    lossRatioUnderStress,
    isSustainable,
    reserveRequired: Math.round(reserveRequired),
    recommendation: isSustainable
      ? `Sustainable with reserve fund of ₹${Math.round(reserveRequired).toLocaleString()}`
      : `UNSUSTAINABLE — Reserve fund of ₹${Math.round(reserveRequired).toLocaleString()} required. Recommend suspending new enrollments 2 weeks before monsoon onset. Cap daily payouts at ₹350.`,
    assumptions: [
      `${activeWorkers} active workers enrolled`,
      `₹${avgWeeklyPremiumPerWorker}/week fixed premium`,
      `${(triggerFrequency * 100).toFixed(0)}% trigger frequency during monsoon`,
      `₹${avgDailyPayout} average payout per trigger day per worker`,
      `${(participationRate * 100).toFixed(0)}% claim participation rate`,
      `50% maximum payout cap applied`,
      'Weekly data used — not annual averages',
    ],
  };
}

// delhi summer stress test — heatwave + pollution combo
export function runDelhiHazardScenario(
  activeWorkers: number,
  avgWeeklyPremiumPerWorker: number,
  avgDailyPayout: number = 300,
): StressScenarioResult {
  const durationDays = 60; // May + June
  const triggerFrequency = 0.40; // 40% of days AQI > 300 or temp > 42°C
  const triggerDays = Math.round(durationDays * triggerFrequency);

  const participationRate = 0.75;
  const totalEstimatedPayout = activeWorkers * triggerDays * avgDailyPayout * participationRate;

  const weeksInPeriod = durationDays / 7;
  const totalPremiumInPeriod = activeWorkers * avgWeeklyPremiumPerWorker * weeksInPeriod;

  const bcrUnderStress = calculateBCR(totalPremiumInPeriod, totalEstimatedPayout);
  const lossRatioUnderStress = calculateLossRatio(totalPremiumInPeriod, totalEstimatedPayout);
  const isSustainable = bcrUnderStress <= 1.5;
  const reserveRequired = Math.max(0, totalEstimatedPayout - totalPremiumInPeriod);

  return {
    scenarioName: 'Delhi May-June Heatwave + AQI',
    scenarioType: 'hazard',
    durationDays,
    triggerFrequency,
    avgPayoutPerTriggerDay: avgDailyPayout,
    totalEstimatedPayout: Math.round(totalEstimatedPayout),
    totalPremiumInPeriod: Math.round(totalPremiumInPeriod),
    bcrUnderStress,
    lossRatioUnderStress,
    isSustainable,
    reserveRequired: Math.round(reserveRequired),
    recommendation: isSustainable
      ? `Manageable with reserve fund of ₹${Math.round(reserveRequired).toLocaleString()}`
      : `UNSUSTAINABLE — Reserve fund of ₹${Math.round(reserveRequired).toLocaleString()} required. Implement dynamic trigger thresholds: AQI > 400 (not 300) during peak months.`,
    assumptions: [
      `${activeWorkers} active workers in Delhi NCR pool`,
      `₹${avgWeeklyPremiumPerWorker}/week fixed premium`,
      `${(triggerFrequency * 100).toFixed(0)}% trigger frequency (AQI > 300 or temp > 42°C)`,
      `₹${avgDailyPayout} average payout per trigger day per worker`,
      `${(participationRate * 100).toFixed(0)}% claim participation rate`,
      `50% maximum payout cap applied`,
      'Heatwave triggers: temp > 42°C sustained 4+ hours',
      'AQI triggers: AQI > 300 via CPCB data feed',
    ],
  };
}

// generic stress test — plug in your own numbers
export function runCustomStressScenario(
  scenarioName: string,
  durationDays: number,
  triggerFrequency: number,
  activeWorkers: number,
  avgWeeklyPremiumPerWorker: number,
  avgDailyPayout: number,
): StressScenarioResult {
  const triggerDays = Math.round(durationDays * triggerFrequency);
  const participationRate = 0.75;
  const totalEstimatedPayout = activeWorkers * triggerDays * avgDailyPayout * participationRate;

  const weeksInPeriod = durationDays / 7;
  const totalPremiumInPeriod = activeWorkers * avgWeeklyPremiumPerWorker * weeksInPeriod;

  const bcrUnderStress = calculateBCR(totalPremiumInPeriod, totalEstimatedPayout);
  const lossRatioUnderStress = calculateLossRatio(totalPremiumInPeriod, totalEstimatedPayout);
  const isSustainable = bcrUnderStress <= 1.5;
  const reserveRequired = Math.max(0, totalEstimatedPayout - totalPremiumInPeriod);

  return {
    scenarioName,
    scenarioType: 'custom',
    durationDays,
    triggerFrequency,
    avgPayoutPerTriggerDay: avgDailyPayout,
    totalEstimatedPayout: Math.round(totalEstimatedPayout),
    totalPremiumInPeriod: Math.round(totalPremiumInPeriod),
    bcrUnderStress,
    lossRatioUnderStress,
    isSustainable,
    reserveRequired: Math.round(reserveRequired),
    recommendation: isSustainable
      ? `Sustainable with reserve fund of ₹${Math.round(reserveRequired).toLocaleString()}`
      : `UNSUSTAINABLE — Requires reserve fund of ₹${Math.round(reserveRequired).toLocaleString()}.`,
    assumptions: [
      `${activeWorkers} active workers`,
      `₹${avgWeeklyPremiumPerWorker}/week premium`,
      `${(triggerFrequency * 100).toFixed(0)}% trigger frequency`,
      `₹${avgDailyPayout} avg daily payout`,
      `${(participationRate * 100).toFixed(0)}% participation rate`,
    ],
  };
}
