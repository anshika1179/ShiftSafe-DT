/*
 * Client-side state types and helpers.
 * We keep claim/worker/policy shapes here so both the provider
 * and individual pages can import from one place.
 */

export interface WorkerProfile {
  id: string;
  name: string;
  phone: string;
  platform: string;
  city?: string;
  zone: string;
  avgWeeklyEarnings: number;
  hoursPerDay: number;
  upiId: string;
}

export interface PolicyData {
  id: string;
  weeklyPremium: number;
  coverageAmount: number;
  riskScore: number;
  riskLabel: string;
  status: 'active' | 'expired' | 'cancelled';
  startDate: string;
  nextPaymentDue: string;
  totalPremiumPaid: number;
  contributions: {
    weather: number;
    zone: number;
    platform: number;
    claims: number;
  };
}

export interface ClaimData {
  id: string;
  triggerType: string;
  triggerEmoji: string;
  triggerName: string;
  triggerValue: string;
  amount: number;
  status: 'paid' | 'pending' | 'review' | 'blocked';
  fraudScore: number;
  fraudLabel: string;
  fraudColor: string;
  payoutRef: string;
  timestamp: string;
  relativeTime: string;
  zone: string;
}

interface TriggerStatus {
  type: string;
  emoji: string;
  name: string;
  currentValue: string;
  isActive: boolean;
}

const TRIGGER_EMOJIS: Record<string, string> = {
  heavy_rain: '🌧️',
  heatwave: '🌡️',
  extreme_heat: '🌡️',
  pollution: '😷',
  severe_pollution: '😷',
  platform_outage: '📱',
  zone_closure: '🚧',
  curfew: '🚧',
};

const TRIGGER_NAMES: Record<string, string> = {
  heavy_rain: 'Heavy Rain',
  heatwave: 'Extreme Heat',
  extreme_heat: 'Extreme Heat',
  pollution: 'Air Quality',
  severe_pollution: 'Severe Pollution',
  platform_outage: 'Platform Outage',
  zone_closure: 'Zone Closure',
  curfew: 'Zone Closure',
};

export function getTriggerEmoji(type: string): string {
  return TRIGGER_EMOJIS[type] || '⚠️';
}

export function getTriggerName(type: string): string {
  return TRIGGER_NAMES[type] || type.replace(/_/g, ' ');
}

export function generatePayoutRef(): string {
  return `UPI-TXN-${Math.floor(1000000 + Math.random() * 9000000)}`;
}


export function formatIndianDate(date: Date): string {
  return date.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// pre-built claims for when a new user registers (so the demo doesn't look empty)
export function getSeededClaims(weeklyEarnings: number): ClaimData[] {
  const daily = weeklyEarnings / 7;
  return [
    {
      id: 'CLM001',
      triggerType: 'heavy_rain',
      triggerEmoji: '🌧️',
      triggerName: 'Heavy Rain',
      triggerValue: '72mm rainfall in 2 hours',
      amount: Math.round(daily * 0.70),
      status: 'paid',
      fraudScore: 12,
      fraudLabel: '12/100 ✓ Clean',
      fraudColor: '#34d399',
      payoutRef: 'UPI-TXN-8721634',
      timestamp: new Date(Date.now() - 8 * 86400000).toISOString(),
      relativeTime: '8d ago',
      zone: 'Andheri East',
    },
    {
      id: 'CLM002',
      triggerType: 'heatwave',
      triggerEmoji: '🌡️',
      triggerName: 'Extreme Heat',
      triggerValue: '43.2°C for 4+ hours',
      amount: Math.round(daily * 0.50),
      status: 'paid',
      fraudScore: 8,
      fraudLabel: '8/100 ✓ Clean',
      fraudColor: '#34d399',
      payoutRef: 'UPI-TXN-9134872',
      timestamp: new Date(Date.now() - 3 * 86400000).toISOString(),
      relativeTime: '3d ago',
      zone: 'Andheri East',
    },
  ];
}
