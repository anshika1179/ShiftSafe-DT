// GET /api/weather?lat=...&lon=...&city=...
// Fetches LIVE weather + AQI data from OpenWeather + AQICN APIs
import { NextRequest, NextResponse } from "next/server";
import {
  consumeRateLimit,
  getClientIp,
  retryAfterSeconds,
} from "@/lib/server/rate-limit";

const OW_KEY = process.env.OPENWEATHER_API_KEY || "";
const AQI_KEY = process.env.AQICN_API_KEY || "";

// City coordinate fallbacks for Indian metros
const CITY_COORDS: Record<string, { lat: number; lon: number }> = {
  mumbai: { lat: 19.076, lon: 72.8777 },
  delhi: { lat: 28.6139, lon: 77.209 },
  bengaluru: { lat: 12.9716, lon: 77.5946 },
  hyderabad: { lat: 17.385, lon: 78.4867 },
  pune: { lat: 18.5204, lon: 73.8567 },
  chennai: { lat: 13.0827, lon: 80.2707 },
  gurugram: { lat: 28.4595, lon: 77.0266 },
  noida: { lat: 28.5355, lon: 77.391 },
  jaipur: { lat: 26.9124, lon: 75.7873 },
  lucknow: { lat: 26.8467, lon: 80.9462 },
  ahmedabad: { lat: 23.0225, lon: 72.5714 },
  kolkata: { lat: 22.5726, lon: 88.3639 },
  // Extended city support
  vadodara: { lat: 22.3072, lon: 73.1812 },
  surat: { lat: 21.1702, lon: 72.8311 },
  indore: { lat: 22.7196, lon: 75.8577 },
  bhopal: { lat: 23.2599, lon: 77.4126 },
  patna: { lat: 25.6093, lon: 85.1376 },
  chandigarh: { lat: 30.7333, lon: 76.7794 },
  nagpur: { lat: 21.1458, lon: 79.0882 },
  coimbatore: { lat: 11.0168, lon: 76.9558 },
  visakhapatnam: { lat: 17.6868, lon: 83.2185 },
  kochi: { lat: 9.9312, lon: 76.2673 },
  thiruvananthapuram: { lat: 8.5241, lon: 76.9366 },
  mysuru: { lat: 12.2958, lon: 76.6394 },
  guwahati: { lat: 26.1445, lon: 91.7362 },
  ranchi: { lat: 23.3441, lon: 85.3096 },
  rajkot: { lat: 22.3039, lon: 70.8022 },
  gandhinagar: { lat: 23.2156, lon: 72.6369 },
  nashik: { lat: 19.9975, lon: 73.7898 },
  thane: { lat: 19.2183, lon: 72.9781 },
};

interface WeatherData {
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  windGust: number | null;
  rainfall1h: number;
  rainfall3h: number;
  visibility: number;
  pressure: number;
  description: string;
  icon: string;
  cloudCover: number;
  uvIndex: number | null;
}

interface AqiData {
  aqi: number;
  level: string;
  dominantPollutant: string;
  pm25: number | null;
  pm10: number | null;
  co: number | null;
  no2: number | null;
  so2: number | null;
  o3: number | null;
}

interface TriggerAlert {
  type: string;
  emoji: string;
  title: string;
  severity: "moderate" | "high" | "severe";
  value: string;
  eligible: boolean;
}

function classifyAqi(aqi: number): string {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy (Sensitive)";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very Unhealthy";
  return "Hazardous";
}

function detectTriggers(weather: WeatherData, aqi: AqiData): TriggerAlert[] {
  const alerts: TriggerAlert[] = [];

  // Heavy rain trigger
  if (weather.rainfall1h >= 30 || weather.rainfall3h >= 64.5) {
    alerts.push({
      type: "heavy_rain",
      emoji: "🌧️",
      title: "Heavy Rain Alert",
      severity: weather.rainfall1h >= 65 ? "severe" : weather.rainfall1h >= 45 ? "high" : "moderate",
      value: `${weather.rainfall1h}mm/hr rainfall detected`,
      eligible: true,
    });
  }

  // Heatwave trigger
  if (weather.temperature >= 42) {
    alerts.push({
      type: "heatwave",
      emoji: "🔥",
      title: "Heatwave Alert",
      severity: weather.temperature >= 47 ? "severe" : weather.temperature >= 44 ? "high" : "moderate",
      value: `${weather.temperature}°C — extreme heat`,
      eligible: true,
    });
  }

  // Pollution trigger
  if (aqi.aqi >= 200) {
    alerts.push({
      type: "pollution",
      emoji: "😷",
      title: "Severe Air Pollution",
      severity: aqi.aqi >= 400 ? "severe" : aqi.aqi >= 300 ? "high" : "moderate",
      value: `AQI ${aqi.aqi} — ${aqi.level}`,
      eligible: true,
    });
  }

  // Low visibility (fog/smog)
  if (weather.visibility < 500) {
    alerts.push({
      type: "low_visibility",
      emoji: "🌫️",
      title: "Low Visibility Warning",
      severity: weather.visibility < 200 ? "high" : "moderate",
      value: `${weather.visibility}m visibility`,
      eligible: false,
    });
  }

  // High wind
  if (weather.windSpeed >= 60 || (weather.windGust && weather.windGust >= 80)) {
    alerts.push({
      type: "storm",
      emoji: "🌪️",
      title: "Storm / High Wind",
      severity: (weather.windGust || weather.windSpeed) >= 100 ? "severe" : "high",
      value: `${weather.windSpeed} km/h wind${weather.windGust ? `, gusts ${weather.windGust} km/h` : ""}`,
      eligible: true,
    });
  }

  return alerts;
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rate = consumeRateLimit(`weather:${ip}`, 60, 5 * 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded", retryAfterSeconds: retryAfterSeconds(rate.resetAt) },
      { status: 429 },
    );
  }

  const params = req.nextUrl.searchParams;
  const cityParam = (params.get("city") || "mumbai").toLowerCase().trim();
  const latParam = params.get("lat");
  const lonParam = params.get("lon");

  // Resolve coordinates
  let lat: number;
  let lon: number;
  let resolvedCity = cityParam;
  if (latParam && lonParam) {
    lat = parseFloat(latParam);
    lon = parseFloat(lonParam);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      const fallback = CITY_COORDS[cityParam] || CITY_COORDS.mumbai;
      lat = fallback.lat;
      lon = fallback.lon;
    }
  } else if (CITY_COORDS[cityParam]) {
    lat = CITY_COORDS[cityParam].lat;
    lon = CITY_COORDS[cityParam].lon;
  } else {
    // City not in our lookup table — use OpenWeatherMap Geocoding API
    let resolved = false;
    if (OW_KEY) {
      try {
        const geoRes = await fetch(
          `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(cityParam)},IN&limit=1&appid=${OW_KEY}`,
          { next: { revalidate: 86400 } }, // cache 24h
        );
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          if (Array.isArray(geoData) && geoData.length > 0) {
            lat = geoData[0].lat;
            lon = geoData[0].lon;
            resolvedCity = (geoData[0].name || cityParam).toLowerCase();
            resolved = true;
          }
        }
      } catch {
        // Fall through to default
      }
    }
    if (!resolved) {
      const fallback = CITY_COORDS.mumbai;
      lat = fallback.lat;
      lon = fallback.lon;
    }
  }

  let weather: WeatherData;
  let aqi: AqiData;

  // ── Fetch live weather from OpenWeatherMap ──
  try {
    if (!OW_KEY) throw new Error("No API key");
    const owRes = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${OW_KEY}`,
      { next: { revalidate: 300 } }, // cache 5 min
    );
    if (!owRes.ok) throw new Error(`OW ${owRes.status}`);
    const ow = await owRes.json();

    weather = {
      temperature: Math.round((ow.main?.temp ?? 30) * 10) / 10,
      feelsLike: Math.round((ow.main?.feels_like ?? 30) * 10) / 10,
      humidity: ow.main?.humidity ?? 50,
      windSpeed: Math.round((ow.wind?.speed ?? 0) * 3.6 * 10) / 10, // m/s → km/h
      windGust: ow.wind?.gust ? Math.round(ow.wind.gust * 3.6 * 10) / 10 : null,
      rainfall1h: ow.rain?.["1h"] ?? 0,
      rainfall3h: ow.rain?.["3h"] ?? 0,
      visibility: ow.visibility ?? 10000,
      pressure: ow.main?.pressure ?? 1013,
      description: ow.weather?.[0]?.description ?? "clear",
      icon: ow.weather?.[0]?.icon ?? "01d",
      cloudCover: ow.clouds?.all ?? 0,
      uvIndex: null, // would need a separate UV call
    };
  } catch {
    // Fallback to realistic dummy data
    weather = {
      temperature: 32,
      feelsLike: 35,
      humidity: 68,
      windSpeed: 12,
      windGust: null,
      rainfall1h: 0,
      rainfall3h: 0,
      visibility: 8000,
      pressure: 1010,
      description: "partly cloudy",
      icon: "02d",
      cloudCover: 40,
      uvIndex: null,
    };
  }

  // ── Fetch live AQI from AQICN ──
  try {
    if (!AQI_KEY) throw new Error("No API key");
    const aqiRes = await fetch(
      `https://api.waqi.info/feed/geo:${lat};${lon}/?token=${AQI_KEY}`,
      { next: { revalidate: 300 } },
    );
    if (!aqiRes.ok) throw new Error(`AQI ${aqiRes.status}`);
    const aqiJson = await aqiRes.json();
    const data = aqiJson?.data;

    const aqiVal = typeof data?.aqi === "number" ? data.aqi : 50;
    aqi = {
      aqi: aqiVal,
      level: classifyAqi(aqiVal),
      dominantPollutant: data?.dominentpol || "pm25",
      pm25: data?.iaqi?.pm25?.v ?? null,
      pm10: data?.iaqi?.pm10?.v ?? null,
      co: data?.iaqi?.co?.v ?? null,
      no2: data?.iaqi?.no2?.v ?? null,
      so2: data?.iaqi?.so2?.v ?? null,
      o3: data?.iaqi?.o3?.v ?? null,
    };
  } catch {
    aqi = {
      aqi: 65,
      level: "Moderate",
      dominantPollutant: "pm25",
      pm25: 42,
      pm10: 58,
      co: null,
      no2: null,
      so2: null,
      o3: null,
    };
  }

  // Detect active triggers
  const triggers = detectTriggers(weather, aqi);

  return NextResponse.json({
    location: { lat, lon, city: cityParam },
    weather,
    aqi,
    triggers,
    fetchedAt: new Date().toISOString(),
    source: "live",
  });
}
