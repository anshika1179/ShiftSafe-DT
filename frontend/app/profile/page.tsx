"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppState } from "@/frontend/components/providers/AppProvider";
import { safeReplace, safePush } from "@/lib/client/navigation";
export default function ProfilePage() {
  const router = useRouter();
  const { isLoggedIn, isBootstrapping, refreshSession } = useAppState();
  const [form, setForm] = useState({ name: "", platform: "Zomato", city: "", zone: "", avgWeeklyIncome: "", daysWorkedThisWeek: "", totalActiveDeliveryDays: "" });
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    if (isBootstrapping) return;
    if (!isLoggedIn) { safeReplace(router, "/login"); return; }
    let cancelled = false;
    fetch("/api/journey", { cache: "no-store" }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load profile");
      if (cancelled) return;
      const w = data.worker;
      setForm({ name: w.name, platform: w.platform, city: w.city, zone: w.zone, avgWeeklyIncome: String(w.avg_weekly_income), daysWorkedThisWeek: String(w.days_worked_this_week), totalActiveDeliveryDays: String(w.active_delivery_days) }); setLoaded(true);
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [isLoggedIn, isBootstrapping, router]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save profile");
      await refreshSession(); safePush(router, "/journey");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save profile"); }
    finally { setBusy(false); }
  }
  return <main className="max-w-lg mx-auto px-4 py-6 pb-28"><Link href="/journey" className="text-sm underline">Back to journey</Link><h1 className="text-2xl font-bold mt-5">Correct work details</h1><p className="text-sm text-gray-600 my-4">Saving restarts your review and marks the old quote as out of date. It does not modify any policy, payment, identity or contact details.</p>{error && <p role="alert" className="text-red-600 mb-4">{error}</p>}{!loaded ? <p>Loading profile...</p> : <form onSubmit={save} className="space-y-4"><label className="block text-sm">Platform<select value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })} className="block w-full mt-1 border rounded-xl p-3"><option>Zomato</option><option>Swiggy</option>{!["Zomato", "Swiggy"].includes(form.platform) && <option value={form.platform}>{form.platform} (legacy - choose food delivery)</option>}</select></label>{([ ["name", "Name"], ["city", "City"], ["zone", "Work area"], ["avgWeeklyIncome", "Actual weekly income (₹)"], ["daysWorkedThisWeek", "Days worked this week"], ["totalActiveDeliveryDays", "Lifetime active delivery days"] ] as const).map(([key, label]) => <label key={key} className="block text-sm">{label}<input required maxLength={80} type={key === "name" || key === "city" || key === "zone" ? "text" : "number"} min={0} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} className="block w-full mt-1 border rounded-xl p-3" /></label>)}<button disabled={busy} className="w-full bg-primary-500 text-white font-bold py-3 rounded-xl disabled:opacity-50">{busy ? "Saving..." : "Save corrected details"}</button></form>}</main>;
}
