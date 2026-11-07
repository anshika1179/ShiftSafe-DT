import { NextRequest, NextResponse } from "next/server";
import { authorizeWorker } from "@/lib/server/authorization";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const auth = await authorizeWorker(req, body?.workerId);
    if (auth.response) return auth.response;
    return NextResponse.json({ error: "Premium payments are disabled until server pricing and payment verification are configured. No order was created." }, { status: 503 });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
