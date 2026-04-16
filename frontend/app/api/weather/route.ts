// GET /api/weather?city=Mumbai&zone=Andheri East
// Returns live weather data with trigger detection
import { NextRequest, NextResponse } from 'next/server';
import { fetchWeather } from '@/backend/engines/weather-engine';

export async function GET(req: NextRequest) {
  const city = req.nextUrl.searchParams.get('city') || 'Mumbai';
  const zone = req.nextUrl.searchParams.get('zone') || '';

  try {
    const weather = await fetchWeather(city, zone);
    return NextResponse.json(weather, {
      headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=60' },
    });
  } catch {
    return NextResponse.json(
      { error: 'Unable to fetch weather data' },
      { status: 500 },
    );
  }
}
