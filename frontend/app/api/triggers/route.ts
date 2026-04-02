// POST /api/triggers — Check all trigger sources and auto-file claims
import { NextRequest, NextResponse } from 'next/server';
import { checkWeatherTrigger, checkPollutionTrigger, checkPlatformOutageTrigger, simulateTrigger } from '@/backend/services/triggers';
import { getDb } from '@/backend/models/db';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { workerId, zone, simulate, triggerType, severity } = body;

    // Manual simulation mode for demo
    if (simulate && triggerType) {
      const trigger = simulateTrigger(triggerType, severity || 'high');

      if (workerId) {
        // Auto-file claim
        const claimRes = await fetch(new URL('/api/claims', req.url), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workerId,
            triggerType: trigger.type,
            severity: trigger.severity,
            zone: zone || 'Andheri West',
          }),
        });
        const claimData = await claimRes.json();

        return NextResponse.json({
          trigger,
          claim: claimData,
        });
      }

      return NextResponse.json({ trigger });
    }

    // Real trigger check
    const [weather, pollution, platform] = await Promise.all([
      checkWeatherTrigger(),
      checkPollutionTrigger(),
      checkPlatformOutageTrigger(),
    ]);

    const triggers = [weather, pollution, platform].filter(t => t.triggered);

    // Log trigger events
    const db = getDb();
    for (const t of [weather, pollution, platform]) {
      await db.prepare(`INSERT INTO trigger_events (id, event_type, zone, severity, raw_data, source, is_processed)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        crypto.randomUUID(), t.type, zone || 'Andheri West', t.severity,
        JSON.stringify(t.rawData), t.sourceApi, t.triggered ? 1 : 0
      );
    }

    // Auto-file claims for triggered events
    const claims = [];
    if (workerId && triggers.length > 0) {
      for (const t of triggers) {
        try {
          const claimRes = await fetch(new URL('/api/claims', req.url), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              workerId,
              triggerType: t.type,
              severity: t.severity,
              zone: zone || 'Andheri West',
            }),
          });
          const claimData = await claimRes.json();
          claims.push(claimData);
        } catch {
          // Continue checking other triggers
        }
      }
    }

    return NextResponse.json({
      checked: {
        weather: { ...weather },
        pollution: { ...pollution },
        platform: { ...platform },
      },
      triggeredCount: triggers.length,
      claims,
    });
  } catch (err) {
    console.error('Trigger check error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
