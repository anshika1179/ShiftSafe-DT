// Prototype participation only. Not legal, insurer or DPDP compliance verification.
export interface UnderwritingInput {
  platform: string;
  isMultiApping: boolean; // e.g., working for Swiggy and Zomato
  city: string;
  zone: string;
  totalActiveDeliveryDays: number;   // lifetime active days
  daysWorkedThisWeek: number;        // current week activity
  daysActiveInLast30: number;        // monthly activity
  avgWeeklyIncome: number;
  vehicleType: string;
  // Prototype-requested consents, not legal compliance certification
  dpdpConsents: {
    gpsLocation: boolean;   // Separate consent screen required
    bankUpi: boolean;       // Explicit consent + KYC
    platformActivity: boolean; // Data sharing agreement
  };
  // Optional: enrollment timing (for adverse selection check)
  enrollmentTimestamp?: string; // ISO string of when they're trying to enroll
}

export interface UnderwritingResult {
  eligible: boolean;
  reason: string;
  activityTier: 'basic' | 'standard' | 'premium' | 'ineligible';
  cityPool: string;
  recommendedPlan: string;
  weeklyPremium: number;
  maxPayoutPerWeek: number;
  warnings: string[];
  steps: string[];
  costModel?: {
    platformFeePercent: number;
    operationalMarginPercent: number;
    reinsurancePercent: number;
    effectivePremiumToPool: number;
  };
  wardValidation?: {
    zone: string;
    city: string;
    wardResolved: boolean;
    riskTier: 'low' | 'medium' | 'high';
  };
}

/** Prototype participation check only. No government-scheme or insurer eligibility decision. */
export function underwriteWorker(input: UnderwritingInput): UnderwritingResult {
 const platformOk=["Zomato","Swiggy"].includes(input.platform);
 const consents=input.dpdpConsents.gpsLocation&&input.dpdpConsents.bankUpi&&input.dpdpConsents.platformActivity;
 const eligible=platformOk&&consents;
 return {eligible,reason:eligible?"Prototype participation checks passed. This is not legal eligibility, underwriting approval or active cover.":platformOk?"The prototype's requested consents are incomplete. No cover is created.":"Only food-delivery platforms Zomato and Swiggy are in this prototype.",activityTier:eligible?"basic":"ineligible",cityPool:input.city,recommendedPlan:"No binding plan",weeklyPremium:0,maxPayoutPerWeek:0,warnings:["Social-security benefits depend on applicable government schemes. Lifetime delivery days do not prove scheme eligibility.","No disaster enrollment lock, ward risk, KYC or insurer approval has been verified."],steps:["Supported food-delivery platform","Recorded prototype consents"]};
}
