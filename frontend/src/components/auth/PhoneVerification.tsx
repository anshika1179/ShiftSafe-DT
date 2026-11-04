"use client";
import { useState } from "react";
export default function PhoneVerification({ phone, registrationProof, onVerified }: { phone: string; registrationProof: string; onVerified: (proof: string) => void }) {
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(check: boolean) {
    setBusy(true); setMessage("");
    try {
      const res = await fetch(`/api/phone/${check ? "verify" : "request"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, registrationProof, challenge, code }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Phone verification unavailable");
      if (check) { onVerified(data.phoneProof); setMessage("Phone number verified by SMS. This does not verify delivery work or insurance eligibility."); }
      else { setChallenge(data.challenge); setMessage(data.message); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Phone verification unavailable"); }
    finally { setBusy(false); }
  }
  return <details className="mt-4 border border-slate-200 rounded-xl p-3"><summary className="text-xs font-semibold text-gray-600 cursor-pointer">Optional: SMS code check (trial demo, not needed to continue)</summary><div className="mt-3 space-y-3">
    <p className="text-xs text-gray-600">Phone trial verification: Twilio 30-day demo is limited to five approved tester numbers. Google remains your account sign-in. No automatic paid upgrade.</p>
    <button type="button" className="btn btn-primary w-full disabled:opacity-50" disabled={busy || !registrationProof || !/^[6-9]\d{9}$/.test(phone)} onClick={() => submit(false)}>{busy ? "Working..." : "Send trial SMS code"}</button>
    {challenge && <><label className="block text-xs text-gray-600">SMS code<input className="block w-full border rounded-lg p-2 text-slate-900 bg-white" aria-label="SMS verification code" value={code} inputMode="numeric" maxLength={6} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} /></label><button type="button" className="btn btn-primary w-full disabled:opacity-50" disabled={busy || code.length !== 6} onClick={() => submit(true)}>Verify phone number</button></>}
    {message && <p role="status" className="text-xs text-gray-600">{message}</p>}
  </div></details>;
}
