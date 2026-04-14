// Trigger Monitoring Engine
// Checks external data sources for parametric trigger conditions

interface TriggerResult {
  triggered: boolean;
  type: string;
  severity: "moderate" | "high" | "severe";
  description: string;
  rawData: Record<string, unknown>;
  payoutAmount: number;
  sourceApi: string;
}

export interface ZoneContext {
  zone: string;
  city: string;
  lat: number;
  lon: number;
  source: "nominatim" | "city_map" | "default";
}

// Payout table per trigger type
const PAYOUT_TABLE: Record<string, Record<string, number>> = {
  heavy_rain: { moderate: 100, high: 200, severe: 350 },
  heatwave: { moderate: 80, high: 150, severe: 250 },
  pollution: { moderate: 60, high: 120, severe: 200 },
  platform_outage: { moderate: 100, high: 200, severe: 300 },
  curfew: { moderate: 200, high: 350, severe: 500 },
};

const CITY_COORDINATES: Record<string, { lat: number; lon: number }> = {
  mumbai: { lat: 19.076, lon: 72.8777 },
  delhi: { lat: 28.6139, lon: 77.209 },
  new_delhi: { lat: 28.6139, lon: 77.209 },
  gurugram: { lat: 28.4595, lon: 77.0266 },
  noida: { lat: 28.5355, lon: 77.391 },
  bengaluru: { lat: 12.9716, lon: 77.5946 },
  hyderabad: { lat: 17.385, lon: 78.4867 },
  chennai: { lat: 13.0827, lon: 80.2707 },
  pune: { lat: 18.5204, lon: 73.8567 },
};

function cityToCoordinates(city: string): { lat: number; lon: number } {
  const normalized = city.trim().toLowerCase().replace(/\s+/g, "_");
  return CITY_COORDINATES[normalized] || CITY_COORDINATES.mumbai;
}

export async function resolveZoneContext(
  zone: string = "Andheri West",
  city: string = "Mumbai",
): Promise<ZoneContext> {
  const cityCoordinates = cityToCoordinates(city);

  try {
    const q = encodeURIComponent(`${zone}, ${city}, India`);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${q}`,
      {
        headers: {
          "User-Agent": "ShiftSafe-DT/1.0 (TriggerMonitoring)",
        },
        cache: "no-store",
      },
    );

    if (res.ok) {
      const data = (await res.json()) as Array<{ lat?: string; lon?: string }>;
      const lat = Number(data[0]?.lat);
      const lon = Number(data[0]?.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return { zone, city, lat, lon, source: "nominatim" };
      }
    }
  } catch {
    // fall through to city-level fallback
  }

  return {
    zone,
    city,
    lat: cityCoordinates.lat,
    lon: cityCoordinates.lon,
    source: CITY_COORDINATES[city.trim().toLowerCase().replace(/\s+/g, "_")]
      ? "city_map"
      : "default",
  };
}

// weather trigger
export async function checkWeatherTrigger(
  lat: number = 19.076,
  lon: number = 72.8777,
): Promise<TriggerResult> {
  // Try real OpenWeatherMap API first, fall back to mock
  const apiKey = process.env.OPENWEATHER_API_KEY;

  if (apiKey && apiKey !== "demo") {
    try {
      const res = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`,
      );
      if (!res.ok) {
        throw new Error(`openweather_http_${res.status}`);
      }
      const data = await res.json();

      const rain1h = data.rain?.["1h"] || 0;
      const temp = data.main?.temp || 30;

      // Heavy rain trigger: >25mm in 1 hour (scaled; 50mm/2hr = 25mm/hr)
      if (rain1h > 25) {
        const severity =
          rain1h > 60 ? "severe" : rain1h > 40 ? "high" : "moderate";
        return {
          triggered: true,
          type: "heavy_rain",
          severity,
          description: `Heavy rainfall detected: ${rain1h.toFixed(1)}mm/hr in your zone`,
          rawData: { rainfall_mm: rain1h, temp, source: "openweathermap" },
          payoutAmount: PAYOUT_TABLE.heavy_rain[severity],
          sourceApi: "OpenWeatherMap",
        };
      }

      // Heatwave trigger: >42°C
      if (temp > 42) {
        const severity = temp > 47 ? "severe" : temp > 45 ? "high" : "moderate";
        return {
          triggered: true,
          type: "heatwave",
          severity,
          description: `Extreme heat alert: ${temp.toFixed(1)}°C in your zone`,
          rawData: {
            temp,
            humidity: data.main?.humidity,
            source: "openweathermap",
          },
          payoutAmount: PAYOUT_TABLE.heatwave[severity],
          sourceApi: "OpenWeatherMap",
        };
      }

      return {
        triggered: false,
        type: "none",
        severity: "moderate",
        description: `Weather normal: ${temp.toFixed(1)}°C, Rain: ${rain1h}mm/hr`,
        rawData: data,
        payoutAmount: 0,
        sourceApi: "OpenWeatherMap",
      };
    } catch {
      // Fall through to mock
    }
  }

  // Fallback to Open-Meteo (no API key required)
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,rain&hourly=rain&forecast_days=1`,
      { cache: "no-store" },
    );

    if (res.ok) {
      const data = (await res.json()) as {
        current?: { temperature_2m?: number; rain?: number };
        hourly?: { rain?: number[] };
      };

      const rain1h = data.current?.rain ?? data.hourly?.rain?.[0] ?? 0;
      const temp = data.current?.temperature_2m ?? 30;

      if (rain1h > 25) {
        const severity =
          rain1h > 60 ? "severe" : rain1h > 40 ? "high" : "moderate";
        return {
          triggered: true,
          type: "heavy_rain",
          severity,
          description: `Heavy rainfall detected: ${rain1h.toFixed(1)}mm/hr in your zone`,
          rawData: { rainfall_mm: rain1h, temp, source: "open-meteo" },
          payoutAmount: PAYOUT_TABLE.heavy_rain[severity],
          sourceApi: "Open-Meteo",
        };
      }

      if (temp > 42) {
        const severity = temp > 47 ? "severe" : temp > 45 ? "high" : "moderate";
        return {
          triggered: true,
          type: "heatwave",
          severity,
          description: `Extreme heat alert: ${temp.toFixed(1)}°C in your zone`,
          rawData: { temp, source: "open-meteo" },
          payoutAmount: PAYOUT_TABLE.heatwave[severity],
          sourceApi: "Open-Meteo",
        };
      }

      return {
        triggered: false,
        type: "none",
        severity: "moderate",
        description: `Weather normal: ${temp.toFixed(1)}°C, Rain: ${rain1h.toFixed(1)}mm/hr`,
        rawData: { rainfall_mm: rain1h, temp, source: "open-meteo" },
        payoutAmount: 0,
        sourceApi: "Open-Meteo",
      };
    }
  } catch {
    // Fall through to mock
  }

  // Mock weather data for demo
  return generateMockWeatherTrigger();
}

function generateMockWeatherTrigger(): TriggerResult {
  // Simulate occasional triggers for demo
  const rand = Math.random();
  if (rand < 0.3) {
    return {
      triggered: true,
      type: "heavy_rain",
      severity: "high",
      description: "Heavy rainfall detected: 55mm/hr in Andheri West",
      rawData: { rainfall_mm: 55.2, temp: 28, humidity: 95, source: "mock" },
      payoutAmount: PAYOUT_TABLE.heavy_rain.high,
      sourceApi: "Mock (OpenWeatherMap)",
    };
  }
  return {
    triggered: false,
    type: "none",
    severity: "moderate",
    description: "Weather normal: 31°C, Rain: 0mm/hr",
    rawData: { rainfall_mm: 0, temp: 31, humidity: 65, source: "mock" },
    payoutAmount: 0,
    sourceApi: "Mock (OpenWeatherMap)",
  };
}

// aqi / pollution trigger
export async function checkPollutionTrigger(
  city: string = "mumbai",
  lat?: number,
  lon?: number,
): Promise<TriggerResult> {
  const apiKey = process.env.AQICN_API_KEY;

  if (apiKey && apiKey !== "demo") {
    try {
      const res = await fetch(
        `https://api.waqi.info/feed/${city}/?token=${apiKey}`,
      );
      if (!res.ok) {
        throw new Error(`aqicn_http_${res.status}`);
      }

      const data = (await res.json()) as {
        status?: string;
        data?: { aqi?: number } | string;
      };

      if (data.status !== "ok" || typeof data.data !== "object" || !data.data) {
        throw new Error("aqicn_payload_invalid");
      }

      const aqi = Number((data.data as { aqi?: number }).aqi || 0);

      if (aqi > 450) {
        const severity = aqi > 600 ? "severe" : aqi > 500 ? "high" : "moderate";
        return {
          triggered: true,
          type: "pollution",
          severity,
          description: `Severe air quality: AQI ${aqi} in ${city}`,
          rawData: { aqi, source: "aqicn" },
          payoutAmount: PAYOUT_TABLE.pollution[severity],
          sourceApi: "AQICN",
        };
      }

      return {
        triggered: false,
        type: "none",
        severity: "moderate",
        description: `Air quality acceptable: AQI ${aqi}`,
        rawData: { aqi, source: "aqicn" },
        payoutAmount: 0,
        sourceApi: "AQICN",
      };
    } catch {
      // Fall through to mock
    }
  }

  // Fallback to Open-Meteo Air Quality API (no key)
  if (typeof lat === "number" && typeof lon === "number") {
    try {
      const res = await fetch(
        `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi,pm2_5`,
        { cache: "no-store" },
      );

      if (res.ok) {
        const data = (await res.json()) as {
          current?: { us_aqi?: number; pm2_5?: number };
        };
        const aqi = Math.round(data.current?.us_aqi ?? 0);

        if (aqi > 200) {
          const severity =
            aqi > 300 ? "severe" : aqi > 250 ? "high" : "moderate";
          return {
            triggered: true,
            type: "pollution",
            severity,
            description: `Severe air quality: AQI ${aqi} in ${city}`,
            rawData: {
              aqi,
              pm2_5: data.current?.pm2_5,
              source: "open-meteo-air-quality",
            },
            payoutAmount: PAYOUT_TABLE.pollution[severity],
            sourceApi: "Open-Meteo Air Quality",
          };
        }

        return {
          triggered: false,
          type: "none",
          severity: "moderate",
          description: `Air quality acceptable: AQI ${aqi}`,
          rawData: {
            aqi,
            pm2_5: data.current?.pm2_5,
            source: "open-meteo-air-quality",
          },
          payoutAmount: 0,
          sourceApi: "Open-Meteo Air Quality",
        };
      }
    } catch {
      // Fall through to mock
    }
  }

  // Mock AQI data
  return {
    triggered: false,
    type: "none",
    severity: "moderate",
    description: "Air quality moderate: AQI 128",
    rawData: { aqi: 128, source: "mock" },
    payoutAmount: 0,
    sourceApi: "Mock (AQICN)",
  };
}

// platform outage trigger
export async function checkPlatformOutageTrigger(): Promise<TriggerResult> {
  const checks = await Promise.all([
    probePlatform("Zomato", "https://www.zomato.com"),
    probePlatform("Swiggy", "https://www.swiggy.com"),
  ]);

  const unavailable = checks.filter((c) => !c.ok);
  const severeLatency = checks.filter((c) => c.latencyMs > 7000);
  const hasRealSignals = checks.some(
    (c) => c.status !== 0 || c.error !== "network_error",
  );

  if (unavailable.length >= 2) {
    return {
      triggered: true,
      type: "platform_outage",
      severity: "severe",
      description:
        "Multiple delivery platforms unreachable from monitor probes",
      rawData: { checks, source: "live_probe" },
      payoutAmount: PAYOUT_TABLE.platform_outage.severe,
      sourceApi: "Platform Health Probes",
    };
  }

  if (unavailable.length === 1 || severeLatency.length >= 2) {
    const severity = severeLatency.length >= 2 ? "high" : "moderate";
    return {
      triggered: true,
      type: "platform_outage",
      severity,
      description: `Platform instability detected across probe network (${unavailable.length} unavailable)`,
      rawData: { checks, source: "live_probe" },
      payoutAmount: PAYOUT_TABLE.platform_outage[severity],
      sourceApi: "Platform Health Probes",
    };
  }

  if (hasRealSignals) {
    return {
      triggered: false,
      type: "none",
      severity: "moderate",
      description: "All platforms operational",
      rawData: { checks, source: "live_probe" },
      payoutAmount: 0,
      sourceApi: "Platform Health Probes",
    };
  }

  // Fallback for restricted network environments.
  return {
    triggered: false,
    type: "none",
    severity: "moderate",
    description: "All platforms operational",
    rawData: { platform: "Zomato", status: "up", source: "mock" },
    payoutAmount: 0,
    sourceApi: "Platform Health Monitor",
  };
}

async function probePlatform(
  name: string,
  url: string,
): Promise<{
  name: string;
  url: string;
  status: number;
  latencyMs: number;
  ok: boolean;
  error?: string;
}> {
  const started = Date.now();
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    const latencyMs = Date.now() - started;
    const reachable = res.status > 0 && res.status < 500;
    return {
      name,
      url,
      status: res.status,
      latencyMs,
      ok: reachable && latencyMs < 6000,
    };
  } catch {
    return {
      name,
      url,
      status: 0,
      latencyMs: Date.now() - started,
      ok: false,
      error: "network_error",
    };
  }
}

export async function checkAllTriggers(
  params: { zone?: string; city?: string } = {},
) {
  const zoneContext = await resolveZoneContext(
    params.zone || "Andheri West",
    params.city || "Mumbai",
  );

  const [weather, pollution, platform] = await Promise.all([
    checkWeatherTrigger(zoneContext.lat, zoneContext.lon),
    checkPollutionTrigger(zoneContext.city, zoneContext.lat, zoneContext.lon),
    checkPlatformOutageTrigger(),
  ]);

  const triggered = [weather, pollution, platform].filter((t) => t.triggered);

  return {
    zoneContext,
    weather,
    pollution,
    platform,
    triggered,
  };
}

// manual trigger (for demo purposes)
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
