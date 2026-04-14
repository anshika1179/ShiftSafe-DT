"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppState } from "@/frontend/components/providers/AppProvider";

const FEATURES = [
  {
    emoji: "⚡",
    title: "Parametric Engine",
    desc: "AI-driven triggers from 5 data sources detect disruptions in real-time — zero paperwork required.",
    color: "#f97316",
  },
  {
    emoji: "🤖",
    title: "Fraud Detection AI",
    desc: "Isolation Forest ML model scores every claim. GPS spoofing, duplicate claims, and anomaly detection built-in.",
    color: "#8b5cf6",
  },
  {
    emoji: "💰",
    title: "Instant UPI Payouts",
    desc: "Admin-reviewed claims settle via UPI in minutes — not days. Full audit trail from trigger to payout.",
    color: "#10b981",
  },
  {
    emoji: "📊",
    title: "Dynamic Pricing",
    desc: "5-factor ML-style pricing model calculates personalized weekly premiums — ₹10 to ₹40/week.",
    color: "#3b82f6",
  },
];

const STATS = [
  { value: "300M+", label: "Gig Workers in India" },
  { value: "<30min", label: "Avg. Claim SLA" },
  { value: "₹10–₹40", label: "Weekly Premium" },
  { value: "95%", label: "Fraud Catch Rate" },
];

const FAQS = [
  {
    q: "How do payouts work?",
    a: "Claims are automatically generated when parametric triggers fire. They go through AI fraud scoring, then admin review. Approved claims are paid instantly to your linked UPI.",
  },
  {
    q: "Which disruptions are covered?",
    a: "Heavy rain (>15mm/hr), extreme heat (>42°C), severe pollution (AQI >300), and platform outages (>60min). All verified via live data feeds.",
  },
  {
    q: "How is my premium calculated?",
    a: "Our 5-factor Dynamic Pricing Engine considers your zone risk, platform stability, weather history, claim history, and activity level — all transparent, no black boxes.",
  },
  {
    q: "What plans are available?",
    a: "Basic (80% coverage), Medium (default, 100%), and Pro (150%) tiers — tailored to your needs. Select during registration.",
  },
];

export default function SplashPage() {
  const router = useRouter();
  const { isLoggedIn, isBootstrapping } = useAppState();
  const [activeFeature, setActiveFeature] = useState(0);

  useEffect(() => {
    if (!isBootstrapping && isLoggedIn) {
      router.replace("/dashboard");
    }
  }, [isBootstrapping, isLoggedIn, router]);

  // auto-rotate features
  useEffect(() => {
    const timer = setInterval(() => setActiveFeature((p) => (p + 1) % FEATURES.length), 3500);
    return () => clearInterval(timer);
  }, []);

  if (isBootstrapping) {
    return (
      <div className="fixed inset-0 z-100 bg-slate-900 flex items-center justify-center">
        <div className="w-12 h-12 border-3 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-100 bg-slate-900 text-white overflow-y-auto fade-in">
      {/* Animated background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-primary-500/15 rounded-full blur-[120px] animate-float" />
        <div className="absolute bottom-[-15%] right-[-5%] w-[400px] h-[400px] bg-purple-500/10 rounded-full blur-[100px]" style={{ animationDelay: "1.5s", animationDuration: "7s" }} />
        <div className="absolute top-[40%] left-[60%] w-[300px] h-[300px] bg-emerald-500/8 rounded-full blur-[80px]" style={{ animationDelay: "3s", animationDuration: "9s" }} />
      </div>

      <div className="relative z-10 max-w-lg mx-auto px-5 pt-12 pb-8">
        {/* Logo & Title */}
        <div className="flex flex-col items-center mb-10">
          <div
            className="w-20 h-20 mb-6 rounded-3xl flex items-center justify-center text-4xl shadow-[0_10px_40px_rgba(249,115,22,0.4)] animate-float"
            style={{ background: "linear-gradient(135deg, #f97316, #ea580c)" }}
          >
            <span style={{ transform: "scale(1.1)" }}>🛡️</span>
          </div>

          <h1 className="text-4xl font-extrabold tracking-tight mb-3 text-center">
            Shift<span className="text-primary-500">Safe</span>{" "}
            <span className="text-slate-400 font-medium">DT</span>
          </h1>

          <p className="text-base text-slate-300 text-center max-w-xs leading-relaxed mb-4">
            AI-powered parametric income protection for India&apos;s{" "}
            <span className="font-semibold text-white">300M+ gig workers</span>
          </p>

          {/* AI badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-800/80 border border-slate-700 backdrop-blur-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">
              AI Risk Engine · Live
            </span>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-4 gap-2 mb-8">
          {STATS.map((s, i) => (
            <div key={i} className="text-center">
              <div className="text-lg font-extrabold text-white">{s.value}</div>
              <div className="text-[9px] text-slate-400 uppercase tracking-wider font-semibold leading-tight mt-0.5">
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {/* Feature Showcase (auto-rotating) */}
        <div className="mb-8">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 px-1">
            ✨ Why ShiftSafe DT
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {FEATURES.map((f, i) => (
              <button
                key={i}
                onClick={() => setActiveFeature(i)}
                className={`text-left p-4 rounded-2xl border transition-all duration-300 ${
                  activeFeature === i
                    ? "bg-slate-800/90 border-slate-600 shadow-lg shadow-slate-900/50 scale-[1.02]"
                    : "bg-slate-800/40 border-slate-700/50 hover:bg-slate-800/60"
                }`}
              >
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-lg mb-2.5"
                  style={{ background: `${f.color}15`, border: `1px solid ${f.color}30` }}
                >
                  {f.emoji}
                </div>
                <div className="text-xs font-bold text-white mb-1">{f.title}</div>
                <div className="text-[10px] text-slate-400 leading-snug line-clamp-2">{f.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* CTA Buttons */}
        <div className="space-y-3 mb-8">
          <button
            onClick={() => router.push("/register")}
            className="w-full py-4 rounded-xl text-lg font-bold bg-primary-500 text-white shadow-[0_8px_24px_rgba(249,115,22,0.4)] hover:bg-primary-600 active:scale-[0.98] transition-all flex items-center justify-center gap-2 group"
          >
            Get Protected Now
            <span className="group-hover:translate-x-1 transition-transform">→</span>
          </button>
          <button
            onClick={() => router.push("/login")}
            className="w-full py-3.5 rounded-xl text-base font-bold bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          >
            🔐 Login with OTP
          </button>
          <button
            onClick={() => router.push("/admin")}
            className="w-full py-3 rounded-xl text-sm font-bold text-slate-400 border border-slate-700/60 bg-slate-800/40 hover:bg-slate-800 hover:text-white hover:border-purple-500/40 active:scale-[0.98] transition-all flex items-center justify-center gap-2 group"
          >
            <span className="w-5 h-5 rounded-md bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-[10px]">
              👑
            </span>
            Admin / Insurer Login
            <span className="text-xs text-slate-500 group-hover:text-purple-400 transition-colors">→</span>
          </button>
        </div>

        {/* How it works mini-timeline */}
        <div className="mb-8">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 px-1">
            🔄 How It Works
          </div>
          <div className="space-y-2">
            {[
              { step: "1", icon: "📝", title: "Onboard", desc: "Select your delivery persona, city, and get an AI quote" },
              { step: "2", icon: "🛡️", title: "Activate", desc: "Pay as low as ₹10/week via UPI for instant coverage" },
              { step: "3", icon: "📡", title: "Monitor", desc: "Our 5-source parametric engine watches for disruptions 24/7" },
              { step: "4", icon: "💰", title: "Get Paid", desc: "Admin-reviewed claims settle to your UPI instantly" },
            ].map((s, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-slate-800/40 border border-slate-700/50">
                <div className="w-8 h-8 rounded-lg bg-primary-500/15 border border-primary-500/25 flex items-center justify-center text-sm shrink-0">
                  {s.icon}
                </div>
                <div>
                  <div className="text-xs font-bold text-white">{s.title}</div>
                  <div className="text-[10px] text-slate-400 leading-snug">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ Section */}
        <div className="mb-8">
          <h3 className="text-sm font-bold mb-3 text-center text-slate-300">
            Frequently Asked Questions
          </h3>
          <div className="space-y-2.5">
            {FAQS.map((faq, i) => (
              <details key={i} className="group">
                <summary className="cursor-pointer p-3.5 rounded-xl bg-slate-800/60 border border-slate-700 text-sm font-semibold text-primary-400 list-none flex items-center justify-between hover:bg-slate-800 transition-all">
                  {faq.q}
                  <span className="text-slate-500 group-open:rotate-180 transition-transform text-xs">▼</span>
                </summary>
                <div className="px-4 py-3 text-xs text-slate-400 leading-relaxed">
                  {faq.a}
                </div>
              </details>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center pb-4">
          <div className="text-[10px] text-slate-500">
            Built for Guidewire DEVTrails 2026 · ShiftSafe DT
          </div>
        </div>
      </div>
    </div>
  );
}
