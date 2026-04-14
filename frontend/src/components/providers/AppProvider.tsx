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
import {
  generatePayoutRef,
  getTriggerEmoji,
  getTriggerName,
} from "@/backend/utils/store";
import { calculateWeeklyPremium } from "@/backend/engines/premium-engine";
import { detectFraudForDemo } from "@/backend/engines/fraud-engine";

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
  simulateTrigger: (triggerType: string) => ClaimData;
  recalculatePremium: (
    zone: string,
    earnings: number,
    platform: string,
  ) => PolicyData;
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
  policy?: PolicyData;
  claims?: ClaimData[];
  totalEarningsProtected?: number;
}

const TRIGGER_VALUES: Record<string, string> = {
  heavy_rain: "67.5mm in 2 hours · Threshold exceeded",
  heatwave: "43.2°C for 4+ hours · Threshold exceeded",
  extreme_heat: "43.2°C for 4+ hours · Threshold exceeded",
  pollution: "AQI 480 · Hazardous level",
  severe_pollution: "AQI 480 · Hazardous level",
  platform_outage: "95-min Zomato outage · Service disruption",
  zone_closure: "Section 144 imposed · Zone locked",
};

const COVERAGE_PCT: Record<string, number> = {
  heavy_rain: 0.7,
  heatwave: 0.5,
  extreme_heat: 0.5,
  pollution: 0.6,
  severe_pollution: 0.6,
  platform_outage: 0.8,
  zone_closure: 1.0,
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(EMPTY_STATE);

  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      const data = (await res.json()) as WorkerSessionResponse;

      if (res.ok && data.authenticated && data.worker && data.policy) {
        const claims = Array.isArray(data.claims) ? data.claims : [];
        const calculatedTotal = claims
          .filter((claim) => claim.status === "paid")
          .reduce((sum, claim) => sum + claim.amount, 0);

        setState({
          worker: data.worker,
          policy: data.policy,
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

  const simulateTrigger = useCallback(
    (triggerType: string): ClaimData => {
      const earnings = state.worker?.avgWeeklyEarnings || 4200;
      const dailyEarnings = earnings / 7;
      const pct = COVERAGE_PCT[triggerType] ?? 0.5;
      const amount = Math.round(dailyEarnings * pct);

      const fraud = detectFraudForDemo(state.claims.length);
      const claim: ClaimData = {
        id: `CLM${String(state.claims.length + 1).padStart(3, "0")}`,
        triggerType,
        triggerEmoji: getTriggerEmoji(triggerType),
        triggerName: getTriggerName(triggerType),
        triggerValue: TRIGGER_VALUES[triggerType] || "Threshold exceeded",
        amount,
        status: "paid",
        fraudScore: fraud.score,
        fraudLabel: fraud.label,
        fraudColor: fraud.color,
        payoutRef: generatePayoutRef(),
        timestamp: new Date().toISOString(),
        relativeTime: "Just now",
        zone: state.worker?.zone || "Andheri East",
      };

      addClaim(claim);
      return claim;
    },
    [state.worker, state.claims.length, addClaim],
  );

  const recalculatePremium = useCallback(
    (zone: string, earnings: number, platform: string): PolicyData => {
      const premium = calculateWeeklyPremium(
        zone,
        earnings,
        platform,
        state.claims.length,
      );
      const nextPaymentDueDate = new Date();
      nextPaymentDueDate.setDate(nextPaymentDueDate.getDate() + 7);

      const newPolicy: PolicyData = {
        id: state.policy?.id || "POL-001",
        weeklyPremium: premium.weeklyPremium,
        coverageAmount: premium.coverageAmount,
        riskScore: premium.riskScore,
        riskLabel: premium.riskLabel,
        status: "active",
        startDate:
          state.policy?.startDate || new Date().toISOString().split("T")[0],
        nextPaymentDue:
          state.policy?.nextPaymentDue ||
          nextPaymentDueDate.toISOString().split("T")[0],
        totalPremiumPaid: premium.weeklyPremium * 2,
        contributions: premium.contributions,
      };
      setPolicy(newPolicy);
      return newPolicy;
    },
    [state.policy, state.claims.length, setPolicy],
  );

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
        simulateTrigger,
        recalculatePremium,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
