import test from "node:test";
import assert from "node:assert/strict";
import { fetchEnvironment, resolveEnvironmentLocation, environmentAlerts, validTime } from "../backend/src/services/environment";
import { TRIGGER_RULES } from "../backend/src/config/trigger-rules";
const now=Date.parse("2026-10-05T18:30:00Z"),hour=Math.floor(now/3600000)*3600;
const location=resolveEnvironmentLocation("Mumbai")!;
const weather={ current:{time:now/1000,temperature_2m:42,wind_speed_10m:0,relative_humidity_2m:0},current_units:{temperature_2m:"°C",wind_speed_10m:"km/h"},hourly:{time:[hour-3600,hour,hour+3600],rain:[0,30,99]},hourly_units:{rain:"mm"} };
const air={current:{time:hour,us_aqi:200,pm2_5:0,pm10:0},current_units:{us_aqi:"USAQI"}};
function provider(w: unknown=weather,a: unknown=air): typeof fetch { return (async (url: unknown)=>new Response(JSON.stringify(String(url).includes("air-quality")?a:w),{status:200})) as typeof fetch; }
test("known city/explicit coordinates only; no silent Mumbai fallback",()=>{
 assert.equal(resolveEnvironmentLocation("Unknown town"),null);assert.equal(resolveEnvironmentLocation("Mumbai","91","0"),null);assert.equal(resolveEnvironmentLocation("Mumbai",null,"0"),null);assert.equal(resolveEnvironmentLocation("Mumbai","","0"),null);assert.equal(resolveEnvironmentLocation("Mumbai","0","0")?.lat,0);
});
test("fresh data uses current preceding-hour rain, true zero and US AQI provenance",async()=>{
 const data=await fetchEnvironment(location,provider(),now);
 assert.equal(data.status,"available");assert.equal(data.weather?.rainfall1h,30);assert.equal(data.weather?.windSpeed,0);assert.equal(data.aqi?.pm25,0);assert.equal(data.aqi?.scale,"US AQI");assert.equal(data.triggers.length,3);assert.ok(data.triggers.every(t=>t.eligible===false));assert.equal(data.financialEffect,false);assert.equal(data.ruleVersion,TRIGGER_RULES.version);
});
test("provider outages, stale or invalid units fail closed without fabricated triggers",async()=>{
 const failed=(async()=>{throw Error("offline")}) as typeof fetch;
 const unavailable=await fetchEnvironment(location,failed,now);assert.equal(unavailable.status,"unavailable");assert.equal(unavailable.weather,null);assert.equal(unavailable.aqi,null);assert.deepEqual(unavailable.triggers,[]);
 const stale=await fetchEnvironment(location,provider({...weather,current:{...weather.current,time:(now-7200000)/1000}},{...air,current:{...air.current,time:(now-10800000)/1000}}),now);assert.equal(stale.status,"unavailable");assert.deepEqual(stale.triggers,[]);
 const bad=await fetchEnvironment(location,provider({...weather,current_units:{temperature_2m:"F",wind_speed_10m:"mph"}},{...air,current_units:{us_aqi:"Indian AQI"}}),now);assert.equal(bad.status,"unavailable");
 const empty=await fetchEnvironment(location,provider(null,null),now);assert.equal(empty.status,"unavailable");
 assert.equal(validTime((now+3600000)/1000,60,now),null);
});
test("partial sources remain unknown, future rain never leaks into threshold",async()=>{
 const data=await fetchEnvironment(location,provider({...weather,current:{...weather.current,temperature_2m:null},hourly:{time:[hour+3600],rain:[90]}},{}),now);
 assert.equal(data.status,"partial");assert.equal(data.weather?.temperature,null);assert.equal(data.weather?.rainfall1h,null);assert.equal(data.aqi,null);assert.deepEqual(data.triggers,[]);
 assert.deepEqual(environmentAlerts(null,null),[]);assert.deepEqual(environmentAlerts({temperature:41.9,rainfall1h:29.9},{aqi:199.9}),[]);
});
