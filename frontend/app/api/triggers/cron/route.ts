import { NextResponse } from 'next/server';
import { checkWeatherTrigger, checkPollutionTrigger, checkPlatformOutageTrigger } from '@/backend/services/triggers';
import { getDb } from '@/backend/models/db';

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    const expectedSecret = process.env.CRON_SECRET || 'dev_secret_override_for_local';
    if (authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json({ error: 'Unauthorized CRON execution' }, { status: 401 });
    }

    const db = getDb();
    
    console.log('[CRON] Starting Global Zero-Touch Automation Engine...');

    // 1. Fetch all unique active zones where riders are operating today
    const zonesQuery = await db.prepare(`
      SELECT DISTINCT zone 
      FROM workers w
      JOIN policies p ON w.id = p.worker_id
      WHERE p.status = 'active'
    `).all() as { zone: string }[];
    
    const zones = zonesQuery.map(z => z.zone);
    if (zones.length === 0) {
      return NextResponse.json({ message: 'No active policies to monitor.' });
    }

    let totalPayoutsInitiated = 0;
    let eventsDetected = [];

    // 2. Iterate through each zone and check external APIs
    for (const zone of zones) {
      // In a real production system, coordinates would be fetched based on zone name
      // For this hackathon demo, we'll use base coordinates for Mumbai
      const [weather, pollution, platform] = await Promise.all([
        checkWeatherTrigger(), 
        checkPollutionTrigger(),
        checkPlatformOutageTrigger(),
      ]);

      const activeTriggers = [weather, pollution, platform].filter(t => t.triggered);
      
      if (activeTriggers.length > 0) {
        // 3. Log the disaster events globally for transparency
        for (const t of activeTriggers) {
          eventsDetected.push({ type: t.type, zone, severity: t.severity });
        }

        // 4. Find all active policies in this specific disaster zone
        const affectedWorkers = await db.prepare(`
          SELECT w.id as workerId, p.id as policyId, p.max_coverage_per_week, w.avg_weekly_income 
          FROM workers w
          JOIN policies p ON w.id = p.worker_id
          WHERE w.zone = ? AND p.status = 'active'
        `).all(zone) as any[];

        // 5. Automatically initiate payouts for everyone affected
        for (const worker of affectedWorkers) {
          for (const trigger of activeTriggers) {
            
            // Check if claim for same event already happened today
            const todayClaims = await db.prepare(`
              SELECT COUNT(*) as cnt FROM claims 
              WHERE worker_id = ? AND trigger_type = ? AND created_at >= date('now')
            `).get(worker.workerId, trigger.type) as { cnt: number };

            if (todayClaims.cnt > 0) {
              console.log(`Worker ${worker.workerId} already claimed for ${trigger.type} today.`);
              continue; // Skip duplicate daily trigger
            }

            // Check weekly claim limit
            const weekClaims = await db.prepare(`
               SELECT COALESCE(SUM(amount), 0) as total FROM claims 
               WHERE worker_id = ? AND created_at >= datetime('now', '-7 days')
            `).get(worker.workerId) as { total: number };

            if (weekClaims.total + trigger.payoutAmount > worker.max_coverage_per_week) {
              console.log(`Worker ${worker.workerId} reached max weekly coverage.`);
              continue; // Skip if it exceeds weekly coverage
            }

            // (Mocking the payout creation loop natively without hitting our own API via fetch)
            try {
              await db.prepare(`
                INSERT INTO claims (id, policy_id, worker_id, trigger_type, trigger_description, amount, status, zone, payout_method)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(
                crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
                worker.policyId,
                worker.workerId,
                trigger.type,
                trigger.description,
                trigger.payoutAmount, // In real life, calculate based on premium-engine.ts
                'paid', // Instantly paid!
                zone,
                'UPI'
              );
              totalPayoutsInitiated++;
            } catch (err) {
              console.error('Failed auto-payout for worker:', worker.workerId);
            }
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: '[CRON] Global zero-touch sweeping complete.',
      metrics: {
        zonesScanned: zones.length,
        eventsDetected: eventsDetected.length,
        totalPayoutsInitiated,
        eventDetails: eventsDetected
      }
    });

  } catch (error) {
    console.error('[CRON ERROR]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
