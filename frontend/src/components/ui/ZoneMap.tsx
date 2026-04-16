/*
 * ZoneMap — GPS Spoofing Visualization Component
 *
 * Shows an interactive map comparing the worker's GPS coordinates
 * against their registered zone, with a spoofing risk indicator.
 * Uses a CSS-based zone circle overlay on Google Maps embed.
 */
'use client';
import { useState } from 'react';

interface ZoneMapProps {
  workerCoords?: { lat: number; lon: number };
  zoneCenter?: { lat: number; lon: number };
  zoneName: string;
  city: string;
  distanceKm?: number;
  accuracyMeters?: number;
  gpsStatus: string;
  zoneRadiusKm?: number;
}

function getSpoofRisk(distanceKm?: number, accuracyMeters?: number): {
  level: 'safe' | 'warning' | 'danger';
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  description: string;
  confidence: number;
} {
  const dist = distanceKm ?? 0;
  const acc = accuracyMeters ?? 0;

  if (dist > 10 || acc > 1000) {
    return {
      level: 'danger',
      label: 'HIGH SPOOFING RISK',
      color: '#ef4444',
      bgColor: 'rgba(239,68,68,0.06)',
      borderColor: 'rgba(239,68,68,0.25)',
      description: `Worker GPS is ${dist.toFixed(1)}km from zone. Possible GPS spoofing or location mocking detected.`,
      confidence: Math.min(95, 50 + dist * 3),
    };
  }

  if (dist > 3 || acc > 500) {
    return {
      level: 'warning',
      label: 'MODERATE RISK',
      color: '#f59e0b',
      bgColor: 'rgba(245,158,11,0.06)',
      borderColor: 'rgba(245,158,11,0.25)',
      description: `Worker is ${dist.toFixed(1)}km from zone center. GPS accuracy: ±${acc}m. Could be at zone boundary or indoor GPS drift.`,
      confidence: Math.min(70, 30 + dist * 5),
    };
  }

  return {
    level: 'safe',
    label: 'GPS VERIFIED',
    color: '#10b981',
    bgColor: 'rgba(16,185,129,0.06)',
    borderColor: 'rgba(16,185,129,0.25)',
    description: `Worker location matches registered zone. Distance: ${dist.toFixed(2)}km, Accuracy: ±${acc}m.`,
    confidence: Math.max(5, 15 - dist * 3),
  };
}

export default function ZoneMap({
  workerCoords,
  zoneCenter,
  zoneName,
  city,
  distanceKm,
  accuracyMeters,
  gpsStatus,
  zoneRadiusKm = 5,
}: ZoneMapProps) {
  const [expanded, setExpanded] = useState(false);
  const risk = getSpoofRisk(distanceKm, accuracyMeters);

  const mapQuery = workerCoords
    ? `${workerCoords.lat},${workerCoords.lon}`
    : `${zoneName}, ${city}, India`;

  const hasCoords = workerCoords && (workerCoords.lat !== 0 || workerCoords.lon !== 0);

  return (
    <div className="space-y-3">
      {/* Spoofing Risk Badge */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full rounded-xl p-3 border transition-all hover:-translate-y-0.5"
        style={{
          background: risk.bgColor,
          borderColor: risk.borderColor,
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold text-white"
              style={{ background: risk.color }}
            >
              {risk.level === 'safe' ? '✓' : risk.level === 'warning' ? '⚠' : '✕'}
            </div>
            <div className="text-left">
              <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: risk.color }}>
                {risk.label}
              </div>
              <div className="text-[10px] text-slate-500">
                {hasCoords ? `${distanceKm?.toFixed(2) || '0.00'}km from zone · ±${accuracyMeters || 0}m accuracy` : 'GPS data pending'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {risk.level !== 'safe' && (
              <div className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full" style={{ color: risk.color, background: `${risk.color}15` }}>
                {risk.confidence.toFixed(0)}% risk
              </div>
            )}
            <span className="text-slate-400 text-xs">{expanded ? '▲' : '▼'}</span>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="space-y-3 fade-in">
          {/* Map with Zone Overlay */}
          <div className="rounded-xl overflow-hidden border border-slate-200 shadow-sm relative">
            <div className="h-52 relative bg-slate-200 w-full">
              <iframe
                src={`https://maps.google.com/maps?q=${encodeURIComponent(mapQuery)}&t=&z=13&ie=UTF8&iwloc=&output=embed`}
                width="100%"
                height="100%"
                style={{ border: 0 }}
                allowFullScreen={false}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />

              {/* Zone radius overlay (visual indicator) */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div
                  className="rounded-full border-2 border-dashed opacity-40 animate-pulse"
                  style={{
                    width: '120px',
                    height: '120px',
                    borderColor: risk.color,
                    background: `${risk.color}08`,
                  }}
                />
                <div
                  className="absolute w-3 h-3 rounded-full border-2 border-white shadow-lg"
                  style={{ background: risk.color }}
                />
              </div>

              {/* Legend */}
              <div className="absolute top-2 left-2 bg-white/90 backdrop-blur-sm px-2 py-1.5 rounded-lg shadow-sm border border-slate-200">
                <div className="flex items-center gap-1.5 text-[9px]">
                  <div className="w-2 h-2 rounded-full" style={{ background: risk.color }} />
                  <span className="font-bold text-slate-700">Worker GPS</span>
                </div>
                <div className="flex items-center gap-1.5 text-[9px] mt-0.5">
                  <div className="w-2 h-2 rounded-full border border-dashed border-slate-400" />
                  <span className="text-slate-500">Zone: {zoneName}</span>
                </div>
              </div>

              {/* Risk badge on map */}
              <div className="absolute bottom-2 right-2 px-2 py-1 rounded-lg shadow-sm text-[9px] font-bold text-white" style={{ background: risk.color }}>
                {risk.label}
              </div>
            </div>
          </div>

          {/* GPS Details Grid */}
          <div className="grid grid-cols-2 gap-2">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
              <div className="text-[9px] font-bold text-slate-400 uppercase">Worker Location</div>
              <div className="text-xs font-mono text-slate-700 mt-1">
                {hasCoords ? `${workerCoords.lat.toFixed(4)}, ${workerCoords.lon.toFixed(4)}` : 'Pending...'}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
              <div className="text-[9px] font-bold text-slate-400 uppercase">Zone Center</div>
              <div className="text-xs font-mono text-slate-700 mt-1">
                {zoneCenter ? `${zoneCenter.lat.toFixed(4)}, ${zoneCenter.lon.toFixed(4)}` : zoneName}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
              <div className="text-[9px] font-bold text-slate-400 uppercase">Distance</div>
              <div className="text-xs font-bold mt-1" style={{ color: risk.color }}>
                {distanceKm !== undefined ? `${distanceKm.toFixed(2)} km` : '—'}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
              <div className="text-[9px] font-bold text-slate-400 uppercase">GPS Accuracy</div>
              <div className="text-xs font-bold text-slate-700 mt-1">
                ±{accuracyMeters || 0}m
              </div>
            </div>
          </div>

          {/* Risk Analysis */}
          <div className="p-3 rounded-xl border" style={{ borderColor: risk.borderColor, background: risk.bgColor }}>
            <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: risk.color }}>
              🔍 Anti-Spoofing Analysis
            </div>
            <div className="text-[11px] text-slate-600">
              {risk.description}
            </div>
            {risk.level !== 'safe' && (
              <div className="mt-2 flex flex-wrap gap-1">
                {distanceKm !== undefined && distanceKm > 3 && (
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-bold border" style={{ color: risk.color, borderColor: risk.borderColor }}>
                    📍 Geo-fence breach
                  </span>
                )}
                {accuracyMeters !== undefined && accuracyMeters > 500 && (
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-bold border" style={{ color: risk.color, borderColor: risk.borderColor }}>
                    📡 Low GPS precision
                  </span>
                )}
                {distanceKm !== undefined && distanceKm > 10 && (
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-bold border" style={{ color: risk.color, borderColor: risk.borderColor }}>
                    🚨 Mock location suspected
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Zone radius */}
          <div className="text-center text-[9px] text-slate-400 font-mono">
            Zone radius: {zoneRadiusKm}km · GPS status: {gpsStatus} · Anti-spoof engine v1.0
          </div>
        </div>
      )}
    </div>
  );
}
