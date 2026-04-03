'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppState } from '@/frontend/components/providers/AppProvider';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAppState();
  const [phone, setPhone] = useState('');
  const [policyKey, setPolicyKey] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = () => {
    setLoading(true);
    // Mock login simulating restoring a session
    setTimeout(() => {
      login(
        {
          id: `WRK-EXISTING`,
          name: 'Ravi Kumar (Demo)',
          phone: phone || '9876543210',
          platform: 'Zomato',
          zone: 'Andheri East',
          city: 'Mumbai',
          avgWeeklyEarnings: 4500,
          hoursPerDay: 8,
          upiId: 'ravi@upi',
        },
        {
          id: policyKey || `POL-EXISTING`,
          weeklyPremium: 45,
          coverageAmount: 1800,
          riskScore: 24,
          riskLabel: 'Low Risk',
          status: 'active',
          startDate: new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0],
          nextPaymentDue: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
          totalPremiumPaid: 90,
          contributions: { weather: 20, zone: 10, platform: 15, claims: 0 }
        }
      );
      router.push('/dashboard');
    }, 1500);
  };

  return (
    <div className="max-w-md mx-auto min-h-[75vh] flex flex-col items-center justify-center fade-in px-4">
      <div className="w-full">
        <div className="w-16 h-16 rounded-[1.25rem] mx-auto mb-6 flex items-center justify-center text-3xl shadow-lg bg-slate-800 border border-slate-700">
          <span style={{ transform: 'scale(1.1)' }}>🔐</span>
        </div>
        
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight mb-2">
            <span className="text-slate-900">Welcome </span>
            <span className="text-gradient-orange">Back</span>
          </h1>
          <p className="text-sm text-gray-600">Enter your key details to access your dashboard</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[11px] font-bold tracking-widest text-gray-500 uppercase mb-2">Mobile Number</label>
            <div className="relative flex items-stretch bg-white border border-slate-200 rounded-xl focus-within:border-orange-500 focus-within:ring-4 focus-within:ring-orange-500/10 transition-all overflow-hidden shadow-sm">
              <div className="flex items-center px-4 bg-slate-50 border-r border-slate-200">
                <span className="text-gray-700 font-bold tracking-wide">+91</span>
              </div>
              <input
                className="flex-1 px-4 text-lg py-4 outline-none text-slate-900 bg-transparent placeholder-slate-400 font-medium"
                placeholder="9876543210"
                value={phone}
                onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                type="tel"
                maxLength={10}
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold tracking-widest text-gray-500 uppercase mb-2">Policy Key / ID</label>
            <input
              className="w-full px-4 text-lg py-4 border border-slate-200 rounded-xl outline-none text-slate-900 bg-white placeholder-slate-400 font-medium focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all shadow-sm"
              placeholder="e.g. POL-12345"
              value={policyKey}
              onChange={e => setPolicyKey(e.target.value)}
              type="text"
            />
          </div>
        </div>

        <button
          onClick={handleLogin}
          disabled={phone.length < 10 || !policyKey.trim() || loading}
          className="btn btn-primary w-full text-lg font-bold py-4 rounded-xl mt-8 disabled:opacity-50"
        >
          {loading ? 'Authenticating...' : 'Login →'}
        </button>
        
        <div className="mt-6 text-center">
          <button onClick={() => router.push('/register')} className="text-sm text-primary-500 font-bold hover:underline">
            New user? Get started here
          </button>
        </div>
      </div>
    </div>
  );
}
