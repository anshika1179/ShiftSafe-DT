"use client";
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type {
  WorkerProfile,
  PolicyData,
  ClaimData,
} from "@/backend/utils/store";
interface AppState {
  worker: WorkerProfile | null;
  policy: PolicyData | null;
  claims: ClaimData[];
  isLoggedIn: boolean;
  isBootstrapping: boolean;
  totalEarningsProtected: number;
}

interface AppContextType extends AppState {
  setWorker: (w: WorkerProfile) => void;
  setPolicy: (p: PolicyData) => void;
  addClaim: (c: ClaimData) => void;
  login: (worker: WorkerProfile, policy: PolicyData) => void;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;

}

const AppContext = createContext<AppContextType | null>(null);

export function useAppState() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppState must be used within AppProvider");
  return ctx;
}

// start with no user — the registration flow populates everything
const EMPTY_STATE: AppState = {
  worker: null,
  policy: null,
  claims: [],
  isLoggedIn: false,
  isBootstrapping: true,
  totalEarningsProtected: 0,
};

interface WorkerSessionResponse {
  authenticated?: boolean;
  worker?: WorkerProfile;
  policy?: PolicyData | null;
  claims?: ClaimData[];
  totalEarningsProtected?: number;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(EMPTY_STATE);

  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      const data = (await res.json()) as WorkerSessionResponse;

      if (res.ok && data.authenticated && data.worker) {
        const claims = Array.isArray(data.claims) ? data.claims : [];
        const calculatedTotal = claims
          .filter((claim) => claim.status === "paid")
          .reduce((sum, claim) => sum + claim.amount, 0);

        setState({
          worker: data.worker,
          policy: data.policy ?? null,
          claims,
          isLoggedIn: true,
          isBootstrapping: false,
          totalEarningsProtected: Number(
            data.totalEarningsProtected ?? calculatedTotal,
          ),
        });
        return;
      }
    } catch {
      // Fall through to logged-out state.
    }

    setState({
      ...EMPTY_STATE,
      isBootstrapping: false,
    });
  }, []);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void refreshSession();
    }, 0);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [refreshSession]);

  const setWorker = useCallback((w: WorkerProfile) => {
    setState((prev) => ({ ...prev, worker: w }));
  }, []);

  const setPolicy = useCallback((p: PolicyData) => {
    setState((prev) => ({ ...prev, policy: p }));
  }, []);

  const addClaim = useCallback((c: ClaimData) => {
    setState((prev) => ({
      ...prev,
      claims: [c, ...prev.claims],
      totalEarningsProtected:
        prev.totalEarningsProtected + (c.status === "paid" ? c.amount : 0),
    }));
  }, []);

  const login = useCallback((worker: WorkerProfile, policy: PolicyData) => {
    setState({
      worker,
      policy,
      claims: [],
      isLoggedIn: true,
      isBootstrapping: false,
      totalEarningsProtected: 0,
    });
  }, []);

  // clears everything and sends user back to splash
  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/session", {
        method: "DELETE",
        cache: "no-store",
      });
    } catch {
      // Ignore sign-out network failures and clear local state anyway.
    }

    setState({
      ...EMPTY_STATE,
      isBootstrapping: false,
    });
  }, []);

  return (
    <AppContext.Provider
      value={{
        ...state,
        setWorker,
        setPolicy,
        addClaim,
        login,
        signOut,
        refreshSession,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
