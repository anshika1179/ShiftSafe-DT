import { createHash } from "node:crypto";
import { resolveEnvironmentLocation } from "../services/environment";
import { TRIGGER_RULES } from "../config/trigger-rules";
export const QUOTE_ASSUMPTIONS={version:"weather-proxy-2026-10-06",historyDays:365,minimumCompleteness:0.98,lossFractionDuringThreshold:0.5,expenseLoadFraction:0.15,weeklyLimitFraction:0.5,model:"ERA5",timezone:"Asia/Kolkata",perils:["hourly rain","temperature"]};
export interface QuoteInputs {city:string;zone:string;platform:string;income:number;weekdays:number[];startHour:number;endHour:number}
export function validQuoteInputs(i: QuoteInputs) {
 return ["Zomato","Swiggy"].includes(i.platform) && Number.isFinite(i.income) && i.income>=500 && i.income<=50000 && Array.isArray(i.weekdays) && i.weekdays.length>0 && i.weekdays.length<=7 && new Set(i.weekdays).size===i.weekdays.length && i.weekdays.every(d=>Number.isInteger(d)&&d>=0&&d<=6) && Number.isInteger(i.startHour)&&Number.isInteger(i.endHour)&&i.startHour>=0&&i.endHour<=24&&i.endHour>i.startHour;
}
export function quoteFingerprint(i: QuoteInputs) { return createHash("sha256").update(JSON.stringify({...i,weekdays:[...i.weekdays].sort(),assumptions:QUOTE_ASSUMPTIONS})).digest("hex"); }
export function historyWindow(now=new Date()) {
 // Five-day ERA5 availability lag. Date arithmetic uses UTC calendar days, not recalled weekdays.
 const end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-6));
 const start=new Date(end);start.setUTCDate(start.getUTCDate()-364);
 return {start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10)};
}
export function estimateFromHistory(input: QuoteInputs, data: unknown, window: {start:string;end:string}, sourceUrl:string) {
 const limitations=["Weather threshold hours are proxy exposure, not observed worker income losses.","No trained risk/fraud model, loss labels, holdout score or confidence probability is available.","Historical timestamps mark the end of each exposure hour. Rain is the preceding-hour sum; temperature is sampled at that end time.","Uniform weekly income per scheduled hour and 50% loss during threshold hours are configured assumptions.","City-center ERA5 reanalysis, roughly 0.25 degrees, not work-zone sensors. Air pollution, app outages and curfew are excluded.","Past-year season mix is not a next-week forecast or a binding insurance price. No money or cover."];
 const base={assumptions:QUOTE_ASSUMPTIONS,inputs:input,historyWindow:window,sourceUrl,limitations,financialEffect:false};
 if (!validQuoteInputs(input)) return {...base,status:"insufficient_data",reason:"Valid actual income and work schedule required"};
 const payload=data as {hourly?:{time?:unknown[];rain?:unknown[];temperature_2m?:unknown[]};hourly_units?:{rain?:string;temperature_2m?:string}} | null;
 if (payload?.hourly_units?.rain!=="mm" || payload?.hourly_units?.temperature_2m!=="°C") return {...base,status:"insufficient_data",reason:"Historical data units missing or incompatible"};
 const hourly=payload.hourly,times=hourly?.time;
 if (!Array.isArray(times)||!Array.isArray(hourly?.rain)||!Array.isArray(hourly?.temperature_2m)) return {...base,status:"insufficient_data",reason:"Historical data unavailable"};
 if(times.length!==hourly.rain.length||times.length!==hourly.temperature_2m.length)return {...base,status:"insufficient_data",reason:"Historical arrays differ in length"};
 let expected=0,valid=0,crossings=0,rainHours=0,heatHours=0;const seen=new Set<string>();
 for (let day=new Date(`${window.start}T00:00:00Z`);day.toISOString().slice(0,10)<=window.end;day.setUTCDate(day.getUTCDate()+1)) if(input.weekdays.includes(day.getUTCDay())) expected+=input.endHour-input.startHour;
 for(let n=0;n<times.length;n++) {
  const time=times[n];if(typeof time!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(time)||seen.has(time))continue;seen.add(time);
  const exposure=new Date(`${time}:00Z`);exposure.setUTCHours(exposure.getUTCHours()-1);const date=exposure.toISOString().slice(0,10),hour=exposure.getUTCHours(),weekday=exposure.getUTCDay();
  if(date<window.start||date>window.end||!input.weekdays.includes(weekday)||hour<input.startHour||hour>=input.endHour)continue;
  const rain=hourly.rain[n],temp=hourly.temperature_2m[n];if(typeof rain!=="number"||!Number.isFinite(rain)||rain<0||typeof temp!=="number"||!Number.isFinite(temp))continue;
  valid++;const r=rain>=TRIGGER_RULES.rainfallHourlyMm,h=temp>=TRIGGER_RULES.temperatureC;if(r)rainHours++;if(h)heatHours++;if(r||h)crossings++;
 }
 if(expected===0||valid/expected<QUOTE_ASSUMPTIONS.minimumCompleteness) return {...base,status:"insufficient_data",reason:"Less than 98% valid scheduled historical hours",sample:{expectedHours:expected,validHours:valid}};
 const probability=crossings/valid,weeklyHours=input.weekdays.length*(input.endHour-input.startHour),hourlyIncome=input.income/weeklyHours;
 const expectedLoss=probability*weeklyHours*hourlyIncome*QUOTE_ASSUMPTIONS.lossFractionDuringThreshold;
 return {...base,status:"estimated",sample:{expectedHours:expected,validHours:valid,thresholdHours:crossings,rainHours,heatHours},calculation:{thresholdHourFraction:probability,weeklyHours,hourlyIncome,expectedWeeklyProxyLoss:Math.round(expectedLoss*100)/100,expenseLoad:QUOTE_ASSUMPTIONS.expenseLoadFraction},weeklyPremium:Math.round(expectedLoss*(1+QUOTE_ASSUMPTIONS.expenseLoadFraction)*100)/100,coverageAmount:input.income*QUOTE_ASSUMPTIONS.weeklyLimitFraction};
}
export async function historicalQuote(input: QuoteInputs,fetcher:typeof fetch=fetch,now=new Date()) {
 const window=historyWindow(now),location=resolveEnvironmentLocation(input.city);
 if(!location||!validQuoteInputs(input))return {status:"insufficient_data",reason:"Supported city and explicit valid work schedule required",financialEffect:false};
 const url=new URL("https://archive-api.open-meteo.com/v1/archive");url.search=new URLSearchParams({latitude:String(location.lat),longitude:String(location.lon),start_date:window.start,end_date:new Date(new Date(`${window.end}T00:00:00Z`).getTime()+86400000).toISOString().slice(0,10),hourly:"temperature_2m,rain",models:"era5",timezone:"Asia/Kolkata"}).toString();
 try{const response=await fetcher(url.toString(),{signal:AbortSignal.timeout(15000),next:{revalidate:86400}});if(!response.ok)throw Error("provider unavailable");const payload=await response.json();if(payload.utc_offset_seconds!==19800)throw Error("provider timezone incompatible");return {...estimateFromHistory(input,payload,window,url.toString()),retrievedAt:now.toISOString(),location,attribution:"Open-Meteo / Copernicus ERA5, CC BY4.0"};}catch{return {status:"insufficient_data",reason:"Historical provider unavailable. No fixed city estimate was substituted.",inputs:input,assumptions:QUOTE_ASSUMPTIONS,historyWindow:window,sourceUrl:url.toString(),financialEffect:false};}
}
