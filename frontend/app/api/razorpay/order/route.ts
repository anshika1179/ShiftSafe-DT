// POST /api/razorpay/order — Create a Razorpay test order for premium payment
// This is a SANDBOX-ONLY implementation for hackathon demo
import { NextRequest, NextResponse } from "next/server";
import {
  consumeRateLimit,
  getClientIp,
  retryAfterSeconds,
} from "@/lib/server/rate-limit";

// Razorpay Test Mode keys (sandbox)
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "rzp_test_demo_key";
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "rzp_test_demo_secret";

interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt: string;
  created_at: number;
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rate = consumeRateLimit(`razorpay:${ip}`, 20, 10 * 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded", retryAfterSeconds: retryAfterSeconds(rate.resetAt) },
        { status: 429 },
      );
    }

    const body = await req.json();
    const amount = Math.max(100, Math.min(50000, Number(body?.amount || 0))); // Amount in paise
    const currency = "INR";
    const receipt = `rcpt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const notes = {
      workerId: String(body?.workerId || "demo"),
      policyId: String(body?.policyId || "demo"),
      type: String(body?.type || "weekly_premium"),
    };

    // Try real Razorpay API first
    if (RAZORPAY_KEY_ID !== "rzp_test_demo_key" && RAZORPAY_KEY_SECRET !== "rzp_test_demo_secret") {
      try {
        const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
        const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${auth}`,
          },
          body: JSON.stringify({
            amount: amount * 100, // Razorpay expects paise
            currency,
            receipt,
            notes,
          }),
        });

        if (rzpRes.ok) {
          const order = (await rzpRes.json()) as RazorpayOrder;
          return NextResponse.json({
            success: true,
            mode: "live",
            order: {
              id: order.id,
              amount: order.amount / 100,
              currency: order.currency,
              receipt,
            },
            razorpayKeyId: RAZORPAY_KEY_ID,
          });
        }
      } catch {
        // Fall through to sandbox mode
      }
    }

    // Sandbox/Demo mode — simulate order creation
    const sandboxOrderId = `order_demo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return NextResponse.json({
      success: true,
      mode: "sandbox",
      order: {
        id: sandboxOrderId,
        amount,
        currency,
        receipt,
        status: "created",
      },
      razorpayKeyId: RAZORPAY_KEY_ID === "rzp_test_demo_key" ? "rzp_test_ShiftSafe" : RAZORPAY_KEY_ID,
      notes,
      message: "🧪 Sandbox mode — no real charges. Use test cards for demo.",
      testCards: {
        success: "4111 1111 1111 1111",
        upi: "success@razorpay",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to create payment order" },
      { status: 500 },
    );
  }
}
