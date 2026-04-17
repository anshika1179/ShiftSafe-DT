// POST /api/razorpay/order — Create a Razorpay order for premium payment
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/backend/models/db";
import {
  consumeRateLimit,
  getClientIp,
  retryAfterSeconds,
} from "@/lib/server/rate-limit";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rate = consumeRateLimit(`rzp_order:${ip}`, 20, 10 * 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json(
        {
          error: "Too many requests. Please try again later.",
          retryAfterSeconds: retryAfterSeconds(rate.resetAt),
        },
        { status: 429 },
      );
    }

    const body = await req.json();
    const { workerId, policyId, amount, description } = body;

    const sanitizedWorkerId = String(workerId || "").trim();
    const sanitizedPolicyId = String(policyId || "").trim();
    const safeAmount = Math.max(1, Math.min(50000, Number(amount) || 35));
    const safeDescription = String(description || "Weekly Premium Payment")
      .trim()
      .slice(0, 200);

    if (!sanitizedWorkerId) {
      return NextResponse.json(
        { error: "workerId is required" },
        { status: 400 },
      );
    }

    const rzpKeyId = process.env.RAZORPAY_KEY_ID;
    const rzpSecret = process.env.RAZORPAY_KEY_SECRET;

    if (!rzpKeyId || !rzpSecret) {
      return NextResponse.json(
        { error: "Payment gateway not configured. Contact admin." },
        { status: 503 },
      );
    }

    // Create a Razorpay Order via their Orders API
    const auth = Buffer.from(`${rzpKeyId}:${rzpSecret}`).toString("base64");
    const orderRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        amount: Math.round(safeAmount * 100), // Razorpay expects paise
        currency: "INR",
        receipt: `prem_${sanitizedWorkerId.slice(0, 8)}_${Date.now()}`,
        notes: {
          workerId: sanitizedWorkerId,
          policyId: sanitizedPolicyId,
          type: "weekly_premium",
          description: safeDescription,
        },
      }),
    });

    if (!orderRes.ok) {
      const errBody = await orderRes.text();
      console.error("Razorpay order creation failed:", errBody);
      return NextResponse.json(
        {
          error: "Unable to create payment order. Please try again.",
          details: process.env.NODE_ENV === "development" ? errBody : undefined,
        },
        { status: 502 },
      );
    }

    const orderData = await orderRes.json();

    // Record the payment attempt in the database
    const db = getDb();
    try {
      await db
        .prepare(
          `INSERT INTO premium_payments (id, worker_id, policy_id, razorpay_order_id, amount, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
        )
        .run(
          crypto.randomUUID(),
          sanitizedWorkerId,
          sanitizedPolicyId,
          orderData.id,
          safeAmount,
          "created",
        );
    } catch {
      // Table may not exist yet — best effort
    }

    return NextResponse.json({
      success: true,
      orderId: orderData.id,
      amount: safeAmount,
      currency: "INR",
      keyId: rzpKeyId, // Frontend needs this to initialize Checkout
      description: safeDescription,
    });
  } catch (err) {
    console.error("Razorpay order error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
