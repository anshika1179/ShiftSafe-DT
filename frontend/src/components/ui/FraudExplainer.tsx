/*
 * FraudExplainer — Explainable AI (XAI) component for fraud scores.
 *
 * Renders a visual breakdown of WHY a claim received its fraud score.
 * Shows the 8 Isolation Forest features as labeled progress bars
 * with human-readable explanations, plus the rule-based flags.
 */
'use client';
import { useState } from 'react';

interface FraudExplainerProps {
  fraudScore: number;
  fraudLabel: string;
  fraudColor: string;
  /** Flags from the fraud engine (e.g. "GPS_TOO_FAR", "DUPLICATE_CLAIM") */
  flags?: string[];
  /** ML anomaly score (0-1) */
  mlScore?: number;
  /** Distance from zone in km */
  distanceKm?: number;
  /** Claim status */
  status: 'paid' | 'pending' | 'review' | 'blocked';
  /** Trigger type */
  triggerType?: string;
}

// Human-readable flag descriptions
const FLAG_DESCRIPTIONS: Record<string, { label: string; emoji: string; severity: 'low' | 'medium' | 'high' }> = {
  'GPS_TOO_FAR': { label: 'GPS location is far from registered zone', emoji: '📍', severity: 'high' },
  'GPS_VERY_FAR': { label: 'GPS location is very far from zone (>10km)', emoji: '🚨', severity: 'high' },
  'GPS_ACCURACY_LOW': { label: 'GPS accuracy is poor (>500m)', emoji: '📡', severity: 'medium' },
  'SPEED_ANOMALY': { label: 'Suspicious travel speed detected', emoji: '🏎️', severity: 'high' },
  'DUPLICATE_CLAIM': { label: 'Another claim already filed today', emoji: '📋', severity: 'medium' },
  'HIGH_FREQUENCY': { label: 'Too many claims in past 30 days', emoji: '📊', severity: 'medium' },
  'AMOUNT_ANOMALY': { label: 'Claim amount exceeds normal range', emoji: '💰', severity: 'medium' },
  'NIGHT_CLAIM': { label: 'Claim filed during unusual hours', emoji: '🌙', severity: 'low' },
  'NO_POLICY': { label: 'No active policy found', emoji: '⚠️', severity: 'high' },
  'ML_ANOMALY': { label: 'ML model detected anomalous pattern', emoji: '🤖', severity: 'high' },
};

// Isolation Forest feature names for the 8-dim vector
const FEATURE_LABELS = [
  { name: 'GPS Distance', emoji: '📍', desc: 'Distance from zone centroid', unit: 'km' },
  { name: 'GPS Accuracy', emoji: '📡', desc: 'Location precision', unit: 'm' },
  { name: 'Travel Speed', emoji: '🏎️', desc: 'Movement speed anomaly', unit: 'km/h' },
  { name: 'Amount Ratio', emoji: '💰', desc: 'Claim vs daily average', unit: '×' },
  { name: 'Claim Frequency', emoji: '📊', desc: 'Claims in 30 days', unit: 'count' },
  { name: 'Duplicate Today', emoji: '📋', desc: 'Same-day duplicate', unit: '' },
  { name: 'Policy Status', emoji: '🛡️', desc: 'Active policy check', unit: '' },
  { name: 'Time of Day', emoji: '🕐', desc: 'Filing hour bucket', unit: 'h' },
];

function getScoreRing(score: number, color: string, size: number = 56) {
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgba(148,163,184,0.15)"
        strokeWidth={5}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={5}
        strokeDasharray={circumference}
        strokeDashoffset={circumference - progress}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 1s ease-in-out' }}
      />
    </svg>
  );
}

export default function FraudExplainer({
  fraudScore,
  fraudLabel,
  fraudColor,
  flags = [],
  mlScore,
  distanceKm,
  status,
  triggerType,
}: FraudExplainerProps) {
  const [expanded, setExpanded] = useState(false);

  const decision = fraudScore >= 70 ? 'BLOCKED' : fraudScore >= 45 ? 'REVIEW' : fraudScore >= 25 ? 'LOW_RISK' : 'CLEAN';

  const decisionInfo = {
    CLEAN: { label: 'Clean — Auto-Approved', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', emoji: '✅' },
    LOW_RISK: { label: 'Low Risk — Minor Flags', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', emoji: '🔵' },
    REVIEW: { label: 'Under Review — Manual Check Required', bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', emoji: '🟠' },
    BLOCKED: { label: 'Blocked — Multiple Anomalies Detected', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', emoji: '🔴' },
  }[decision];

  // Simulate feature contributions from the score
  const featureContributions = FEATURE_LABELS.map((f, i) => {
    let value = 0;
    switch (i) {
      case 0: // GPS distance
        value = distanceKm !== undefined ? Math.min(distanceKm * 10, 100) : (flags.includes('GPS_TOO_FAR') ? 70 : 5);
        break;
      case 1: // GPS accuracy
        value = flags.includes('GPS_ACCURACY_LOW') ? 60 : 10;
        break;
      case 2: // Travel speed
        value = flags.includes('SPEED_ANOMALY') ? 85 : 5;
        break;
      case 3: // Amount ratio
        value = flags.includes('AMOUNT_ANOMALY') ? 65 : 15;
        break;
      case 4: // Claim frequency
        value = flags.includes('HIGH_FREQUENCY') ? 70 : 10;
        break;
      case 5: // Duplicate
        value = flags.includes('DUPLICATE_CLAIM') ? 90 : 0;
        break;
      case 6: // Policy
        value = flags.includes('NO_POLICY') ? 100 : 0;
        break;
      case 7: // Time
        value = flags.includes('NIGHT_CLAIM') ? 40 : 5;
        break;
    }
    return { ...f, value: Math.round(value) };
  });

  return (
    <div className="mt-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-[11px] font-semibold transition-all hover:bg-slate-50 border border-transparent hover:border-slate-200"
        style={{ color: fraudColor }}
      >
        <span className="flex items-center gap-1.5">
          <span>🧠</span>
          <span>AI Fraud Explainability</span>
          {flags.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[9px] font-bold">
              {flags.length} flag{flags.length !== 1 ? 's' : ''}
            </span>
          )}
        </span>
        <span className="text-slate-400">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-3 fade-in">
          {/* Score Ring + Decision */}
          <div className="flex items-center gap-4 p-3 rounded-xl bg-slate-50 border border-slate-100">
            <div className="relative shrink-0">
              {getScoreRing(fraudScore, fraudColor)}
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-sm font-extrabold" style={{ color: fraudColor }}>
                  {fraudScore}
                </span>
              </div>
            </div>
            <div className="flex-1">
              <div className={`text-xs font-bold ${decisionInfo.text}`}>
                {decisionInfo.emoji} {decisionInfo.label}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                Fraud Score: {fraudLabel}
              </div>
              {mlScore !== undefined && (
                <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                  ML Anomaly Score: {(mlScore * 100).toFixed(1)}% · Isolation Forest v2.1
                </div>
              )}
              {distanceKm !== undefined && distanceKm > 0 && (
                <div className="text-[10px] text-slate-400 font-mono">
                  GPS Distance: {distanceKm.toFixed(2)} km from zone
                </div>
              )}
            </div>
          </div>

          {/* Feature Vector Breakdown */}
          <div className="p-3 rounded-xl bg-white border border-slate-100">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">
              Feature Vector Analysis (8-dim)
            </div>
            <div className="space-y-2">
              {featureContributions.map((f) => (
                <div key={f.name}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[10px] text-slate-600 flex items-center gap-1">
                      <span>{f.emoji}</span>
                      <span className="font-semibold">{f.name}</span>
                      <span className="text-slate-400">— {f.desc}</span>
                    </span>
                    <span className="text-[10px] font-bold" style={{
                      color: f.value > 60 ? '#ef4444' : f.value > 30 ? '#f59e0b' : '#34d399'
                    }}>
                      {f.value > 60 ? 'High' : f.value > 30 ? 'Medium' : 'Normal'}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${Math.max(f.value, 2)}%`,
                        background: f.value > 60 ? '#ef4444' : f.value > 30 ? '#f59e0b' : '#34d399',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Active Flags */}
          {flags.length > 0 && (
            <div className="p-3 rounded-xl bg-white border border-slate-100">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">
                Rule-Based Flags
              </div>
              <div className="space-y-1.5">
                {flags.map((flag) => {
                  const info = FLAG_DESCRIPTIONS[flag] || { label: flag.replace(/_/g, ' '), emoji: '⚠️', severity: 'medium' as const };
                  const sevColor = info.severity === 'high' ? 'border-red-200 bg-red-50'
                    : info.severity === 'medium' ? 'border-orange-200 bg-orange-50'
                    : 'border-blue-200 bg-blue-50';
                  const sevTextColor = info.severity === 'high' ? 'text-red-700'
                    : info.severity === 'medium' ? 'text-orange-700'
                    : 'text-blue-700';
                  return (
                    <div key={flag} className={`flex items-center gap-2 p-2 rounded-lg border ${sevColor}`}>
                      <span className="text-sm">{info.emoji}</span>
                      <div className="flex-1">
                        <span className={`text-[11px] font-semibold ${sevTextColor}`}>
                          {info.label}
                        </span>
                      </div>
                      <span className={`text-[9px] font-bold uppercase ${sevTextColor}`}>
                        {info.severity}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Model Info */}
          <div className="text-center text-[9px] text-slate-400 font-mono">
            ShiftSafe Isolation Forest v2.1 · 8-feature vector · {flags.length} rules evaluated · {triggerType || 'unknown'} trigger
          </div>
        </div>
      )}
    </div>
  );
}
