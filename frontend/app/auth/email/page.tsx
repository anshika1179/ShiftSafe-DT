"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { safeReplace } from "@/lib/client/navigation";
export default function EmailActionPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState("");
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    // Reading a mail link never consumes it automatically: scanners and previews cannot unlock onboarding.
    const bearer = new URLSearchParams(window.location.hash.slice(1)).get("nonce") || "";
    // Strip even malformed fragments immediately; do not put bearer in storage.
    window.history.replaceState(null, "", "/auth/email");
    // One-time URL hydration after stripping the bearer immediately.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!/^[0-9a-f]{64}$/.test(bearer)) setError("This is not an onboarding email link. Request a new link.");
    else setNonce(bearer);
  }, []);
  const [busy, setBusy] = useState(false);
  return <main className="max-w-md mx-auto px-4 py-12 space-y-5"><h1 className="text-3xl font-bold">Open your Work Profile</h1><p className="text-gray-600">Confirm this email link to unlock the next onboarding step. Email verification proves inbox access, not delivery work or insurance eligibility.</p>{error && <p role="alert" className="text-red-600">{error}</p>}<button disabled={busy || !!error || !nonce} className="btn btn-primary w-full disabled:opacity-50" onClick={async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/email/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nonce }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Cannot confirm this link.");
      sessionStorage.setItem("shiftsafe-email-onboarding", JSON.stringify(data));
      window.history.replaceState(null, "", "/auth/email");
      safeReplace(router, "/register");
    } catch (err) { setError(err instanceof Error ? err.message : "Cannot confirm this link."); }
    finally { setBusy(false); }
  }}>{busy ? "Checking link..." : "Confirm email link and open Work Profile"}</button><a href="/register" className="text-orange-700 underline">Request a new link</a></main>;
}
