"use client";
import { useState } from "react";
import { getGoogleToken } from "@/lib/client/google-auth";
export default function GoogleSignIn({ onSuccess }: { onSuccess: (data: { registered: boolean; registrationProof?: string; name?: string; email?: string; idToken?: string }) => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div className="space-y-3"><button disabled={busy} className="btn btn-primary w-full disabled:opacity-50" onClick={async () => {
    setBusy(true); setError("");
    try {
      const idToken = await getGoogleToken();
      const res = await fetch("/api/auth/google", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to sign in");
      await onSuccess({ ...data, idToken });
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to sign in"); }
    finally { setBusy(false); }
  }}>{busy ? "Signing in..." : "Continue with Google"}</button>{error && <p role="alert" className="text-sm text-red-600">{error}</p>}<p className="text-xs text-gray-500">Google verifies your account, not your phone, delivery work or insurance eligibility. No SMS is sent.</p></div>;
}
