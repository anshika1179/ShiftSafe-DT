"use client";
import {useCallback,useEffect,useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {useAppState} from "../providers/AppProvider";
import {safeReplace} from "@/lib/client/navigation";
type Metrics={scope:string;asOf:string;live:{policyRecords:number;activeStatusRecords:number;claimRecords:number;paidPremiumRecorded:number;paidClaimsRecorded:number;lossRatio:number|null};sandbox:{policyRecords:number;claimRecords:number;reviewRecords:number;receiptRecords:number;premiumsSimulated:number;receiptsSimulated:number};limitations:string[]};
type View="dashboard"|"analytics"|"actuarial";
export default function RecordOverview({title="Account analytics",view="dashboard"}:{title?:string;view?:View}){
 const {isBootstrapping,isLoggedIn,worker}=useAppState(),router=useRouter(),[data,setData]=useState<Metrics|null>(null),[error,setError]=useState("");
 const load=useCallback(async()=>{try{const r=await fetch("/api/analytics",{cache:"no-store"}),b=await r.json();if(!r.ok)throw Error(b.error||"Could not load records");setData(b);setError("");}catch(e){setData(null);setError(e instanceof Error?e.message:"Could not load records");}},[]);
 useEffect(()=>{if(isBootstrapping)return;if(!isLoggedIn){safeReplace(router,"/login");return;}
 // Load persisted account metrics, not sample charts.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 void load();},[isLoggedIn,isBootstrapping,router,load]);

 const intro={dashboard:"Your account at a glance. This is a prototype: no active insurance, payment collection or payouts.",analytics:"Live and sandbox record counts for your account, kept separate.",actuarial:"Recorded premium and claim ratio, and what is not modelled."}[view];
 const links=[["/journey","Profile and historical quote"],["/sandbox","No-money sandbox"],["/monitoring","Modelled weather"],["/claims","Legacy claim records"],["/policies","Legacy policy records"],["/service-requests","Support"]];
 return <main className="p-3 pb-28 space-y-5"><h1 className="text-2xl font-bold">{title}</h1><p className="text-sm">{intro}</p>
 {view==="dashboard"&&worker&&<p>{worker.name} · {worker.platform} · {worker.zone}, {worker.city}<br/>Reported weekly income: ₹{worker.avgWeeklyEarnings}. Work details self-reported, not verified.</p>}
 {view==="dashboard"&&<div className="flex flex-wrap gap-3 text-sm">{links.map(([url,label])=><Link className="underline border rounded p-2" href={url} key={url}>{label}</Link>)}</div>}
 {!data&&!error&&<p>Loading persisted records...</p>}{error&&<p role="alert" className="text-red-700">{error}. No sample values substituted.</p>}
 {data&&<>
 {view==="dashboard"&&<section className="border rounded-xl p-4 space-y-2"><h2 className="font-bold">Summary</h2><p className="text-sm">{data.live.policyRecords} live policy record(s) and {data.live.claimRecords} claim record(s). Sandbox: {data.sandbox.policyRecords} policy, {data.sandbox.claimRecords} claim(s), {data.sandbox.receiptRecords} simulated receipt(s). Open Analytics for the full breakdown and Actuarial for the ratio.</p><div className="flex gap-3 text-sm"><Link className="underline" href="/analytics">Analytics</Link><Link className="underline" href="/actuarial">Actuarial</Link></div></section>}
 {view==="analytics"&&<><section className="border rounded-xl p-4 space-y-3"><h2 className="font-bold">Live ledger records (not proof of real cover)</h2><dl className="grid grid-cols-2 gap-3 text-sm"><dt>Policy records</dt><dd>{data.live.policyRecords}</dd><dt>Active-status records</dt><dd>{data.live.activeStatusRecords}</dd><dt>Claim records</dt><dd>{data.live.claimRecords}</dd></dl>{data.live.policyRecords===0&&<p className="text-sm">No live policy records on this account.</p>}</section>
 <section className="bg-amber-50 border rounded-xl p-4 space-y-3"><h2 className="font-bold">Sandbox only - no money</h2><dl className="grid grid-cols-2 text-sm gap-3"><dt>Sandbox policies</dt><dd>{data.sandbox.policyRecords}</dd><dt>Sandbox claims</dt><dd>{data.sandbox.claimRecords}</dd><dt>In review</dt><dd>{data.sandbox.reviewRecords}</dd><dt>Simulated receipts</dt><dd>{data.sandbox.receiptRecords}</dd></dl></section></>}
 {view==="actuarial"&&<><section className="border rounded-xl p-4 space-y-3"><h2 className="font-bold">Recorded ratio</h2><dl className="grid grid-cols-2 gap-3 text-sm"><dt>Premium marked paid</dt><dd>₹{data.live.paidPremiumRecorded}</dd><dt>Claims marked paid</dt><dd>₹{data.live.paidClaimsRecorded}</dd><dt>Recorded loss ratio</dt><dd>{data.live.lossRatio===null?"Insufficient data (no paid premium)":data.live.lossRatio.toFixed(3)}</dd><dt>Sandbox premium (simulated)</dt><dd>₹{data.sandbox.premiumsSimulated}</dd><dt>Sandbox receipts (simulated)</dt><dd>₹{data.sandbox.receiptsSimulated}</dd></dl></section><section className="border rounded-xl p-4"><h2 className="font-bold">Model status</h2><p className="text-sm">No trained fraud/loss model, confidence score or validated forecast. The historical weather quote is an explained proxy. Missing evidence stays in review.</p></section></>}
 {view!=="dashboard"&&<ul className="list-disc pl-5 text-sm">{data.limitations.map(text=><li key={text}>{text}</li>)}</ul>}
 <p className="text-xs text-gray-600">Source: persisted account ledger, all-time recorded statuses. Scope: {data.scope}. As of {data.asOf}.</p></>}
 <button className="underline" onClick={load}>Reload records</button></main>;
}
