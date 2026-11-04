"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {useAppState} from "../providers/AppProvider";
import {safeReplace} from "@/lib/client/navigation";
export default function LegacyRecords({kind}:{kind:"claims"|"policies"}){
 const {worker,isLoggedIn,isBootstrapping}=useAppState(),router=useRouter(),[rows,setRows]=useState<Record<string,string|number>[]>([]),[error,setError]=useState(""),[loaded,setLoaded]=useState(false);
 useEffect(()=>{if(isBootstrapping)return;if(!isLoggedIn){safeReplace(router,"/login");return;}let active=true;
 fetch(`/api/${kind}?workerId=${encodeURIComponent(worker?.id||"")}`,{cache:"no-store"}).then(async r=>{const b=await r.json();if(!r.ok)throw Error(b.error||"Record load failed");if(active){setRows(b[kind]||[]);setLoaded(true);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[worker?.id,isLoggedIn,isBootstrapping,kind,router]);
 return <div className="space-y-4 p-3 pb-24"><h1 className="text-2xl font-bold">Legacy {kind} records</h1><p className="text-sm">Read-only stored records. Status labels and amounts do not prove real insurance or a bank transfer. Payments, activation and payout approval are disabled.</p><Link className="underline" href="/sandbox">Try the separate no-money sandbox</Link>{error&&<p role="alert">{error}. No samples substituted.</p>}{!loaded&&!error&&<p>Loading...</p>}{loaded&&!rows.length&&<p>No {kind} records on this account.</p>}{rows.map(r=><article className="border rounded-xl p-4 space-y-2 text-sm" key={r.id}><p className="break-all">ID: {r.id}</p><p>Stored status: {r.status}</p>{kind==="claims"?<><p>Stored amount: ₹{r.amount}</p><p>Trigger: {r.trigger_type}</p><p>No validated fraud assessment is available.</p></>:<><p>Policy face premium: ₹{r.weekly_premium} (not a payment)</p><p>Policy face weekly limit: ₹{r.max_coverage_per_week} (not active cover)</p></>}<p>Created: {r.created_at}</p></article>)}<p className="text-xs">For a correction or opt-out, open Profile or Support. No receipt or invented payment reference is generated here.</p><Link className="underline" href="/dashboard">Back to account records</Link></div>;
}
