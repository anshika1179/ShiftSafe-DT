/*
 * Weather Engine — Live weather data integration
 *
 * Fetches real-time weather, AQI, and environmental data from
 * OpenWeatherMap free tier API. Falls back to intelligent
 * estimates based on city/season when API key is unavailable.
 *
 * Used by: /api/weather route, monitoring page, dashboard pills
 */

export interface WeatherData {
  temperature: number;      // °C
  feelsLike: number;        // °C
  humidity: number;         // %
  rainfall: number;         // mm (last 1h)
  windSpeed: number;        // km/h
  aqi: number;              // Air Quality Index (1-500)
  aqiLabel: string;         // Good/Moderate/Unhealthy/Hazardous
  description: string;      // e.g. "heavy rain", "clear sky"
  icon: string;             // emoji
  city: string;
  zone: string;
  source: 'live' | 'estimated';
  fetchedAt: string;
  // Trigger detection
  triggers: WeatherTrigger[];
}

export interface WeatherTrigger {
  type: string;
  active: boolean;
  severity: 'moderate' | 'high' | 'severe';
  currentValue: string;
  threshold: string;
  emoji: string;
}

// Trigger thresholds (from the existing payout table)
const THRESHOLDS = {
  heavy_rain: { moderate: 30, high: 50, severe: 80 },      // mm/hr
  heatwave: { moderate: 38, high: 42, severe: 45 },        // °C
  pollution: { moderate: 150, high: 300, severe: 400 },     // AQI
  wind: { moderate: 40, high: 60, severe: 80 },             // km/h
};

function getAqiLabel(aqi: number): string {
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy (Sensitive)';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very Unhealthy';
  return 'Hazardous';
}

function getWeatherEmoji(desc: string, temp: number): string {
  const d = desc.toLowerCase();
  if (d.includes('thunder')) return '⛈️';
  if (d.includes('heavy rain') || d.includes('extreme rain')) return '🌧️';
  if (d.includes('rain') || d.includes('drizzle')) return '🌦️';
  if (d.includes('snow')) return '❄️';
  if (d.includes('fog') || d.includes('mist') || d.includes('haze')) return '🌫️';
  if (d.includes('cloud')) return '☁️';
  if (temp > 40) return '🔥';
  if (temp > 35) return '☀️';
  return '🌤️';
}

function detectTriggers(data: { temperature: number; rainfall: number; aqi: number; windSpeed: number }): WeatherTrigger[] {
  const triggers: WeatherTrigger[] = [];

  // Heavy rain trigger
  const rainSev = data.rainfall >= THRESHOLDS.heavy_rain.severe ? 'severe'
    : data.rainfall >= THRESHOLDS.heavy_rain.high ? 'high'
    : data.rainfall >= THRESHOLDS.heavy_rain.moderate ? 'moderate'
    : null;
  triggers.push({
    type: 'heavy_rain',
    active: rainSev !== null,
    severity: rainSev || 'moderate',
    currentValue: `${data.rainfall.toFixed(1)}mm`,
    threshold: `${THRESHOLDS.heavy_rain.moderate}mm`,
    emoji: '🌧️',
  });

  // Heatwave trigger
  const heatSev = data.temperature >= THRESHOLDS.heatwave.severe ? 'severe'
    : data.temperature >= THRESHOLDS.heatwave.high ? 'high'
    : data.temperature >= THRESHOLDS.heatwave.moderate ? 'moderate'
    : null;
  triggers.push({
    type: 'heatwave',
    active: heatSev !== null,
    severity: heatSev || 'moderate',
    currentValue: `${data.temperature.toFixed(1)}°C`,
    threshold: `${THRESHOLDS.heatwave.moderate}°C`,
    emoji: '🌡️',
  });

  // Pollution trigger
  const aqiSev = data.aqi >= THRESHOLDS.pollution.severe ? 'severe'
    : data.aqi >= THRESHOLDS.pollution.high ? 'high'
    : data.aqi >= THRESHOLDS.pollution.moderate ? 'moderate'
    : null;
  triggers.push({
    type: 'pollution',
    active: aqiSev !== null,
    severity: aqiSev || 'moderate',
    currentValue: `AQI ${data.aqi}`,
    threshold: `AQI ${THRESHOLDS.pollution.moderate}`,
    emoji: '😷',
  });

  // Wind trigger
  const windSev = data.windSpeed >= THRESHOLDS.wind.severe ? 'severe'
    : data.windSpeed >= THRESHOLDS.wind.high ? 'high'
    : data.windSpeed >= THRESHOLDS.wind.moderate ? 'moderate'
    : null;
  triggers.push({
    type: 'wind',
    active: windSev !== null,
    severity: windSev || 'moderate',
    currentValue: `${data.windSpeed.toFixed(0)} km/h`,
    threshold: `${THRESHOLDS.wind.moderate} km/h`,
    emoji: '💨',
  });

  return triggers;
}

// City coordinates for Indian metros
const CITY_COORDS: Record<string, { lat: number; lon: number }> = {
  'Mumbai': { lat: 19.076, lon: 72.8777 },
  'Delhi': { lat: 28.6139, lon: 77.209 },
  'Bangalore': { lat: 12.9716, lon: 77.5946 },
  'Bengaluru': { lat: 12.9716, lon: 77.5946 },
  'Chennai': { lat: 13.0827, lon: 80.2707 },
  'Hyderabad': { lat: 17.385, lon: 78.4867 },
  'Kolkata': { lat: 22.5726, lon: 88.3639 },
  'Pune': { lat: 18.5204, lon: 73.8567 },
  'Ahmedabad': { lat: 23.0225, lon: 72.5714 },
  'Jaipur': { lat: 26.9124, lon: 75.7873 },
  'Lucknow': { lat: 26.8467, lon: 80.9462 },
};

// Seasonal estimates when API is unavailable
function getSeasonalEstimate(city: string): WeatherData {
  const month = new Date().getMonth() + 1; // 1-12
  const coords = CITY_COORDS[city] || CITY_COORDS['Mumbai'];
  const isNorth = coords.lat > 20;

  // Base temps by season and region
  let temp: number, rain: number, aqi: number, wind: number;
  let desc: string;

  if (month >= 6 && month <= 9) {
    // Monsoon
    temp = isNorth ? 32 + Math.random() * 5 : 28 + Math.random() * 4;
    rain = 15 + Math.random() * 60;
    aqi = 40 + Math.random() * 60;
    wind = 15 + Math.random() * 20;
    desc = rain > 50 ? 'heavy rain' : 'moderate rain';
  } else if (month >= 10 && month <= 12) {
    // Post-monsoon / winter start
    temp = isNorth ? 18 + Math.random() * 10 : 26 + Math.random() * 6;
    rain = Math.random() * 5;
    aqi = isNorth ? 200 + Math.random() * 250 : 80 + Math.random() * 80;
    wind = 8 + Math.random() * 12;
    desc = aqi > 300 ? 'haze' : 'partly cloudy';
  } else if (month >= 1 && month <= 2) {
    // Winter
    temp = isNorth ? 8 + Math.random() * 12 : 22 + Math.random() * 8;
    rain = Math.random() * 3;
    aqi = isNorth ? 250 + Math.random() * 200 : 60 + Math.random() * 80;
    wind = 6 + Math.random() * 10;
    desc = isNorth ? 'fog' : 'clear sky';
  } else {
    // Summer (Mar-May)
    temp = isNorth ? 35 + Math.random() * 12 : 32 + Math.random() * 8;
    rain = Math.random() * 2;
    aqi = 80 + Math.random() * 120;
    wind = 10 + Math.random() * 15;
    desc = temp > 42 ? 'extreme heat' : 'clear sky';
  }

  temp = Math.round(temp * 10) / 10;
  rain = Math.round(rain * 10) / 10;
  aqi = Math.round(aqi);
  wind = Math.round(wind * 10) / 10;

  const triggers = detectTriggers({ temperature: temp, rainfall: rain, aqi, windSpeed: wind });

  return {
    temperature: temp,
    feelsLike: temp + (rain > 0 ? -2 : 3),
    humidity: rain > 0 ? 75 + Math.random() * 20 : 40 + Math.random() * 30,
    rainfall: rain,
    windSpeed: wind,
    aqi,
    aqiLabel: getAqiLabel(aqi),
    description: desc,
    icon: getWeatherEmoji(desc, temp),
    city,
    zone: '',
    source: 'estimated',
    fetchedAt: new Date().toISOString(),
    triggers,
  };
}

/**
 * Fetch live weather data from OpenWeatherMap.
 * Falls back to seasonal estimates if API key is missing or call fails.
 */
export async function fetchWeather(city: string, zone?: string): Promise<WeatherData> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  const coords = CITY_COORDS[city] || CITY_COORDS['Mumbai'];

  if (!apiKey) {
    const estimate = getSeasonalEstimate(city);
    estimate.zone = zone || '';
    return estimate;
  }

  try {
    // Fetch current weather
    const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${coords.lat}&lon=${coords.lon}&appid=${apiKey}&units=metric`;
    const weatherRes = await fetch(weatherUrl, { next: { revalidate: 300 } });

    if (!weatherRes.ok) {
      const estimate = getSeasonalEstimate(city);
      estimate.zone = zone || '';
      return estimate;
    }

    const w = await weatherRes.json();

    const temperature = w.main?.temp ?? 30;
    const feelsLike = w.main?.feels_like ?? temperature;
    const humidity = w.main?.humidity ?? 50;
    const rainfall = w.rain?.['1h'] ?? w.rain?.['3h'] ?? 0;
    const windSpeed = (w.wind?.speed ?? 0) * 3.6; // m/s → km/h
    const description = w.weather?.[0]?.description || 'clear sky';

    // Fetch AQI
    let aqi = 50;
    try {
      const aqiUrl = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${coords.lat}&lon=${coords.lon}&appid=${apiKey}`;
      const aqiRes = await fetch(aqiUrl, { next: { revalidate: 300 } });
      if (aqiRes.ok) {
        const aqiData = await aqiRes.json();
        // OWM returns 1-5 scale, we convert to AQI-like value
        const owmAqi = aqiData.list?.[0]?.main?.aqi ?? 1;
        const pm25 = aqiData.list?.[0]?.components?.pm2_5 ?? 10;
        // Approximate AQI from PM2.5
        aqi = Math.round(pm25 * 4.2);
        if (owmAqi >= 5) aqi = Math.max(aqi, 400);
        else if (owmAqi >= 4) aqi = Math.max(aqi, 250);
        else if (owmAqi >= 3) aqi = Math.max(aqi, 120);
      }
    } catch {
      // Use default AQI
    }

    const triggers = detectTriggers({ temperature, rainfall, aqi, windSpeed });

    return {
      temperature: Math.round(temperature * 10) / 10,
      feelsLike: Math.round(feelsLike * 10) / 10,
      humidity: Math.round(humidity),
      rainfall: Math.round(rainfall * 10) / 10,
      windSpeed: Math.round(windSpeed * 10) / 10,
      aqi,
      aqiLabel: getAqiLabel(aqi),
      description,
      icon: getWeatherEmoji(description, temperature),
      city,
      zone: zone || '',
      source: 'live',
      fetchedAt: new Date().toISOString(),
      triggers,
    };
  } catch {
    const estimate = getSeasonalEstimate(city);
    estimate.zone = zone || '';
    return estimate;
  }
}
