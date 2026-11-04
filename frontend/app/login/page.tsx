"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAppState } from "@/frontend/components/providers/AppProvider";
import GoogleSignIn from "@/frontend/components/auth/GoogleSignIn";
import { safePush, safeReplace } from "@/lib/client/navigation";
export default function LoginPage() {
  const router = useRouter();
  const { isLoggedIn, isBootstrapping, refreshSession } = useAppState();
  useEffect(() => { if (!isBootstrapping && isLoggedIn) safeReplace(router, "/journey"); }, [isLoggedIn, isBootstrapping, router]);
  return <div className="max-w-md mx-auto px-4 py-12 space-y-6"><h1 className="text-3xl font-bold">Sign in</h1><GoogleSignIn onSuccess={async (data) => {
    if (data.registered) { await refreshSession(); safePush(router, "/journey"); }
    else { safePush(router, "/register"); }
  }} /><p className="text-sm text-gray-500">Use the same Google account you used to create your profile. Existing phone-only accounts are not automatically linked. New users can sign in again on the registration page to finish their profile.</p></div>;
}
