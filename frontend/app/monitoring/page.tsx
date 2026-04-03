'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAppState } from '@/frontend/components/providers/AppProvider';
import { triggerNotification, triggerToast } from '@/frontend/components/ui/Notifications';

export default function MonitoringPage() {
  const router = useRouter();
  const { worker, claims, simulateTrigger, isLoggedIn } = useAppState();
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!isLoggedIn) router.replace('/');
  }, [isLoggedIn, router]);

  const [screenshot, setScreenshot] = useState<string | null>(null);

  const dailyIncome = worker ? Math.round(worker.avgWeeklyEarnings / 7) : 1000;
  const hoursPerDay = worker?.hoursPerDay || 7;
  const avgIncomePerHour = parseFloat((dailyIncome / hoursPerDay).toFixed(2));
  const lostHours = 6;
  const calculatedClaim = Math.round(lostHours * avgIncomePerHour);

  const handleClaim = () => {
    setProcessing(true);
    triggerNotification({
      emoji: '🌍',
      title: 'Zone Disruption Claim',
      subtitle: `Disruption mapped correctly`,
      value: `₹${calculatedClaim} in process`,
      amount: calculatedClaim,
    });

    setTimeout(() => {
      const claim = simulateTrigger('zone_closure');
      // Override amount to match math
      claim.amount = calculatedClaim;
      claim.triggerName = 'Local Map Disruption';
      
      triggerToast(`₹${claim.amount} credited instantly via selected payout ✓`, 'success');
      setProcessing(false);
      setScreenshot(null);
    }, 2000);
  };

  const handleScreenshotChange = () => {
    setScreenshot('screenshot-evidence.jpg');
    triggerToast('Screenshot attached successfully');
  };

  return (
    <div className="space-y-4 max-w-[480px] mx-auto fade-in pb-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Live Monitoring</h1>
          <p className="text-sm text-gray-500">Real-time environmental data</p>
        </div>
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-100 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition">
          <span>🔄</span> Refresh
        </button>
      </div>

      {/* Location Banner */}
      <div className="bg-blue-50 border border-blue-100 p-3 rounded-lg flex items-center justify-between">
        <div className="text-xs text-blue-700 flex flex-wrap gap-1">
          <span>📍</span> 
          <span>Location verified:</span>
          <span className="font-bold">{worker?.zone || 'Mumbai'}</span>
          <span className="text-blue-500">— showing live data</span>
        </div>
        <span className="bg-orange-100 text-orange-600 px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0">Demo Mode</span>
      </div>

      {/* Disruption Alert */}
      <div className="bg-red-50 border border-red-200 p-3 rounded-lg flex gap-3 shadow-sm">
        <div className="text-red-500 text-xl">⚠️</div>
        <div className="flex-1">
          <div className="text-sm font-bold text-red-700">Active Disruption Detected: Heavy Rain</div>
          <div className="text-xs text-red-600 flex items-center gap-1 mt-0.5">
            <span className="w-3 h-3 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[8px]">✓</span> 
            You are eligible for compensation
          </div>
        </div>
      </div>

      {/* Metrics Grid */}
      <div>
        <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2 px-1">Live Conditions</div>
        <div className="grid grid-cols-2 gap-3">
          {/* Rainfall */}
          <div className="border border-red-200 bg-red-50/50 p-3 rounded-xl relative">
            <div className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <div className="text-xl mb-1">🌧️</div>
            <div className="text-[10px] font-bold text-gray-500 uppercase">Rainfall</div>
            <div className="text-xl font-black text-red-600">65 mm</div>
            <div className="text-[9px] text-red-500 font-bold mt-1">⚠️ Heavy Rain Detected</div>
          </div>
          {/* Temperature */}
          <div className="border border-slate-100 bg-white p-3 rounded-xl shadow-sm">
            <div className="text-xl mb-1">🌡️</div>
            <div className="text-[10px] font-bold text-gray-500 uppercase">Temperature</div>
            <div className="text-xl font-black text-slate-800">35°C</div>
            <div className="text-[9px] text-slate-500 mt-1">Humidity: 72%</div>
          </div>
          {/* AQI */}
          <div className="border border-slate-100 bg-white p-3 rounded-xl shadow-sm">
            <div className="text-xl mb-1">💨</div>
            <div className="text-[10px] font-bold text-gray-500 uppercase">AQI Level</div>
            <div className="text-xl font-black text-slate-800">26</div>
            <div className="text-[9px] text-emerald-500 font-bold mt-1">Good</div>
          </div>
          {/* Traffic */}
          <div className="border border-slate-100 bg-white p-3 rounded-xl shadow-sm">
            <div className="text-xl mb-1">🚦</div>
            <div className="text-[10px] font-bold text-gray-500 uppercase">Traffic Ratio</div>
            <div className="text-xl font-black text-slate-800">0.80</div>
            <div className="text-[9px] text-emerald-500 font-bold mt-1">Normal flow</div>
          </div>
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="h-48 relative bg-slate-200 w-full">
          {/* Simulated Map */}
          <iframe 
            src="https://maps.google.com/maps?q=Mumbai,+India&t=&z=12&ie=UTF8&iwloc=&output=embed" 
            width="100%" 
            height="100%" 
            style={{border:0}} 
            allowFullScreen={false} 
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade">
          </iframe>
          
          <div className="absolute top-2 right-2 bg-white/90 p-2 rounded-lg shadow-sm border border-slate-200">
             <div className="text-[10px] uppercase font-bold text-slate-500">Status</div>
             <div className="text-xs font-semibold text-amber-600 flex items-center gap-1">
               <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse"/>
               Disruption detected
             </div>
          </div>
        </div>
        
        <div className="p-4 bg-slate-800 text-white">
          <h3 className="font-bold text-lg mb-2">Claim Calculation Breakdown</h3>
          <div className="font-mono text-sm text-slate-300 space-y-1 bg-slate-900 border border-slate-700 p-3 rounded-lg">
            <div>Avg Daily Income (₹): <span className="text-white">{dailyIncome}</span></div>
            <div>Working Hours/Day: <span className="text-white">{hoursPerDay}</span></div>
            <div className="pb-1 border-b border-slate-700">Average Income/Hour: {dailyIncome}/{hoursPerDay}= <span className="text-white">₹{avgIncomePerHour}</span></div>
            <div className="pt-1 text-primary-400">Day claim: {lostHours} * Average Income/Hour = {lostHours} * {avgIncomePerHour} ~ ₹{calculatedClaim}</div>
            <div className="font-bold text-lg text-emerald-400 mt-1">Claim: ₹{calculatedClaim}</div>
          </div>
          
          <div className="mt-3 bg-slate-900 p-3 rounded-lg border border-slate-700">
             <div className="text-[10px] uppercase font-bold text-slate-400 mb-2">Evidence Required</div>
             {screenshot ? (
               <div className="p-2 bg-slate-800 rounded-md text-[10px] text-primary-300 flex items-center justify-between border border-slate-600">
                 <span>📷 {screenshot}</span>
                 <button onClick={() => setScreenshot(null)} className="text-red-400 font-bold text-xs p-1">✕</button>
               </div>
             ) : (
               <button 
                 onClick={handleScreenshotChange}
                 className="w-full border border-dashed border-slate-500 bg-slate-800 text-slate-300 py-3 rounded-lg text-xs hover:bg-slate-700 transition"
               >
                 + Upload Incident Screenshot
               </button>
             )}
          </div>

          <button 
            onClick={handleClaim}
            disabled={processing || !screenshot}
            className={`w-full mt-4 flex flex-col items-center justify-center py-3 rounded-xl font-bold transition-all text-white shadow-xl ${processing || !screenshot ? 'bg-slate-700 opacity-50 cursor-not-allowed border-none' : 'bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 border border-red-400'}`}
          >
            <div className="flex items-center gap-2 text-lg">
              <span>⚡</span> {processing ? 'Processing...' : 'File Disruption Claim'}
            </div>
            {!processing && <div className="text-[10px] font-medium opacity-90">✓ Disruption confirmed — instant payout eligible</div>}
          </button>
        </div>
      </div>
    </div>
  );
}
