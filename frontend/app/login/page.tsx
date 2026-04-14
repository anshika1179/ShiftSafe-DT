"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppState } from "@/frontend/components/providers/AppProvider";

type LoginStep = "phone" | "otp";

export default function LoginPage() {
  const router = useRouter();
  const { isLoggedIn, isBootstrapping, refreshSession } = useAppState();

  const [step, setStep] = useState<LoginStep>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const isIndianPhoneValid = /^[6-9]\d{9}$/.test(phone);

  const demoOtpEnabled =
    process.env.NEXT_PUBLIC_SHOW_DEMO_OTP === "true" ||
    process.env.NODE_ENV !== "production";
  const demoOtpHint = process.env.NEXT_PUBLIC_DEMO_OTP_HINT || "123456";

  useEffect(() => {
    if (!isBootstrapping && isLoggedIn) {
      router.replace("/dashboard");
    }
  }, [isBootstrapping, isLoggedIn, router]);

  useEffect(() => {
    if (step === "otp") {
      otpRefs.current[0]?.focus();
    }
  }, [step]);

  const handleSendOtp = () => {
    if (!isIndianPhoneValid) {
      setError("Enter a valid Indian mobile number (starts with 6-9).");
      return;
    }
    setOtp(["", "", "", "", "", ""]);
    setError("");
    setStep("otp");
  };

  const verifyAndLogin = async (otpCode?: string) => {
    if (loading) return;

    const code = otpCode || otp.join("");
    if (!/^\d{6}$/.test(code)) {
      setError("Enter a valid 6-digit OTP.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, otp: code }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Unable to sign in. Please try again.");
        return;
      }

      await refreshSession();
      router.push("/dashboard");
    } catch {
      setError("Unable to sign in right now. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (value.length > 1) value = value.slice(-1);
    if (value && !/^\d$/.test(value)) return;

    const next = [...otp];
    next[index] = value;
    setOtp(next);
    setError("");

    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }

    if (next.every((digit) => digit !== "")) {
      void verifyAndLogin(next.join(""));
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  return (
    <div className="max-w-md mx-auto min-h-[75vh] flex flex-col items-center justify-center fade-in px-4">
      <div className="w-full">
        <div className="w-16 h-16 rounded-[1.25rem] mx-auto mb-6 flex items-center justify-center text-3xl shadow-lg bg-slate-800 border border-slate-700">
          <span style={{ transform: "scale(1.1)" }}>🔐</span>
        </div>

        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight mb-2">
            <span className="text-slate-900">Welcome </span>
            <span className="text-gradient-orange">Back</span>
          </h1>
          <p className="text-sm text-gray-600">
            Secure sign-in with mobile OTP
          </p>
        </div>

        {step === "phone" ? (
          <>
            <div>
              <label className="block text-[11px] font-bold tracking-widest text-gray-500 uppercase mb-2">
                Mobile Number
              </label>
              <div className="relative flex items-stretch bg-white border border-slate-200 rounded-xl focus-within:border-orange-500 focus-within:ring-4 focus-within:ring-orange-500/10 transition-all overflow-hidden shadow-sm">
                <div className="flex items-center px-4 bg-slate-50 border-r border-slate-200">
                  <span className="text-gray-700 font-bold tracking-wide">
                    +91
                  </span>
                </div>
                <input
                  className="flex-1 px-4 text-lg py-4 outline-none text-slate-900 bg-transparent placeholder-slate-400 font-medium"
                  placeholder="9876543210"
                  value={phone}
                  onChange={(e) => {
                    setError("");
                    setPhone(e.target.value.replace(/\D/g, "").slice(0, 10));
                  }}
                  type="tel"
                  maxLength={10}
                />
              </div>
            </div>

            {error && (
              <div className="text-xs text-red-500 font-medium mt-3">
                {error}
              </div>
            )}

            <button
              onClick={handleSendOtp}
              disabled={!isIndianPhoneValid}
              className="btn btn-primary w-full text-lg font-bold py-4 rounded-xl mt-8 disabled:opacity-50"
            >
              Send OTP →
            </button>
          </>
        ) : (
          <>
            <div className="text-center mb-4">
              <p className="text-sm text-gray-600">OTP sent to +91-{phone}</p>
            </div>

            <div className="flex justify-center gap-3 mb-4">
              {otp.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    otpRefs.current[i] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleOtpChange(i, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(i, e)}
                  className="w-12 h-14 text-center text-xl font-bold rounded-xl border border-slate-200 bg-white text-slate-900 outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all"
                />
              ))}
            </div>

            {demoOtpEnabled && (
              <div className="text-center mb-3">
                <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-600">
                  Demo OTP: <span className="font-mono">{demoOtpHint}</span>
                </span>
              </div>
            )}

            {error && (
              <div className="text-xs text-red-500 font-medium text-center mb-3">
                {error}
              </div>
            )}

            <button
              onClick={() => void verifyAndLogin()}
              disabled={loading || otp.some((digit) => !digit)}
              className="btn btn-primary w-full text-lg font-bold py-4 rounded-xl mt-2 disabled:opacity-50"
            >
              {loading ? "Signing in..." : "Verify & Login →"}
            </button>

            <button
              onClick={() => {
                setStep("phone");
                setOtp(["", "", "", "", "", ""]);
                setError("");
              }}
              className="btn btn-ghost w-full mt-4 text-sm"
            >
              ← Change Number
            </button>
          </>
        )}

        <div className="mt-6 text-center">
          <button
            onClick={() => router.push("/register")}
            className="text-sm text-primary-500 font-bold hover:underline"
          >
            New user? Get started here
          </button>
        </div>
      </div>
    </div>
  );
}
