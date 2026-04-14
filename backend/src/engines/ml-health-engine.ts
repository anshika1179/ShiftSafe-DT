import {
  classifyServiceRequest,
  detectFraudAdvanced,
  type FraudResult,
  type SRClassification,
} from "./fraud-engine";

export type MlRuntimeStatus = "operational" | "degraded";

export interface MlValidationCheck {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
}

export interface MlSelfTestSnapshot {
  status: MlRuntimeStatus;
  generatedAt: string;
  passRate: number;
  totalChecks: number;
  passedChecks: number;
  failedChecks: string[];
  checks: MlValidationCheck[];
  benchmarks: {
    fraud: {
      clean: Pick<FraudResult, "score" | "decision" | "flags" | "mlScore">;
      suspicious: Pick<FraudResult, "score" | "decision" | "flags" | "mlScore">;
      blocked: Pick<FraudResult, "score" | "decision" | "flags" | "mlScore">;
    };
    serviceRequest: Pick<
      SRClassification,
      | "urgencyScore"
      | "suggestedPriority"
      | "sentimentLabel"
      | "categoryConfidence"
      | "autoAction"
    >;
  };
}

function makeCheck(
  name: string,
  condition: boolean,
  expected: string,
  actual: string,
): MlValidationCheck {
  return {
    name,
    passed: Boolean(condition),
    expected,
    actual,
  };
}

export function runMlSelfTest(): MlSelfTestSnapshot {
  const clean = detectFraudAdvanced({
    distanceFromZone: 0.4,
    claimAlreadyToday: false,
    policyActive: true,
    claimAmount: 180,
    dailyAverage: 700,
    claimsLast30Days: 1,
    gpsAccuracyMeters: 12,
    travelSpeedKmph: 24,
    zoneRadiusKm: 5,
  });

  const suspicious = detectFraudAdvanced({
    distanceFromZone: 7,
    claimAlreadyToday: true,
    policyActive: true,
    claimAmount: 850,
    dailyAverage: 600,
    claimsLast30Days: 6,
    gpsAccuracyMeters: 180,
    travelSpeedKmph: 96,
    zoneRadiusKm: 5,
  });

  const blocked = detectFraudAdvanced({
    distanceFromZone: 11,
    claimAlreadyToday: true,
    policyActive: false,
    claimAmount: 1100,
    dailyAverage: 550,
    claimsLast30Days: 8,
    gpsAccuracyMeters: 240,
    travelSpeedKmph: 112,
    zoneRadiusKm: 5,
  });

  const sr = classifyServiceRequest(
    "Urgent payment not received",
    "My payout is not received for days. This is unacceptable and I need immediate help.",
    "payout_issue",
    1,
  );

  const checks: MlValidationCheck[] = [
    makeCheck(
      "fraud_clean_not_escalated",
      clean.decision === "CLEAN" || clean.decision === "LOW_RISK",
      "CLEAN or LOW_RISK",
      clean.decision,
    ),
    makeCheck(
      "fraud_suspicious_escalated",
      suspicious.decision === "REVIEW" || suspicious.decision === "BLOCKED",
      "REVIEW or BLOCKED",
      suspicious.decision,
    ),
    makeCheck(
      "fraud_policy_inactive_blocked",
      blocked.decision === "BLOCKED" &&
        blocked.flags.includes("RETROACTIVE_CLAIM"),
      "BLOCKED with RETROACTIVE_CLAIM flag",
      `${blocked.decision} / ${blocked.flags.join(",") || "no_flags"}`,
    ),
    makeCheck(
      "fraud_score_ordering",
      clean.score < suspicious.score && suspicious.score <= blocked.score,
      "clean < suspicious <= blocked",
      `${clean.score} < ${suspicious.score} <= ${blocked.score}`,
    ),
    makeCheck(
      "service_request_priority",
      (sr.suggestedPriority === "high" || sr.suggestedPriority === "urgent") &&
        sr.urgencyScore >= 40,
      "high or urgent with urgency >= 40",
      `${sr.suggestedPriority} / ${sr.urgencyScore}`,
    ),
    makeCheck(
      "service_request_sentiment",
      sr.sentimentLabel === "negative" || sr.sentimentLabel === "angry",
      "negative or angry",
      sr.sentimentLabel,
    ),
    makeCheck(
      "service_request_confidence",
      sr.categoryConfidence >= 0.34,
      "categoryConfidence >= 0.34",
      sr.categoryConfidence.toFixed(2),
    ),
  ];

  const passedChecks = checks.filter((check) => check.passed).length;
  const totalChecks = checks.length;
  const passRate =
    totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 0;
  const failedChecks = checks
    .filter((check) => !check.passed)
    .map((check) => check.name);

  return {
    status: failedChecks.length === 0 ? "operational" : "degraded",
    generatedAt: new Date().toISOString(),
    passRate,
    totalChecks,
    passedChecks,
    failedChecks,
    checks,
    benchmarks: {
      fraud: {
        clean: {
          score: clean.score,
          decision: clean.decision,
          flags: clean.flags,
          mlScore: clean.mlScore,
        },
        suspicious: {
          score: suspicious.score,
          decision: suspicious.decision,
          flags: suspicious.flags,
          mlScore: suspicious.mlScore,
        },
        blocked: {
          score: blocked.score,
          decision: blocked.decision,
          flags: blocked.flags,
          mlScore: blocked.mlScore,
        },
      },
      serviceRequest: {
        urgencyScore: sr.urgencyScore,
        suggestedPriority: sr.suggestedPriority,
        sentimentLabel: sr.sentimentLabel,
        categoryConfidence: sr.categoryConfidence,
        autoAction: sr.autoAction,
      },
    },
  };
}
