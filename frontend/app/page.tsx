'use client';
import { useRouter } from 'next/navigation';

export default function SplashPage() {
  const router = useRouter();

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900 flex flex-col items-center justify-center p-6 text-white overflow-hidden fade-in">
      {/* Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-primary-500/20 rounded-full blur-[100px] pointer-events-none" />
      
      <div className="relative z-10 flex flex-col items-center flex-1 justify-center w-full max-w-sm mx-auto">
        {/* Logo */}
        <div className="w-24 h-24 mb-8 rounded-[2rem] flex items-center justify-center text-5xl shadow-[0_10px_40px_rgba(249,115,22,0.4)] animate-float"
          style={{ background: 'linear-gradient(135deg, #f97316, #ea580c)' }}>
          <span style={{ transform: 'scale(1.1)' }}>🛡️</span>
        </div>
        
        <h1 className="text-4xl font-extrabold tracking-tight mb-4 text-center">
          Shift<span className="text-primary-500">Safe</span> <span className="text-slate-400 font-medium">DT</span>
        </h1>
        
        <p className="text-lg text-slate-300 text-center mb-12 max-w-[280px] leading-relaxed">
          Zero paperwork.<br />
          <span className="font-semibold text-white">Instant payouts.</span>
        </p>

        {/* AI Powered Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-800 border border-slate-700 mb-12">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">AI-Powered Risk Engine</span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="relative z-10 w-full max-w-sm pb-8 flex flex-col gap-3">
        <button
          onClick={() => router.push('/register')}
          className="w-full py-4 rounded-xl text-lg font-bold bg-primary-500 text-white shadow-[0_8px_20px_rgba(249,115,22,0.4)] hover:bg-primary-600 active:scale-[0.98] transition-all flex items-center justify-center gap-2 group"
        >
          Get Started
          <span className="group-hover:translate-x-1 transition-transform">→</span>
        </button>
        <button
          onClick={() => router.push('/login')}
          className="w-full py-3 rounded-xl text-base font-bold bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white active:scale-[0.98] transition-all flex items-center justify-center gap-2"
        >
          Login with Policy Key
        </button>
      </div>

      {/* FAQ Section */}
      <div className="relative z-10 w-full max-w-sm pb-8">
        <h3 className="text-lg font-bold mb-4 text-center">Frequently Asked Questions</h3>
        <div className="space-y-3">
          <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700">
            <h4 className="font-semibold text-sm mb-1 text-primary-400">How do payouts work?</h4>
            <p className="text-xs text-slate-400 leading-relaxed">Claims are paid instantly and automatically to your linked UPI or Bank Account when parametric triggers are met.</p>
          </div>
          <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700">
            <h4 className="font-semibold text-sm mb-1 text-primary-400">Which plans cover me?</h4>
            <p className="text-xs text-slate-400 leading-relaxed">We offer Basic, Medium, and Pro tiers tailored to your coverage needs. You select this during profile setup.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
