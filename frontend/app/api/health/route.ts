import { NextResponse } from "next/server";
import { getDb, getDbProvider } from "@/backend/models/db";


const isProduction = process.env.NODE_ENV === "production";

export async function GET() {
  const startedAt = Date.now();


  try {
    const db = getDb();
    await db.prepare("SELECT 1 as ok").get();

    return NextResponse.json({
      status: "ok",
      provider: getDbProvider(),
      database: "up",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      ml: {status:"unavailable",trainedModel:false,accuracy:null,reason:"No documented training dataset or holdout evaluation"},
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        status: "degraded",
        provider: getDbProvider(),
        database: "down",
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        ml: {status:"unavailable",trainedModel:false,accuracy:null,reason:"No documented training dataset or holdout evaluation"},
        ...(isProduction
          ? {}
          : {
              error: message,
              hint:
                getDbProvider() === "neon"
                  ? "Check DATABASE_URL reachability from this runtime and ensure outbound HTTPS is allowed."
                  : "Local SQLite fallback is active. Ensure .data path is writable.",
            }),
      },
      { status: 503 },
    );
  }
}
