import { NextResponse } from "next/server";
import { getDb } from "@/backend/models/db";
import { runMlSelfTest } from "@/backend/engines/ml-health-engine";

interface ClaimMeta {
  fraudScore?: number;
}

interface ServiceRequestMeta {
  urgencyScore?: number;
  categoryConfidence?: number;
  sentimentLabel?: string;
  suggestedPriority?: string;
}

interface ClaimRow {
  evidence_data: string | null;
  status: string;
}

interface ServiceRequestRow {
  ai_metadata: string | null;
  priority: string;
  status: string;
}

function parseJsonObject<T extends object>(raw: string | null): T | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as T;
    }
    return null;
  } catch {
    return null;
  }
}

function safeAverage(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(2));
}

export async function GET() {
  const selfTest = runMlSelfTest();

  let claimRows: ClaimRow[] = [];
  let serviceRequestRows: ServiceRequestRow[] = [];
  let telemetryStatus: "operational" | "degraded" = "operational";
  let telemetryError: string | null = null;

  try {
    const db = getDb();

    claimRows = (await db
      .prepare(
        `SELECT evidence_data, status
         FROM claims
         WHERE created_at >= datetime('now', '-30 days')
         ORDER BY created_at DESC
         LIMIT 400`,
      )
      .all()) as ClaimRow[];

    serviceRequestRows = (await db
      .prepare(
        `SELECT ai_metadata, priority, status
         FROM service_requests
         WHERE created_at >= datetime('now', '-30 days')
         ORDER BY created_at DESC
         LIMIT 400`,
      )
      .all()) as ServiceRequestRow[];
  } catch (error) {
    telemetryStatus = "degraded";
    telemetryError = error instanceof Error ? error.message : String(error);
  }

  const fraudScores: number[] = [];
  let blockedClaims = 0;

  for (const row of claimRows) {
    if (String(row.status || "").toLowerCase() === "blocked") {
      blockedClaims += 1;
    }
    const meta = parseJsonObject<ClaimMeta>(row.evidence_data);
    if (meta && typeof meta.fraudScore === "number") {
      fraudScores.push(meta.fraudScore);
    }
  }

  const urgencyScores: number[] = [];
  const confidenceScores: number[] = [];
  const sentimentBreakdown: Record<string, number> = {
    positive: 0,
    neutral: 0,
    negative: 0,
    angry: 0,
    unknown: 0,
  };

  let aiClassifiedRequests = 0;
  let autoEscalatedPriority = 0;

  for (const row of serviceRequestRows) {
    const meta = parseJsonObject<ServiceRequestMeta>(row.ai_metadata);
    if (!meta) {
      continue;
    }

    aiClassifiedRequests += 1;

    if (typeof meta.urgencyScore === "number") {
      urgencyScores.push(meta.urgencyScore);
    }
    if (typeof meta.categoryConfidence === "number") {
      confidenceScores.push(meta.categoryConfidence * 100);
    }

    const sentiment = String(meta.sentimentLabel || "unknown").toLowerCase();
    if (sentiment in sentimentBreakdown) {
      sentimentBreakdown[sentiment] += 1;
    } else {
      sentimentBreakdown.unknown += 1;
    }

    const finalPriority = String(row.priority || "").toLowerCase();
    const suggestedPriority = String(
      meta.suggestedPriority || "",
    ).toLowerCase();
    if (
      (suggestedPriority === "high" || suggestedPriority === "urgent") &&
      (finalPriority === "high" || finalPriority === "urgent")
    ) {
      autoEscalatedPriority += 1;
    }
  }

  const claimScoringCoverage =
    claimRows.length > 0
      ? Number(((fraudScores.length / claimRows.length) * 100).toFixed(1))
      : 0;

  const requestClassificationCoverage =
    serviceRequestRows.length > 0
      ? Number(
          ((aiClassifiedRequests / serviceRequestRows.length) * 100).toFixed(1),
        )
      : 0;

  return NextResponse.json({
    status: selfTest.status,
    generatedAt: new Date().toISOString(),
    runtimeSelfTest: selfTest,
    telemetry: {
      status: telemetryStatus,
      error: telemetryError,
    },
    usage: {
      claims30d: {
        total: claimRows.length,
        scored: fraudScores.length,
        blocked: blockedClaims,
        blockedRate:
          claimRows.length > 0
            ? Number(((blockedClaims / claimRows.length) * 100).toFixed(1))
            : 0,
        averageFraudScore: safeAverage(fraudScores),
        scoringCoverage: claimScoringCoverage,
      },
      serviceRequests30d: {
        total: serviceRequestRows.length,
        classified: aiClassifiedRequests,
        classificationCoverage: requestClassificationCoverage,
        averageUrgencyScore: safeAverage(urgencyScores),
        averageCategoryConfidence: safeAverage(confidenceScores),
        autoEscalatedPriority,
        sentimentBreakdown,
      },
    },
  });
}
