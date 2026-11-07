import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getCronSecret } from "@/lib/server/env";

export async function GET(req: Request) {
  try {
    const expected = Buffer.from(getCronSecret());
    const provided = Buffer.from(req.headers.get("authorization")?.replace(/^Bearer /, "") || "");
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Automated claim ingestion is disabled until event evidence and settlement controls are verified. No financial changes made." }, { status: 503 });
  } catch {
    return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  }
}
