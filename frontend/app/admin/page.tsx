'use client';
import { useState, useEffect } from 'react';
import { useAppState } from '@/frontend/components/providers/AppProvider';

export default function AdminDashboard() {
  const { claims, policy } = useAppState();
  const [mounted, setMounted] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (email === 'admin@shiftsafe.com' && password === 'admin123') {
      setIsAuthenticated(true);
      setError('');
    } else {
      setError('Invalid admin credentials. Use admin@shiftsafe.com / admin123');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 fade-in">
        <div className="glass-card p-6 w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3 border border-slate-200">
              <span className="text-3xl">⚙️</span>
            </div>
            <h1 className="text-xl font-bold text-slate-800">Admin Portal Access</h1>
            <p className="text-xs text-slate-500 mt-1">Authorized personnel only</p>
          </div>
          
          <form className="space-y-4" onSubmit={handleLogin}>
            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Admin Email</label>
              <input 
                type="email" 
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="admin@shiftsafe.com"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Security PIN</label>
              <input 
                type="password" 
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
              />
            </div>
            
            {error && <div className="text-xs text-red-500 font-bold bg-red-50 p-2 rounded">{error}</div>}
            
            <button type="submit" className="w-full btn btn-primary py-2.5 rounded-lg font-bold text-white shadow-md">
              Verify Access
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Mock Admin Stats
  const stats = [
    { label: 'Total Active Policies', value: '1,248', icon: '🛡️', trend: '+12% this week', color: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
    { label: 'Total Premium Collected', value: '₹1,56,000', icon: '💰', trend: '+5% this week', color: 'bg-blue-50 text-blue-600 border-blue-200' },
    { label: 'Total Claims Settled', value: '342', icon: '⚡', trend: '₹4,12,500 total', color: 'bg-orange-50 text-orange-600 border-orange-200' },
    { label: 'Fraud Flags (Review)', value: '14', icon: '🚨', trend: 'Requires attention', color: 'bg-red-50 text-red-600 border-red-200' },
  ];

  return (
    <div className="space-y-6 max-w-4xl mx-auto fade-in pb-8 px-4 sm:px-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <span>⚙️</span> Admin Center
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">Manage platform operations and metrics</p>
        </div>
        <div className="flex bg-slate-100 p-1 rounded-lg self-start sm:self-auto w-full sm:w-auto overflow-x-auto shrink-0">
          <button className="px-3 sm:px-4 py-1.5 rounded-md bg-white shadow-sm text-xs sm:text-sm font-bold text-slate-700 whitespace-nowrap">Overview</button>
          <button className="px-3 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-bold text-slate-500 hover:text-slate-700 whitespace-nowrap">Users</button>
          <button className="px-3 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-bold text-slate-500 hover:text-slate-700 whitespace-nowrap">Settings</button>
        </div>
      </div>

      {/* Top Metrics */}
      <div className="grid grid-cols-1 min-[400px]:grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map(s => (
          <div key={s.label} className={`border p-4 rounded-2xl ${s.color}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-2xl">{s.icon}</span>
            </div>
            <div className="text-2xl font-black">{s.value}</div>
            <div className="text-[10px] font-bold uppercase tracking-wide opacity-80 mt-1">{s.label}</div>
            <div className="text-[10px] mt-2 font-medium opacity-70">{s.trend}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* System Health */}
        <div className="col-span-1 glass-card p-5">
           <h3 className="font-bold text-slate-800 mb-4 uppercase text-xs tracking-widest">System Health</h3>
           <div className="space-y-4">
             <div className="flex items-center justify-between">
               <span className="text-sm text-slate-600">IMPS / UPI Gateway</span>
               <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-700 font-bold uppercase">Operational</span>
             </div>
             <div className="flex items-center justify-between">
               <span className="text-sm text-slate-600">Weather API Oracle</span>
               <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-700 font-bold uppercase">Operational</span>
             </div>
             <div className="flex items-center justify-between">
               <span className="text-sm text-slate-600">Fraud Engine</span>
               <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-700 font-bold uppercase">Operational</span>
             </div>
             <div className="flex items-center justify-between">
               <span className="text-sm text-slate-600">Push Notifications</span>
               <span className="px-2 py-0.5 rounded text-[10px] bg-orange-100 text-orange-700 font-bold uppercase">Degraded</span>
             </div>
           </div>
        </div>

        {/* Global Controls */}
        <div className="col-span-1 md:col-span-2 glass-card p-5">
          <h3 className="font-bold text-slate-800 mb-4 uppercase text-xs tracking-widest">Global Operations</h3>
          <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-4">
            <button className="p-3 border border-slate-200 rounded-lg bg-white hover:bg-red-50 hover:border-red-200 transition text-left group">
               <div className="text-lg mb-1">🌧️</div>
               <div className="font-bold text-sm text-slate-800 group-hover:text-red-700">Trigger Global Rain Event</div>
               <div className="text-[10px] text-slate-500 mt-1">Simulate widespread disruption</div>
            </button>
            <button className="p-3 border border-slate-200 rounded-lg bg-white hover:bg-orange-50 hover:border-orange-200 transition text-left group">
               <div className="text-lg mb-1">⏸️</div>
               <div className="font-bold text-sm text-slate-800 group-hover:text-orange-700">Suspend New Policies</div>
               <div className="text-[10px] text-slate-500 mt-1">Halt incoming registrations</div>
            </button>
            <button className="p-3 border border-slate-200 rounded-lg bg-white hover:bg-emerald-50 hover:border-emerald-200 transition text-left group">
               <div className="text-lg mb-1">💸</div>
               <div className="font-bold text-sm text-slate-800 group-hover:text-emerald-700">Approve Pending Claims</div>
               <div className="text-[10px] text-slate-500 mt-1">Force settlement for stuck claims</div>
            </button>
          </div>
        </div>
      </div>

      {/* Recent Activity Table */}
      <div className="glass-card p-5 overflow-hidden">
        <h3 className="font-bold text-slate-800 mb-4 uppercase text-xs tracking-widest">Recent Claim Activity</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] uppercase text-slate-500">
                <th className="pb-3 pr-4">Claim ID</th>
                <th className="pb-3 pr-4">User Details</th>
                <th className="pb-3 pr-4">Trigger</th>
                <th className="pb-3 pr-4">Amount</th>
                <th className="pb-3 pr-4">Score</th>
                <th className="pb-3">Status</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              <tr className="border-b border-slate-100 hover:bg-slate-50">
                <td className="py-3 pr-4 font-mono text-xs text-slate-600">CLM-A892B</td>
                <td className="py-3 pr-4">Ravi K. (+91-98**21)</td>
                <td className="py-3 pr-4">Heavy Rain (Mumbai)</td>
                <td className="py-3 pr-4 font-bold">₹1,250</td>
                <td className="py-3 pr-4"><span className="text-emerald-500 font-bold">95</span></td>
                <td className="py-3"><span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold uppercase">Settled</span></td>
              </tr>
              <tr className="border-b border-slate-100 hover:bg-slate-50">
                <td className="py-3 pr-4 font-mono text-xs text-slate-600">CLM-X102C</td>
                <td className="py-3 pr-4">Sunita (+91-87**33)</td>
                <td className="py-3 pr-4">Civil Unrest (Delhi)</td>
                <td className="py-3 pr-4 font-bold">₹800</td>
                <td className="py-3 pr-4"><span className="text-emerald-500 font-bold">92</span></td>
                <td className="py-3"><span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold uppercase">Settled</span></td>
              </tr>
              <tr className="border-b border-slate-100 hover:bg-slate-50">
                <td className="py-3 pr-4 font-mono text-xs text-slate-600">CLM-B441D</td>
                <td className="py-3 pr-4">Raj P. (+91-99**44)</td>
                <td className="py-3 pr-4">Platform Outage</td>
                <td className="py-3 pr-4 font-bold">₹2,100</td>
                <td className="py-3 pr-4"><span className="text-red-500 font-bold text-xs">22 ⚠️</span></td>
                <td className="py-3"><span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-[10px] font-bold uppercase">Review</span></td>
              </tr>
              {claims.slice(0,2).map(claim => (
                <tr key={claim.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-3 pr-4 font-mono text-xs text-slate-600">{claim.id.slice(0, 9).toUpperCase()}</td>
                  <td className="py-3 pr-4">Current User</td>
                  <td className="py-3 pr-4">{claim.triggerName}</td>
                  <td className="py-3 pr-4 font-bold">₹{claim.amount}</td>
                  <td className="py-3 pr-4"><span className="text-emerald-500 font-bold">{claim.fraudScore}</span></td>
                  <td className="py-3"><span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold uppercase">Settled</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
