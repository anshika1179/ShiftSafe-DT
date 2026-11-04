import { TRIGGER_RULES } from "../config/trigger-rules";
export interface EnvironmentLocation { lat: number; lon: number; city: string; source: "city_map" | "device_coordinates"; precision: "city_center" | "client_reported" }
const CITIES: Record<string, [number, number]> = { mumbai: [19.076,72.8777], delhi: [28.6139,77.209], bengaluru: [12.9716,77.5946], hyderabad: [17.385,78.4867], pune: [18.5204,73.8567], chennai: [13.0827,80.2707], gurugram: [28.4595,77.0266], noida: [28.5355,77.391], jaipur: [26.9124,75.7873], lucknow: [26.8467,80.9462], ahmedabad: [23.0225,72.5714], kolkata: [22.5726,88.3639], vadodara:[22.3072,73.1812], surat:[21.1702,72.8311], indore:[22.7196,75.8577], bhopal:[23.2599,77.4126], patna:[25.6093,85.1376], chandigarh:[30.7333,76.7794], nagpur:[21.1458,79.0882], coimbatore:[11.0168,76.9558], visakhapatnam:[17.6868,83.2185], kochi:[9.9312,76.2673], thiruvananthapuram:[8.5241,76.9366], mysuru:[12.2958,76.6394], guwahati:[26.1445,91.7362], ranchi:[23.3441,85.3096], rajkot:[22.3039,70.8022], gandhinagar:[23.2156,72.6369], nashik:[19.9975,73.7898], thane:[19.2183,72.9781] };
export function resolveEnvironmentLocation(city: string, lat?: unknown, lon?: unknown): EnvironmentLocation | null {
  const label = city.trim();
  if (lat !== undefined || lon !== undefined) {
    if (lat === "" || lon === "" || lat === null || lon === null || lat === undefined || lon === undefined) return null;
    const a = Number(lat), b = Number(lon);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < -90 || a > 90 || b < -180 || b > 180) return null;
    return {lat:a,lon:b,city:label,source:"device_coordinates",precision:"client_reported"};
  }
  const key = label.toLowerCase().replace(/^new delhi$/, "delhi").replace(/^bangalore$/, "bengaluru");
  const coords = CITIES[key];
  return coords ? {lat:coords[0],lon:coords[1],city:label,source:"city_map",precision:"city_center"} : null;
}
export function validTime(time: unknown, maxMinutes: number, now = Date.now()) {
  if (typeof time !== "number" || !Number.isFinite(time)) return null;
  const age = now - time * 1000;
  return age >= -5 * 60000 && age <= maxMinutes * 60000 ? new Date(time * 1000).toISOString() : null;
}
const value = (n: unknown) => typeof n === "number" && Number.isFinite(n) ? n : null;
export function classifyUsAqi(aqi: number) { return aqi<=50?"Good":aqi<=100?"Moderate":aqi<=150?"Unhealthy for sensitive groups":aqi<=200?"Unhealthy":aqi<=300?"Very unhealthy":"Hazardous"; }
export interface EnvironmentalAlert { type: string; emoji: string; title: string; severity: "moderate" | "high" | "severe"; value: string; eligible: false; rulesVersion: string }
export function environmentAlerts(weather: { temperature: number | null; rainfall1h: number | null } | null, aqi: { aqi: number | null } | null): EnvironmentalAlert[] {
  const alerts: EnvironmentalAlert[] = [];
  const add = (type: string,emoji: string,title: string,text: string) => alerts.push({type,emoji,title,severity:"moderate",value:text,eligible:false,rulesVersion:TRIGGER_RULES.version});
  if (weather?.rainfall1h !== null && weather?.rainfall1h !== undefined && weather.rainfall1h >= TRIGGER_RULES.rainfallHourlyMm) add("heavy_rain","🌧️","Configured rain threshold",`${weather.rainfall1h} mm over the preceding hour`);
  if (weather?.temperature !== null && weather?.temperature !== undefined && weather.temperature >= TRIGGER_RULES.temperatureC) add("heatwave","🌡️","Configured heat threshold",`${weather.temperature} °C modelled temperature`);
  if (aqi?.aqi !== null && aqi?.aqi !== undefined && aqi.aqi >= TRIGGER_RULES.usAqi) add("pollution","😷","Configured US AQI threshold",`US AQI ${aqi.aqi}, not Indian AQI`);
  return alerts;
}
export async function fetchEnvironment(location: EnvironmentLocation, fetcher: typeof fetch = fetch, now = Date.now()) {
  const forecast = new URL("https://api.open-meteo.com/v1/forecast");
  forecast.search = new URLSearchParams({latitude:String(location.lat),longitude:String(location.lon),current:"temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,cloud_cover,surface_pressure",hourly:"rain",past_hours:"3",forecast_hours:"1",timeformat:"unixtime",timezone:"UTC"}).toString();
  const air = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
  air.search = new URLSearchParams({latitude:String(location.lat),longitude:String(location.lon),current:"us_aqi,pm2_5,pm10",domains:"cams_global",timeformat:"unixtime",timezone:"UTC"}).toString();
  const read = async (url: URL) => {
    const response = await fetcher(url.toString(), { signal: AbortSignal.timeout(8000), next: { revalidate: 300 } });
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
    return await response.json();
  };
  const [w,a] = await Promise.allSettled([read(forecast),read(air)]);
  let weather: ({ temperature: number | null; rainfall1h: number | null } & Record<string, unknown>) | null = null;
  let aqi: ({ aqi: number | null } & Record<string, unknown>) | null = null;
  const issues: string[] = [];
  if (w.status === "fulfilled") {
    const d=w.value, c=d?.current, observedAt=validTime(c?.time,TRIGGER_RULES.maxWeatherAgeMinutes,now);
    if (observedAt && d?.current_units?.temperature_2m === "°C" && d?.current_units?.wind_speed_10m === "km/h") {
      let rainfall1h: number | null = null, rainObservedAt: string | null = null;
      if (d?.hourly_units?.rain === "mm" && Array.isArray(d.hourly?.time) && Array.isArray(d.hourly?.rain)) {
        const times=d.hourly.time as unknown[];
        const indices=times.map((t,i)=>({t:typeof t==="number"?t:Infinity,i})).filter(x=>x.t*1000<=now && now-x.t*1000<=TRIGGER_RULES.maxWeatherAgeMinutes*60000).sort((x,y)=>y.t-x.t);
        if (indices.length) { const chosen=indices[0];rainfall1h=value(d.hourly.rain[chosen.i]);rainObservedAt=new Date(chosen.t*1000).toISOString(); }
      }
      weather={temperature:value(c.temperature_2m),feelsLike:value(c.apparent_temperature),humidity:value(c.relative_humidity_2m),windSpeed:value(c.wind_speed_10m),windGust:value(c.wind_gusts_10m),rainfall1h,rainfall3h:null,visibility:null,pressure:value(c.surface_pressure),cloudCover:value(c.cloud_cover),description:"Modelled current conditions",icon:"",uvIndex:null,observedAt,rainObservedAt,rainInterval:"preceding_hour",units:{temperature:"°C",rain:"mm/hour",wind:"km/h"},quality:"modelled",providerUrl:forecast.toString()};
    } else issues.push("Weather timestamp or units missing/stale/invalid");
  } else issues.push("Weather provider unavailable");
  if (a.status === "fulfilled") {
    const d=a.value,c=d?.current,observedAt=validTime(c?.time,TRIGGER_RULES.maxAirAgeMinutes,now);
    if (observedAt && d?.current_units?.us_aqi === "USAQI") {
      const index=value(c.us_aqi);
      aqi={aqi:index,level:index===null?"Unavailable":classifyUsAqi(index),scale:"US AQI",dominantPollutant:"Not determined",pm25:value(c.pm2_5),pm10:value(c.pm10),observedAt,quality:"modelled_cams_global",spatialResolution:"approximately 45 km",units:{aqi:"US AQI",particulates:"µg/m³"},providerUrl:air.toString()};
    } else issues.push("Air quality timestamp or units missing/stale/invalid");
  } else issues.push("Air quality provider unavailable");
  const complete = weather?.temperature != null && weather?.rainfall1h != null && aqi?.aqi != null;
  if (weather && (weather.temperature == null || weather.rainfall1h == null)) issues.push("Some weather values unavailable");
  if (aqi && aqi.aqi == null) issues.push("US AQI unavailable");
  return {location,weather,aqi,triggers:environmentAlerts(weather,aqi),fetchedAt:new Date(now).toISOString(),source:"open-meteo-modelled",status:complete?"available":weather||aqi?"partial":"unavailable",issues,ruleVersion:TRIGGER_RULES.version,financialEffect:false,attribution:{weather:"https://open-meteo.com/",air:"https://atmosphere.copernicus.eu/",terms:"https://open-meteo.com/en/terms"},limitations:"Noncommercial prototype. Modelled estimates, not verified street sensors or insured events. US AQI is not Indian AQI. No payment eligibility is established."};
}
