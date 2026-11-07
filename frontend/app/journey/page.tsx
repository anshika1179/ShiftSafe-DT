"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppState } from "@/frontend/components/providers/AppProvider";
import { JOURNEY_STEPS, type JourneyStep } from "@/lib/shared/journey";
import { safeReplace } from "@/lib/client/navigation";

type Journey = {
  step: JourneyStep;
  worker: { name: string; platform: string; city: string; zone: string; avg_weekly_income: number; active_delivery_days: number; days_worked_this_week: number; insurance_opted_out: number };
  phoneVerified: boolean;
  eligibility: { eligible: boolean; reason: string; warnings?: string[]; insuranceOptedOut?: boolean } | null;
  consents: { gps_location: number; bank_upi: number; platform_activity: number; recorded_at: string } | null;
  quote: { weeklyPremium?: number; coverageAmount?: number; status: string; calculatedAt: string; reason?: string; inputs?:{weekdays:number[];startHour:number;endHour:number}; sample?:{expectedHours:number;validHours:number;thresholdHours:number;rainHours:number;heatHours:number}; historyWindow?:{start:string;end:string}; sourceUrl?:string; limitations?:string[]; calculation?:{thresholdHourFraction:number;hourlyIncome:number;expectedWeeklyProxyLoss:number}; assumptions?:{version:string} } | null;
  policy: { id: string; status: string } | null;
};
const LABELS = { profile: "Work profile", eligibility: "Eligibility", quote: "Quote", review: "Review", complete: "Complete" };
export default function JourneyPage() {
  const router = useRouter();
  const { isLoggedIn, isBootstrapping } = useAppState();
  const [data, setData] = useState<Journey | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [weekdays,setWeekdays]=useState<number[]>([]);
  const [startHour,setStartHour]=useState("");
  const [endHour,setEndHour]=useState("");
  async function calculateQuote() {
    setBusy(true);setError("");
    try{const r=await fetch("/api/quote",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({weekdays,startHour:startHour===""?null:Number(startHour),endHour:endHour===""?null:Number(endHour)})});const b=await r.json();if(!r.ok)throw Error(b.error||"Estimate failed");await load();}catch(e){setError(e instanceof Error?e.message:"Estimate failed");}finally{setBusy(false);}
  }
  const [view, setView] = useState<JourneyStep | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/journey", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load your journey");
      setData(body); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load your journey"); }
  }, []);
  useEffect(() => {
    if (isBootstrapping) return;
    if (!isLoggedIn) { safeReplace(router, "/login"); return; }
    // Load the account snapshot from the server when authentication settles.
    void load();
  }, [isBootstrapping, isLoggedIn, router, load]);
  async function advance() {
    if (!data) return;
    const next = JOURNEY_STEPS[JOURNEY_STEPS.indexOf(data.step) + 1];
    if (!next) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/journey", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: next }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save progress");
      setView(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save progress"); }
    finally { setBusy(false); }
  }
  if (isBootstrapping || (!data && !error)) return <div className="p-8 text-center">Loading your saved journey...</div>;
  if (!data) return <div className="p-8 text-center"><p role="alert">{error}</p><button onClick={load} className="mt-4 underline">Retry</button></div>;
  const step = view || (data.step === "complete" ? "review" : data.step);
  const index = JOURNEY_STEPS.indexOf(data.step);
  return <main className="max-w-lg mx-auto px-4 py-6 pb-28 space-y-5">
    <div className="flex items-center justify-between gap-4"><h1 className="text-2xl font-bold">Your protection journey</h1><Link href="/dashboard" className="text-sm underline">Dashboard</Link></div>
    <p className="text-sm text-gray-600">Saved to your account. Return to this page to resume or review your profile.</p>
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Prototype only. Reviewing a quote does not buy insurance or activate cover. Payments, claims and payouts remain disabled.</div>
    <nav aria-label="Journey progress" className="flex flex-wrap gap-2">{JOURNEY_STEPS.filter(s => s !== "complete").map((s, i) => <button key={s} disabled={i > index} onClick={() => setView(s)} aria-current={step === s ? "step" : undefined} className={`rounded-lg px-3 py-2 text-sm border ${step === s ? "bg-primary-500 text-white" : "bg-white"} disabled:opacity-40`}>{i + 1}. {LABELS[s]}</button>)}</nav>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
      <h2 className="text-xl font-bold">{LABELS[step]}</h2>
      {step === "profile" && <><dl className="grid grid-cols-2 gap-3 text-sm"><dt>Name</dt><dd>{data.worker.name}</dd><dt>Platform</dt><dd>{data.worker.platform}</dd><dt>Area</dt><dd>{data.worker.zone}, {data.worker.city}</dd><dt>Reported weekly income</dt><dd>₹{data.worker.avg_weekly_income.toLocaleString("en-IN")}</dd><dt>Reported days this week</dt><dd>{data.worker.days_worked_this_week}</dd><dt>Lifetime delivery days</dt><dd>{data.worker.active_delivery_days}</dd><dt>Contact phone</dt><dd>{data.phoneVerified ? "Verified" : "Not verified"}</dd></dl><p className="text-xs text-gray-500">Work details are self-reported, not platform-verified. Contact phone is separate from your Google sign-in identity.</p><Link href="/profile" className="inline-block text-sm underline">Correct work details</Link></>}
      {step === "eligibility" && <><p>{data.worker.insurance_opted_out ? "You chose not to request insurance." : data.eligibility ? data.eligibility.reason : "No saved eligibility assessment is available for this existing account. We will not infer eligibility from a policy record."}</p>{data.eligibility?.warnings?.length ? <ul className="list-disc pl-5 text-sm">{data.eligibility.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul> : null}<p className="text-sm text-amber-800">This is a prototype check only. Government scheme eligibility and insurer underwriting are not verified, and recorded consents are not proof of legal compliance.</p><p className="text-sm">Recorded consents: {data.consents ? `location ${data.consents.gps_location ? "yes" : "no"}, payout data ${data.consents.bank_upi ? "yes" : "no"}, platform activity ${data.consents.platform_activity ? "yes" : "no"}` : "not available"}.</p></>}
      {step === "quote" && <>
        <p className="text-sm">Historical weather proxy estimate, not an insurance price. Uses your saved income and city. No city-tier premium or invented loss history.</p>
        <fieldset className="space-y-3"><legend className="font-semibold">Your actual usual work schedule (IST)</legend><p className="text-sm">One same-day hour window for these weekdays. If shifts vary or cross midnight, this model cannot represent them accurately.</p><div className="flex flex-wrap gap-3">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((day,i)=><label key={day} className="flex gap-1 items-center"><input type="checkbox" checked={weekdays.includes(i)} onChange={e=>setWeekdays(e.target.checked?[...weekdays,i]:weekdays.filter(d=>d!==i))}/>{day}</label>)}</div><div className="grid grid-cols-2 gap-3"><label>Start hour (0-23)<input className="border rounded w-full p-2" type="number" min="0" max="23" value={startHour} onChange={e=>setStartHour(e.target.value)}/></label><label>End hour (1-24)<input className="border rounded w-full p-2" type="number" min="1" max="24" value={endHour} onChange={e=>setEndHour(e.target.value)}/></label></div><button disabled={busy} className="rounded bg-slate-800 text-white px-4 py-2 disabled:opacity-50" onClick={calculateQuote}>{busy?"Calculating...":"Calculate historical estimate"}</button></fieldset>
        {data.quote?.status==="estimated" ? <>
          <dl className="grid grid-cols-2 gap-3 text-sm"><dt>Illustrative weekly estimate</dt><dd>₹{data.quote.weeklyPremium}</dd><dt>Configured weekly limit</dt><dd>₹{data.quote.coverageAmount}</dd><dt>Historical window</dt><dd>{data.quote.historyWindow?.start} to {data.quote.historyWindow?.end}</dd><dt>Valid scheduled hours</dt><dd>{data.quote.sample?.validHours} / {data.quote.sample?.expectedHours}</dd><dt>Threshold hours (union)</dt><dd>{data.quote.sample?.thresholdHours}</dd><dt>Rain / heat hours</dt><dd>{data.quote.sample?.rainHours} / {data.quote.sample?.heatHours}</dd><dt>Threshold-hour fraction</dt><dd>{((data.quote.calculation?.thresholdHourFraction||0)*100).toFixed(3)}%</dd><dt>Schedule used (IST)</dt><dd>{data.quote.inputs?.weekdays.map(d=>["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d]).join(", ")} {data.quote.inputs?.startHour}:00-{data.quote.inputs?.endHour}:00</dd></dl>
          <p className="text-xs text-gray-600">Saved {data.quote.calculatedAt} UTC. {data.quote.assumptions?.version}. ERA5 via Open-Meteo / Copernicus. Zero threshold hours means zero for this limited proxy, not zero risk.</p>
          <p className="text-sm">Formula: scheduled threshold-hour fraction × reported weekly income × 50% loss assumption × 1.15 expense loading. Weekly limit = 50% of reported income. Rain ≥ 30 mm over preceding hour or temperature ≥ 42°C. Neither threshold is a legal/insurer rule.</p>
          <ul className="list-disc pl-5 text-sm space-y-2">{data.quote.limitations?.map(text=><li key={text}>{text}</li>)}</ul>
          {data.quote.sourceUrl && <a className="text-sm underline" href={data.quote.sourceUrl} target="_blank" rel="noreferrer">Inspect original historical dataset</a>}
        </> : <p role="status" className="text-sm text-amber-800">{data.quote?.reason||"No historical estimate saved. Enter your schedule to calculate. Old fixed-tier quotes are not current estimates."} You may finish review without an estimate or buying cover.</p>}
      </>}
      {step === "review" && <><p>You have reviewed your work profile, eligibility record and any saved quote.</p><p className="text-sm text-gray-600">{data.policy ? `Existing policy record status: ${data.policy.status}.` : "There is no policy record on this account."} Completing this review does not change that status, charge money or activate cover.</p>{data.step === "complete" && <p className="text-sm text-green-700">Review complete. Your progress is saved.</p>}</>}
    </section>
    {error && <p role="alert" className="text-red-600 text-sm">{error}</p>}
    {data.step !== "complete" && step === data.step ? <button disabled={busy} onClick={advance} className="w-full rounded-xl bg-primary-500 py-3 font-bold text-white disabled:opacity-50">{busy ? "Saving..." : data.step === "review" ? "Finish review - no payment" : "Save and continue"}</button> : <button onClick={() => setView(null)} className="text-sm underline">{data.step === "complete" ? "Return to review" : "Resume current step"}</button>}
    <Link href="/sandbox" className="block rounded-xl border border-slate-300 p-3 text-center text-sm">Open separate no-money sandbox</Link>
    {data.step === "complete" && <Link href="/dashboard" className="block rounded-xl bg-primary-500 py-3 text-center font-bold text-white">Open dashboard</Link>}
  </main>;
}
