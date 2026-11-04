import { fetchEnvironment, resolveEnvironmentLocation } from "./environment";
export interface TriggerResult { triggered: boolean; type: string; severity: "moderate" | "high" | "severe"; description: string; rawData: Record<string, unknown>; payoutAmount: number; sourceApi: string }
export interface ZoneContext { zone: string; city: string; lat: number; lon: number; source: "city_map"; precision: "city_center" }
const PAYOUT_TABLE: Record<string, Record<string, number>> = {
  heavy_rain: { moderate: 100, high: 200, severe: 350 },
  heatwave: { moderate: 80, high: 150, severe: 250 },
  pollution: { moderate: 60, high: 120, severe: 200 },
  platform_outage: { moderate: 100, high: 200, severe: 300 },
  curfew: { moderate: 200, high: 350, severe: 500 },
};


export async function resolveZoneContext(zone: string, city: string): Promise<ZoneContext | null> {
  const location = resolveEnvironmentLocation(city);
  return location ? { zone, city, lat: location.lat, lon: location.lon, source: "city_map", precision: "city_center" } : null;
}
function unavailable(description: string): TriggerResult { return { triggered:false,type:"unavailable",severity:"moderate",description,rawData:{quality:"unavailable"},payoutAmount:0,sourceApi:"Unavailable" }; }
export async function checkPlatformOutageTrigger(): Promise<TriggerResult> {
  return unavailable("Delivery-app outage evidence is not configured. Website reachability is not proof of a worker outage.");
}
export async function checkAllTriggers(params: {zone?:string;city?:string} = {}) {
  const zoneContext = await resolveZoneContext(params.zone || "",params.city || "");
  const location = resolveEnvironmentLocation(params.city || "");
  if (!location) return {zoneContext,weather:unavailable("Work location unresolved"),pollution:unavailable("Work location unresolved"),platform:await checkPlatformOutageTrigger(),triggered:[]};
  const data=await fetchEnvironment(location);
  const result=(kind: "weather"|"pollution"): TriggerResult => {
    const source=kind==="weather"?data.weather:data.aqi;
    const alerts=data.triggers.filter(t=>kind==="weather"?t.type!=="pollution":t.type==="pollution");
    if (!source) return unavailable(`${kind} data unavailable or stale`);
    return {triggered:alerts.length>0,type:alerts[0]?.type||"none",severity:"moderate",description:alerts.map(t=>t.value).join("; ")||"No configured threshold crossed in available modelled data",rawData:{...source,location:data.location,rulesVersion:data.ruleVersion,alerts},payoutAmount:0,sourceApi:"Open-Meteo modelled estimates"};
  };
  const weather=result("weather"),pollution=result("pollution"),platform=await checkPlatformOutageTrigger();
  return {zoneContext,weather,pollution,platform,triggered:[weather,pollution].filter(t=>t.triggered)};
}
export async function checkWeatherTrigger(lat: number,lon: number): Promise<TriggerResult> {
  const location=resolveEnvironmentLocation("",lat,lon);if(!location)return unavailable("Invalid location");
  const data=await fetchEnvironment(location);const alert=data.triggers.find(t=>t.type!=="pollution");if(!data.weather)return unavailable("Weather data unavailable or stale");
  return {triggered:!!alert,type:alert?.type||"none",severity:"moderate",description:alert?.value||"No weather threshold crossed in available data",rawData:{weather:data.weather,issues:data.issues},payoutAmount:0,sourceApi:"Open-Meteo modelled estimates"};
}
export async function checkPollutionTrigger(city: string,lat?: number,lon?: number): Promise<TriggerResult> {
  const location=resolveEnvironmentLocation(city,lat,lon);if(!location)return unavailable("Invalid location");
  const data=await fetchEnvironment(location);const alert=data.triggers.find(t=>t.type==="pollution");if(!data.aqi)return unavailable("Air quality data unavailable or stale");
  return {triggered:!!alert,type:alert?.type||"none",severity:"moderate",description:alert?.value||"No US AQI threshold crossed in available data",rawData:{aqi:data.aqi,issues:data.issues},payoutAmount:0,sourceApi:"Open-Meteo CAMS global model"};
}
export function simulateTrigger(
  type: "heavy_rain" | "heatwave" | "pollution" | "platform_outage" | "curfew",
  severity: "moderate" | "high" | "severe" = "high",
): TriggerResult {
  const descriptions: Record<string, string> = {
    heavy_rain: `Heavy rainfall detected: ${severity === "severe" ? "72" : severity === "high" ? "55" : "35"}mm/hr in zone`,
    heatwave: `Extreme heat alert: ${severity === "severe" ? "48" : severity === "high" ? "45" : "43"}°C in zone`,
    pollution: `Severe AQI: ${severity === "severe" ? "620" : severity === "high" ? "510" : "470"} in zone`,
    platform_outage: `Platform down for ${severity === "severe" ? "180" : severity === "high" ? "120" : "95"} minutes`,
    curfew: `Section 144 imposed — zone locked for ${severity === "severe" ? "24" : severity === "high" ? "12" : "6"} hours`,
  };

  return {
    triggered: true,
    type,
    severity,
    description: descriptions[type],
    rawData: { simulated: true, type, severity },
    payoutAmount: PAYOUT_TABLE[type][severity],
    sourceApi: "Manual Simulation",
  };
}
