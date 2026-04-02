import { Pool } from '@neondatabase/serverless';

// singleton pattern
let _pool: Pool | null = null;
let _dbWrapper: any = null;

export function getDb() {
  if (!_dbWrapper) {
    if (!process.env.DATABASE_URL) {
      console.warn('DATABASE_URL is not set. Database operations will fail.');
    }
    const connectionString = process.env.DATABASE_URL || 'postgresql://dummy:dummy@dummy/dummy';
    _pool = new Pool({ connectionString });

    _dbWrapper = {
      async run(query: string, ...params: any[]) {
        let i = 1;
        const pgQuery = query.replace(/\?/g, () => `$${i++}`);
        await _pool!.query(pgQuery, params);
        return { changes: 1 };
      },
      async get(query: string, ...params: any[]) {
        let i = 1;
        const pgQuery = query.replace(/\?/g, () => `$${i++}`);
        const result = await _pool!.query(pgQuery, params);
        return result.rows[0] || undefined;
      },
      async all(query: string, ...params: any[]) {
        let i = 1;
        const pgQuery = query.replace(/\?/g, () => `$${i++}`);
        const result = await _pool!.query(pgQuery, params);
        return result.rows;
      },
      prepare(query: string) {
        return {
          run: async (...params: any[]) => this.run(query, ...params),
          get: async (...params: any[]) => this.get(query, ...params),
          all: async (...params: any[]) => this.all(query, ...params),
        };
      },
      async exec(query: string) {
        // Neon doesn't inherently support massive batched SQL strictly via standard tagged templates if they have strange formatting.
        // We will do a generic pass to split commands.
        const statements = query.split(';').map(s => s.trim()).filter(Boolean);
        for (const stmt of statements) {
          await _pool!.query(stmt);
        }
      }
    };
  }
  return _dbWrapper;
}

export async function initDb() {
  const db = getDb();
  await initSchema(db);
  await seedDemoData(db);
}

async function initSchema(db: any) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS workers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      email TEXT,
      platform TEXT NOT NULL,
      city TEXT NOT NULL,
      zone TEXT NOT NULL,
      shift_type TEXT NOT NULL DEFAULT 'full_day',
      avg_weekly_income REAL DEFAULT 4000,
      vehicle_type TEXT DEFAULT 'bike',
      risk_score REAL DEFAULT 0.5,
      status TEXT DEFAULT 'active',
      is_active INTEGER DEFAULT 1,
      insurance_opted_out INTEGER DEFAULT 0,
      active_delivery_days INTEGER DEFAULT 0,
      days_worked_this_week INTEGER DEFAULT 0,
      activity_tier TEXT DEFAULT 'standard',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS policies (
      id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL,
      plan_name TEXT DEFAULT 'ShiftGuard Basic',
      coverage_type TEXT DEFAULT 'weather_income_loss',
      premium_tier TEXT DEFAULT 'standard',
      weekly_premium REAL NOT NULL,
      max_coverage_per_week REAL DEFAULT 2000,
      max_payout_percent REAL DEFAULT 50.0,
      coverage_events TEXT DEFAULT '["heavy_rain","heatwave","pollution","platform_outage","curfew"]',
      status TEXT DEFAULT 'active',
      start_date TEXT DEFAULT CURRENT_DATE,
      end_date TEXT,
      auto_renew INTEGER DEFAULT 1,
      city_pool TEXT DEFAULT 'mumbai_rain',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (worker_id) REFERENCES workers(id)
    );

    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      trigger_description TEXT,
      amount REAL NOT NULL,
      status TEXT DEFAULT 'auto_approved',
      zone TEXT,
      payout_method TEXT DEFAULT 'UPI',
      payout_channel TEXT DEFAULT 'UPI',
      settlement_status TEXT DEFAULT 'completed',
      evidence_data TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (policy_id) REFERENCES policies(id),
      FOREIGN KEY (worker_id) REFERENCES workers(id)
    );

    CREATE TABLE IF NOT EXISTS trigger_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      zone TEXT NOT NULL,
      city TEXT DEFAULT 'Mumbai',
      severity TEXT DEFAULT 'moderate',
      raw_data TEXT,
      source TEXT DEFAULT 'simulated',
      detected_at TEXT DEFAULT CURRENT_TIMESTAMP,
      is_processed INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS premium_history (
      id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL,
      amount REAL NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      status TEXT DEFAULT 'paid',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (worker_id) REFERENCES workers(id)
    );

    CREATE TABLE IF NOT EXISTS premium_calculations (
      id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL,
      base_premium REAL NOT NULL,
      zone_risk_factor REAL DEFAULT 0,
      weather_risk_factor REAL DEFAULT 0,
      historical_claim_factor REAL DEFAULT 0,
      platform_risk_factor REAL DEFAULT 0,
      final_premium REAL NOT NULL,
      factors_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (worker_id) REFERENCES workers(id)
    );

    CREATE TABLE IF NOT EXISTS settlements (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      amount REAL NOT NULL,
      channel TEXT DEFAULT 'UPI',
      fallback_channel TEXT,
      upi_id TEXT,
      bank_account TEXT,
      status TEXT DEFAULT 'initiated',
      initiated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      failure_reason TEXT,
      retry_count INTEGER DEFAULT 0,
      transaction_ref TEXT,
      FOREIGN KEY (claim_id) REFERENCES claims(id),
      FOREIGN KEY (worker_id) REFERENCES workers(id)
    );

    CREATE TABLE IF NOT EXISTS actuarial_metrics (
      id TEXT PRIMARY KEY,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      total_premium_collected REAL NOT NULL,
      total_claims_paid REAL NOT NULL,
      bcr REAL NOT NULL,
      loss_ratio REAL NOT NULL,
      active_policies INTEGER NOT NULL,
      total_workers INTEGER NOT NULL,
      scenario_type TEXT DEFAULT 'normal',
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stress_scenarios (
      id TEXT PRIMARY KEY,
      scenario_name TEXT NOT NULL,
      scenario_type TEXT NOT NULL,
      duration_days INTEGER NOT NULL,
      trigger_frequency REAL NOT NULL,
      avg_payout_per_day REAL NOT NULL,
      total_estimated_payout REAL NOT NULL,
      total_premium_in_period REAL NOT NULL,
      bcr_under_stress REAL NOT NULL,
      loss_ratio_under_stress REAL NOT NULL,
      is_sustainable INTEGER DEFAULT 1,
      recommendation TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS weekly_activity_log (
      id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL,
      week_start TEXT NOT NULL,
      days_active INTEGER DEFAULT 0,
      total_deliveries INTEGER DEFAULT 0,
      total_earnings REAL DEFAULT 0,
      is_eligible INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (worker_id) REFERENCES workers(id)
    );
  `);
}

/**
 * Seed 4 hypothetical workers with weekly data
 * as per coffee chat feedback — at least 3-4 entries, not 1000
 */
async function seedDemoData(db: any) {
  const existingCount = (await db.prepare('SELECT COUNT(*) as cnt FROM workers').get())?.cnt || 0;
  if (existingCount >= 4) return; // already seeded

  const now = new Date().toISOString();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const today = new Date().toISOString().split('T')[0];

  // worker 1: ravi kumar — delhi, high activity, aqi risk
  const w1 = 'WRK-DEMO-001';
  const p1 = 'POL-DEMO-001';
  await db.prepare(`INSERT INTO workers (id, name, phone, email, platform, city, zone, shift_type, avg_weekly_income, vehicle_type, risk_score, status, is_active, active_delivery_days, days_worked_this_week, activity_tier, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(
    w1, 'Ravi Kumar', '9876543210', 'ravi@example.com', 'Zomato', 'Delhi', 'Connaught Place',
    'full_day', 5600, 'bike', 0.65, 'active', 1, 21, 6, 'standard', now
  );
  await db.prepare(`INSERT INTO policies (id, worker_id, plan_name, premium_tier, weekly_premium, max_coverage_per_week, max_payout_percent, status, start_date, city_pool, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(
    p1, w1, 'ShiftGuard Weekly', 'standard', 35, 2000, 50.0, 'active', weekAgo, 'delhi_aqi', now
  );
  await db.prepare(`INSERT INTO weekly_activity_log (id, worker_id, week_start, days_active, total_deliveries, total_earnings, is_eligible, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(
    'WAL-001', w1, weekAgo, 6, 42, 5600, 1, now
  );
  // Ravi's claim — AQI trigger
  await db.prepare(`INSERT INTO claims (id, policy_id, worker_id, trigger_type, trigger_description, amount, status, zone, payout_method, payout_channel, settlement_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(
    'CLM-DEMO-001', p1, w1, 'pollution', 'AQI 380 — severe pollution in Delhi NCR', 500, 'auto_approved', 'Connaught Place', 'UPI', 'UPI', 'completed', now
  );

  // worker 2: priya sharma — mumbai, rain risk
  const w2 = 'WRK-DEMO-002';
  const p2 = 'POL-DEMO-002';
  await db.prepare(`INSERT INTO workers (id, name, phone, email, platform, city, zone, shift_type, avg_weekly_income, vehicle_type, risk_score, status, is_active, active_delivery_days, days_worked_this_week, activity_tier, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(
    w2, 'Priya Sharma', '9876543211', 'priya@example.com', 'Swiggy', 'Mumbai', 'Andheri East',
    'full_day', 4200, 'bike', 0.55, 'active', 1, 28, 7, 'premium', now
  );
  await db.prepare(`INSERT INTO policies (id, worker_id, plan_name, premium_tier, weekly_premium, max_coverage_per_week, max_payout_percent, status, start_date, city_pool, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(
    p2, w2, 'ShiftGuard Weekly', 'premium', 40, 2500, 50.0, 'active', weekAgo, 'mumbai_rain', now
  );
  await db.prepare(`INSERT INTO weekly_activity_log (id, worker_id, week_start, days_active, total_deliveries, total_earnings, is_eligible, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(
    'WAL-002', w2, weekAgo, 7, 56, 4200, 1, now
  );
  // Priya's claim — heavy rain
  await db.prepare(`INSERT INTO claims (id, policy_id, worker_id, trigger_type, trigger_description, amount, status, zone, payout_method, payout_channel, settlement_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(
    'CLM-DEMO-002', p2, w2, 'heavy_rain', 'Heavy rainfall 55mm/hr — Andheri East flooded', 300, 'auto_approved', 'Andheri East', 'UPI', 'UPI', 'completed', now
  );

  // worker 3: arjun patel — delhi, lower activity (not eligible yet)
  const w3 = 'WRK-DEMO-003';
  const p3 = 'POL-DEMO-003';
  await db.prepare(`INSERT INTO workers (id, name, phone, email, platform, city, zone, shift_type, avg_weekly_income, vehicle_type, risk_score, status, is_active, active_delivery_days, days_worked_this_week, activity_tier, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(
    w3, 'Arjun Patel', '9876543212', 'arjun@example.com', 'Blinkit', 'Delhi', 'Lajpat Nagar',
    'morning', 3200, 'bike', 0.40, 'active', 1, 4, 3, 'basic', now
  );
  await db.prepare(`INSERT INTO policies (id, worker_id, plan_name, premium_tier, weekly_premium, max_coverage_per_week, max_payout_percent, status, start_date, city_pool, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(
    p3, w3, 'ShiftGuard Basic', 'basic', 20, 1500, 50.0, 'pending', weekAgo, 'delhi_aqi', now
  );
  await db.prepare(`INSERT INTO weekly_activity_log (id, worker_id, week_start, days_active, total_deliveries, total_earnings, is_eligible, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(
    'WAL-003', w3, weekAgo, 3, 18, 3200, 0, now
  );

  // worker 4: meera joshi — gurugram, opted out of insurance
  const w4 = 'WRK-DEMO-004';
  await db.prepare(`INSERT INTO workers (id, name, phone, email, platform, city, zone, shift_type, avg_weekly_income, vehicle_type, risk_score, status, is_active, insurance_opted_out, active_delivery_days, days_worked_this_week, activity_tier, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(
    w4, 'Meera Joshi', '9876543213', 'meera@example.com', 'Zepto', 'Gurugram', 'Cyber City',
    'evening', 3800, 'scooter', 0.35, 'active', 1, 1, 15, 5, 'standard', now
  );

  // seed actuarial metrics (weekly data)
  const weeks = [
    { start: '2026-03-03', end: '2026-03-09', premiums: 520, claims: 300, policies: 4, workers: 4, scenario: 'normal' },
    { start: '2026-03-10', end: '2026-03-16', premiums: 520, claims: 200, policies: 4, workers: 4, scenario: 'normal' },
    { start: '2026-03-17', end: '2026-03-23', premiums: 520, claims: 500, policies: 4, workers: 4, scenario: 'normal' },
    { start: '2026-03-24', end: '2026-03-30', premiums: 520, claims: 350, policies: 4, workers: 4, scenario: 'normal' },
  ];
  for (const w of weeks) {
    const bcr = w.claims / w.premiums;
    const lossRatio = (w.claims / w.premiums) * 100;
    await db.prepare(`INSERT INTO actuarial_metrics (id, period_start, period_end, total_premium_collected, total_claims_paid, bcr, loss_ratio, active_policies, total_workers, scenario_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(
      `ACT-${w.start}`, w.start, w.end, w.premiums, w.claims, parseFloat(bcr.toFixed(2)), parseFloat(lossRatio.toFixed(1)), w.policies, w.workers, w.scenario, now
    );
  }

  // seed stress scenarios
  // 1. 40-day monsoon scenario
  await db.prepare(`INSERT INTO stress_scenarios (id, scenario_name, scenario_type, duration_days, trigger_frequency, avg_payout_per_day, total_estimated_payout, total_premium_in_period, bcr_under_stress, loss_ratio_under_stress, is_sustainable, recommendation, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(
    'STRESS-001', '40-Day Monsoon (Mumbai)', 'monsoon', 40, 0.65,
    450, 18000, 2971, 6.06, 605.8, 0,
    'UNSUSTAINABLE — Reserve fund of ₹15,029 required. Recommend suspending new enrollments 2 weeks before monsoon onset. Cap daily payouts at ₹350.',
    now
  );

  // 2. Delhi May-June AQI hazard
  await db.prepare(`INSERT INTO stress_scenarios (id, scenario_name, scenario_type, duration_days, trigger_frequency, avg_payout_per_day, total_estimated_payout, total_premium_in_period, bcr_under_stress, loss_ratio_under_stress, is_sustainable, recommendation, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(
    'STRESS-002', 'Delhi May-June Heatwave + AQI', 'hazard', 60, 0.40,
    300, 18000, 4457, 4.04, 403.9, 0,
    'UNSUSTAINABLE — 60-day heat+AQI window. Reserve fund of ₹13,543 required. Implement dynamic trigger thresholds: AQI > 400 (not 300) during peak months.',
    now
  );

  // seed settlement records for existing claims
  await db.prepare(`INSERT INTO settlements (id, claim_id, worker_id, amount, channel, upi_id, status, completed_at, transaction_ref)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(
    'SET-001', 'CLM-DEMO-001', w1, 500, 'UPI', 'ravi@upi', 'completed', now, 'UPI-TXN-8721634'
  );
  await db.prepare(`INSERT INTO settlements (id, claim_id, worker_id, amount, channel, upi_id, status, completed_at, transaction_ref)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(
    'SET-002', 'CLM-DEMO-002', w2, 300, 'UPI', 'priya@upi', 'completed', now, 'UPI-TXN-9134872'
  );
}
