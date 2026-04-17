import { neon } from "@neondatabase/serverless";

interface DbWrapper {
  run(query: string, ...params: any[]): Promise<{ changes: number }>;
  get(query: string, ...params: any[]): Promise<any>;
  all(query: string, ...params: any[]): Promise<any[]>;
  prepare(query: string): {
    run: (...params: any[]) => Promise<{ changes: number }>;
    get: (...params: any[]) => Promise<any>;
    all: (...params: any[]) => Promise<any[]>;
  };
  exec(query: string): Promise<void>;
}

let _dbWrapper: DbWrapper | null = null;
let _baseDbPromise: Promise<DbWrapper> | null = null;
let _initPromise: Promise<void> | null = null;
let _initialized = false;
let _dbProvider: "neon" | "sqlite" | "unknown" = "unknown";

function shouldSeedDemoData(): boolean {
  const explicit = String(process.env.SEED_DEMO_DATA || "")
    .trim()
    .toLowerCase();
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  return process.env.NODE_ENV !== "production";
}

function replaceSqliteDateFns(query: string): string {
  let text = query;
  text = text.replace(
    /datetime\(\s*'now'\s*,\s*'-(\d+)\s+days'\s*\)/gi,
    "TO_CHAR(NOW() - INTERVAL '$1 days', 'YYYY-MM-DD HH24:MI:SS')",
  );
  text = text.replace(
    /datetime\(\s*'now'\s*,\s*'-(\d+)\s+hours'\s*\)/gi,
    "TO_CHAR(NOW() - INTERVAL '$1 hours', 'YYYY-MM-DD HH24:MI:SS')",
  );
  text = text.replace(
    /date\(\s*'now'\s*,\s*'-(\d+)\s+days'\s*\)/gi,
    "TO_CHAR((NOW() - INTERVAL '$1 days')::date, 'YYYY-MM-DD')",
  );
  text = text.replace(
    /datetime\(\s*'now'\s*\)/gi,
    "TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')",
  );
  text = text.replace(
    /date\(\s*'now'\s*\)/gi,
    "TO_CHAR(NOW()::date, 'YYYY-MM-DD')",
  );
  return text;
}

function convertQuestionMarksToPgParams(query: string): string {
  let result = "";
  let paramIndex = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < query.length; i += 1) {
    const char = query[i] || "";
    const next = query[i + 1] || "";

    if (char === "'" && !inDouble) {
      if (inSingle && next === "'") {
        result += "''";
        i += 1;
        continue;
      }
      inSingle = !inSingle;
      result += char;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      result += char;
      continue;
    }

    if (char === "?" && !inSingle && !inDouble) {
      paramIndex += 1;
      result += `$${paramIndex}`;
      continue;
    }

    result += char;
  }

  return result;
}

function splitSqlStatements(sqlText: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < sqlText.length; i += 1) {
    const char = sqlText[i] || "";
    const next = sqlText[i + 1] || "";

    if (char === "'" && !inDouble) {
      if (inSingle && next === "'") {
        current += "''";
        i += 1;
        continue;
      }
      inSingle = !inSingle;
      current += char;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      current += char;
      continue;
    }

    if (char === ";" && !inSingle && !inDouble) {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
      continue;
    }

    current += char;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

function toNeonSql(query: string): string {
  return convertQuestionMarksToPgParams(replaceSqliteDateFns(query));
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function isTransientNetworkError(error: unknown): boolean {
  const queue: any[] = [error];
  const visited = new Set<any>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    const code = String(current.code ?? "");
    const message = String(current.message ?? "");
    const combined = `${code} ${message}`;

    if (
      /ETIMEDOUT|ECONNRESET|ENETUNREACH|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|fetch failed/i.test(
        combined,
      )
    ) {
      return true;
    }

    if (current.cause) queue.push(current.cause);
    if (Array.isArray(current.errors)) queue.push(...current.errors);
  }

  return false;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function createNeonDb(databaseUrl: string): Promise<DbWrapper> {
  const sql = neon(databaseUrl);
  const maxRetries = parsePositiveInt(process.env.NEON_QUERY_RETRIES, 2);
  const baseRetryDelayMs = parsePositiveInt(
    process.env.NEON_QUERY_RETRY_DELAY_MS,
    150,
  );

  const execute = async (query: string, params: any[]) => {
    const text = toNeonSql(query);
    let attempt = 0;

    while (true) {
      try {
        return await sql.query(text, params);
      } catch (error) {
        if (attempt >= maxRetries || !isTransientNetworkError(error)) {
          throw error;
        }
        const delayMs = baseRetryDelayMs * 2 ** attempt;
        attempt += 1;
        await wait(delayMs);
      }
    }
  };

  const toRows = (result: any): any[] => {
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.rows)) return result.rows;
    return [];
  };

  const toRowCount = (result: any): number => {
    if (result && Number.isFinite(result.rowCount)) {
      return Number(result.rowCount);
    }
    return toRows(result).length;
  };

  return {
    async run(query: string, ...params: any[]) {
      const result = await execute(query, params);
      return { changes: toRowCount(result) };
    },
    async get(query: string, ...params: any[]) {
      const result = await execute(query, params);
      return toRows(result)[0] ?? undefined;
    },
    async all(query: string, ...params: any[]) {
      const result = await execute(query, params);
      return toRows(result);
    },
    prepare(query: string) {
      return {
        run: async (...params: any[]) => {
          const result = await execute(query, params);
          return { changes: toRowCount(result) };
        },
        get: async (...params: any[]) => {
          const result = await execute(query, params);
          return toRows(result)[0] ?? undefined;
        },
        all: async (...params: any[]) => {
          const result = await execute(query, params);
          return toRows(result);
        },
      };
    },
    async exec(query: string) {
      const statements = splitSqlStatements(query);
      for (const statement of statements) {
        await execute(statement, []);
      }
    },
  };
}

async function createSqliteDb(): Promise<DbWrapper> {
  const [{ mkdirSync }, { join }, moduleApi] = await Promise.all([
    import("node:fs"),
    import("node:path"),
    import("node:module"),
  ]);

  const { createRequire } = moduleApi;
  const require = createRequire(import.meta.url);
  const betterSqlite3 = require("better-sqlite3") as {
    default?: new (path: string) => {
      pragma: (query: string) => void;
      exec: (query: string) => void;
      prepare: (query: string) => {
        run: (...params: any[]) => { changes?: number | bigint };
        get: (...params: any[]) => any;
        all: (...params: any[]) => any[];
      };
    };
  };
  const DatabaseCtor =
    betterSqlite3.default ||
    (betterSqlite3 as unknown as new (path: string) => any);

  const dataDir = join(process.cwd(), ".data");
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "shiftsafe.db");

  const sqlite = new DatabaseCtor(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  return {
    async run(query: string, ...params: any[]) {
      const result = sqlite.prepare(query).run(...params);
      return { changes: Number(result.changes ?? 0) };
    },
    async get(query: string, ...params: any[]) {
      const row = sqlite.prepare(query).get(...params);
      return row ?? undefined;
    },
    async all(query: string, ...params: any[]) {
      return sqlite.prepare(query).all(...params);
    },
    prepare(query: string) {
      const stmt = sqlite.prepare(query);
      return {
        run: async (...params: any[]) => {
          const result = stmt.run(...params);
          return { changes: Number(result.changes ?? 0) };
        },
        get: async (...params: any[]) => stmt.get(...params),
        all: async (...params: any[]) => stmt.all(...params),
      };
    },
    async exec(query: string) {
      sqlite.exec(query);
    },
  };
}

async function createBaseDb(): Promise<DbWrapper> {
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (databaseUrl) {
    _dbProvider = "neon";
    return createNeonDb(databaseUrl);
  }
  _dbProvider = "sqlite";
  return createSqliteDb();
}

export function getDbProvider(): "neon" | "sqlite" | "unknown" {
  return _dbProvider;
}

function canFallbackToSqlite(error: unknown): boolean {
  return _dbProvider === "neon" && isTransientNetworkError(error);
}

async function switchToSqliteFallback(): Promise<DbWrapper> {
  if (_dbProvider === "sqlite" && _baseDbPromise) {
    return _baseDbPromise;
  }

  _dbProvider = "sqlite";
  _baseDbPromise = createSqliteDb();
  _initialized = false;
  _initPromise = null;
  return _baseDbPromise;
}

async function withDbFallback<T>(
  operation: (db: DbWrapper) => Promise<T>,
): Promise<T> {
  const baseDb = await getBaseDbPromise();

  try {
    await initializeIfNeeded(baseDb);
    return await operation(baseDb);
  } catch (error) {
    if (!canFallbackToSqlite(error)) {
      throw error;
    }

    console.warn(
      "[db] Neon unavailable, falling back to SQLite for this runtime:",
      error,
    );

    const sqliteDb = await switchToSqliteFallback();
    await initializeIfNeeded(sqliteDb);
    return operation(sqliteDb);
  }
}

function getBaseDbPromise(): Promise<DbWrapper> {
  if (!_baseDbPromise) {
    _baseDbPromise = createBaseDb();
  }
  return _baseDbPromise;
}

async function initializeIfNeeded(baseDb: DbWrapper): Promise<void> {
  if (_initialized) return;
  if (!_initPromise) {
    _initPromise = (async () => {
      await initSchema(baseDb);
      if (shouldSeedDemoData()) {
        await seedDemoData(baseDb);
      }
      _initialized = true;
    })().catch((error) => {
      _initPromise = null;
      throw error;
    });
  }
  await _initPromise;
}

export function getDb(): DbWrapper {
  if (!_dbWrapper) {
    _dbWrapper = {
      async run(query: string, ...params: any[]) {
        return withDbFallback((db) => db.run(query, ...params));
      },
      async get(query: string, ...params: any[]) {
        return withDbFallback((db) => db.get(query, ...params));
      },
      async all(query: string, ...params: any[]) {
        return withDbFallback((db) => db.all(query, ...params));
      },
      prepare(query: string) {
        return {
          run: async (...params: any[]) => _dbWrapper!.run(query, ...params),
          get: async (...params: any[]) => _dbWrapper!.get(query, ...params),
          all: async (...params: any[]) => _dbWrapper!.all(query, ...params),
        };
      },
      async exec(query: string) {
        return withDbFallback((db) => db.exec(query));
      },
    };
  }
  return _dbWrapper;
}

export async function initDb() {
  const db = getDb();
  await db.prepare("SELECT 1 as ok").get();
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
      payout_method TEXT DEFAULT 'upi',
      upi_id TEXT,
      bank_account TEXT,
      ifsc_code TEXT,
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
      status TEXT DEFAULT 'review',
      zone TEXT,
      payout_method TEXT DEFAULT 'UPI',
      payout_channel TEXT DEFAULT 'UPI',
      settlement_status TEXT DEFAULT 'pending',
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

    CREATE TABLE IF NOT EXISTS trigger_monitor_runs (
      id TEXT PRIMARY KEY,
      status TEXT DEFAULT 'running',
      started_at TEXT DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      scanned_zones INTEGER DEFAULT 0,
      detected_events INTEGER DEFAULT 0,
      payouts_initiated INTEGER DEFAULT 0,
      metadata TEXT
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

    CREATE TABLE IF NOT EXISTS service_requests (
      id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL,
      category TEXT NOT NULL,
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      priority TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'open',
      related_claim_id TEXT,
      related_policy_id TEXT,
      ai_metadata TEXT,
      ai_model_version TEXT,
      admin_notes TEXT,
      resolved_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (worker_id) REFERENCES workers(id)
    );

    CREATE TABLE IF NOT EXISTS risk_bonuses (
      id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL,
      bonus_type TEXT NOT NULL,
      amount REAL NOT NULL,
      reason TEXT NOT NULL,
      risk_zone TEXT,
      risk_trigger TEXT,
      status TEXT DEFAULT 'pending',
      approved_by TEXT DEFAULT 'admin',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      paid_at TEXT,
      FOREIGN KEY (worker_id) REFERENCES workers(id)
    );
    CREATE TABLE IF NOT EXISTS premium_payments (
      id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL,
      policy_id TEXT,
      razorpay_order_id TEXT,
      razorpay_payment_id TEXT,
      amount REAL NOT NULL,
      status TEXT DEFAULT 'created',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      paid_at TEXT,
      FOREIGN KEY (worker_id) REFERENCES workers(id)
    );
  `);

  await ensureWorkerPayoutColumns(db);
  await ensureServiceRequestAiColumns(db);
}

async function ensureWorkerPayoutColumns(db: any) {
  const migrationStatements = [
    "ALTER TABLE workers ADD COLUMN payout_method TEXT DEFAULT 'upi'",
    "ALTER TABLE workers ADD COLUMN upi_id TEXT",
    "ALTER TABLE workers ADD COLUMN bank_account TEXT",
    "ALTER TABLE workers ADD COLUMN ifsc_code TEXT",
  ];

  for (const statement of migrationStatements) {
    try {
      await db.exec(statement);
    } catch {
      // Column already exists or dialect-specific duplicate-column error.
    }
  }
}

async function ensureServiceRequestAiColumns(db: any) {
  const migrationStatements = [
    "ALTER TABLE service_requests ADD COLUMN ai_metadata TEXT",
    "ALTER TABLE service_requests ADD COLUMN ai_model_version TEXT",
  ];

  for (const statement of migrationStatements) {
    try {
      await db.exec(statement);
    } catch {
      // Column already exists or dialect-specific duplicate-column error.
    }
  }
}

/**
 * Seed 4 hypothetical workers with weekly data
 * limits data seeding to 3-4 entries for robust manual testing
 */
async function seedDemoData(db: any) {
  const existingCount =
    (await db.prepare("SELECT COUNT(*) as cnt FROM workers").get())?.cnt || 0;
  if (existingCount >= 4) return; // already seeded

  const now = new Date().toISOString();
  const weekAgo = new Date(Date.now() - 7 * 86400000)
    .toISOString()
    .split("T")[0];
  const today = new Date().toISOString().split("T")[0];

  // worker 1: ravi kumar — delhi, high activity, aqi risk
  const w1 = "WRK-DEMO-001";
  const p1 = "POL-DEMO-001";
  await db
    .prepare(
      `INSERT INTO workers (id, name, phone, email, platform, city, zone, shift_type, avg_weekly_income, vehicle_type, risk_score, status, is_active, active_delivery_days, days_worked_this_week, activity_tier, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    )
    .run(
      w1,
      "Ravi Kumar",
      "9876543210",
      "ravi@example.com",
      "Zomato",
      "Delhi",
      "Connaught Place",
      "full_day",
      5600,
      "bike",
      0.65,
      "active",
      1,
      21,
      6,
      "standard",
      now,
    );
  await db
    .prepare(
      `INSERT INTO policies (id, worker_id, plan_name, premium_tier, weekly_premium, max_coverage_per_week, max_payout_percent, status, start_date, city_pool, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    )
    .run(
      p1,
      w1,
      "ShiftGuard Weekly",
      "standard",
      35,
      2000,
      50.0,
      "active",
      weekAgo,
      "delhi_aqi",
      now,
    );
  await db
    .prepare(
      `INSERT INTO weekly_activity_log (id, worker_id, week_start, days_active, total_deliveries, total_earnings, is_eligible, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    )
    .run("WAL-001", w1, weekAgo, 6, 42, 5600, 1, now);
  // Ravi's claim — AQI trigger
  await db
    .prepare(
      `INSERT INTO claims (id, policy_id, worker_id, trigger_type, trigger_description, amount, status, zone, payout_method, payout_channel, settlement_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    )
    .run(
      "CLM-DEMO-001",
      p1,
      w1,
      "pollution",
      "AQI 380 — severe pollution in Delhi NCR",
      500,
      "auto_approved",
      "Connaught Place",
      "UPI",
      "UPI",
      "completed",
      now,
    );

  // worker 2: priya sharma — mumbai, rain risk
  const w2 = "WRK-DEMO-002";
  const p2 = "POL-DEMO-002";
  await db
    .prepare(
      `INSERT INTO workers (id, name, phone, email, platform, city, zone, shift_type, avg_weekly_income, vehicle_type, risk_score, status, is_active, active_delivery_days, days_worked_this_week, activity_tier, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    )
    .run(
      w2,
      "Priya Sharma",
      "9876543211",
      "priya@example.com",
      "Swiggy",
      "Mumbai",
      "Andheri East",
      "full_day",
      4200,
      "bike",
      0.55,
      "active",
      1,
      28,
      7,
      "premium",
      now,
    );
  await db
    .prepare(
      `INSERT INTO policies (id, worker_id, plan_name, premium_tier, weekly_premium, max_coverage_per_week, max_payout_percent, status, start_date, city_pool, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    )
    .run(
      p2,
      w2,
      "ShiftGuard Weekly",
      "premium",
      40,
      2500,
      50.0,
      "active",
      weekAgo,
      "mumbai_rain",
      now,
    );
  await db
    .prepare(
      `INSERT INTO weekly_activity_log (id, worker_id, week_start, days_active, total_deliveries, total_earnings, is_eligible, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    )
    .run("WAL-002", w2, weekAgo, 7, 56, 4200, 1, now);
  // Priya's claim — heavy rain
  await db
    .prepare(
      `INSERT INTO claims (id, policy_id, worker_id, trigger_type, trigger_description, amount, status, zone, payout_method, payout_channel, settlement_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    )
    .run(
      "CLM-DEMO-002",
      p2,
      w2,
      "heavy_rain",
      "Heavy rainfall 55mm/hr — Andheri East flooded",
      300,
      "auto_approved",
      "Andheri East",
      "UPI",
      "UPI",
      "completed",
      now,
    );

  // worker 3: arjun patel — delhi, lower activity (not eligible yet)
  const w3 = "WRK-DEMO-003";
  const p3 = "POL-DEMO-003";
  await db
    .prepare(
      `INSERT INTO workers (id, name, phone, email, platform, city, zone, shift_type, avg_weekly_income, vehicle_type, risk_score, status, is_active, active_delivery_days, days_worked_this_week, activity_tier, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    )
    .run(
      w3,
      "Arjun Patel",
      "9876543212",
      "arjun@example.com",
      "Blinkit",
      "Delhi",
      "Lajpat Nagar",
      "morning",
      3200,
      "bike",
      0.4,
      "active",
      1,
      4,
      3,
      "basic",
      now,
    );
  await db
    .prepare(
      `INSERT INTO policies (id, worker_id, plan_name, premium_tier, weekly_premium, max_coverage_per_week, max_payout_percent, status, start_date, city_pool, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    )
    .run(
      p3,
      w3,
      "ShiftGuard Basic",
      "basic",
      20,
      1500,
      50.0,
      "pending",
      weekAgo,
      "delhi_aqi",
      now,
    );
  await db
    .prepare(
      `INSERT INTO weekly_activity_log (id, worker_id, week_start, days_active, total_deliveries, total_earnings, is_eligible, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    )
    .run("WAL-003", w3, weekAgo, 3, 18, 3200, 0, now);

  // worker 4: meera joshi — gurugram, opted out of insurance
  const w4 = "WRK-DEMO-004";
  await db
    .prepare(
      `INSERT INTO workers (id, name, phone, email, platform, city, zone, shift_type, avg_weekly_income, vehicle_type, risk_score, status, is_active, insurance_opted_out, active_delivery_days, days_worked_this_week, activity_tier, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    )
    .run(
      w4,
      "Meera Joshi",
      "9876543213",
      "meera@example.com",
      "Zepto",
      "Gurugram",
      "Cyber City",
      "evening",
      3800,
      "scooter",
      0.35,
      "active",
      1,
      1,
      15,
      5,
      "standard",
      now,
    );

  // seed actuarial metrics (weekly data)
  const weeks = [
    {
      start: "2026-03-03",
      end: "2026-03-09",
      premiums: 520,
      claims: 300,
      policies: 4,
      workers: 4,
      scenario: "normal",
    },
    {
      start: "2026-03-10",
      end: "2026-03-16",
      premiums: 520,
      claims: 200,
      policies: 4,
      workers: 4,
      scenario: "normal",
    },
    {
      start: "2026-03-17",
      end: "2026-03-23",
      premiums: 520,
      claims: 500,
      policies: 4,
      workers: 4,
      scenario: "normal",
    },
    {
      start: "2026-03-24",
      end: "2026-03-30",
      premiums: 520,
      claims: 350,
      policies: 4,
      workers: 4,
      scenario: "normal",
    },
  ];
  for (const w of weeks) {
    const bcr = w.claims / w.premiums;
    const lossRatio = (w.claims / w.premiums) * 100;
    await db
      .prepare(
        `INSERT INTO actuarial_metrics (id, period_start, period_end, total_premium_collected, total_claims_paid, bcr, loss_ratio, active_policies, total_workers, scenario_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      )
      .run(
        `ACT-${w.start}`,
        w.start,
        w.end,
        w.premiums,
        w.claims,
        parseFloat(bcr.toFixed(2)),
        parseFloat(lossRatio.toFixed(1)),
        w.policies,
        w.workers,
        w.scenario,
        now,
      );
  }

  // seed stress scenarios
  // 1. 40-day monsoon scenario
  await db
    .prepare(
      `INSERT INTO stress_scenarios (id, scenario_name, scenario_type, duration_days, trigger_frequency, avg_payout_per_day, total_estimated_payout, total_premium_in_period, bcr_under_stress, loss_ratio_under_stress, is_sustainable, recommendation, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    )
    .run(
      "STRESS-001",
      "40-Day Monsoon (Mumbai)",
      "monsoon",
      40,
      0.65,
      450,
      18000,
      2971,
      6.06,
      605.8,
      0,
      "UNSUSTAINABLE — Reserve fund of ₹15,029 required. Recommend suspending new enrollments 2 weeks before monsoon onset. Cap daily payouts at ₹350.",
      now,
    );

  // 2. Delhi May-June AQI hazard
  await db
    .prepare(
      `INSERT INTO stress_scenarios (id, scenario_name, scenario_type, duration_days, trigger_frequency, avg_payout_per_day, total_estimated_payout, total_premium_in_period, bcr_under_stress, loss_ratio_under_stress, is_sustainable, recommendation, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    )
    .run(
      "STRESS-002",
      "Delhi May-June Heatwave + AQI",
      "hazard",
      60,
      0.4,
      300,
      18000,
      4457,
      4.04,
      403.9,
      0,
      "UNSUSTAINABLE — 60-day heat+AQI window. Reserve fund of ₹13,543 required. Implement dynamic trigger thresholds: AQI > 400 (not 300) during peak months.",
      now,
    );

  // seed settlement records for existing claims
  await db
    .prepare(
      `INSERT INTO settlements (id, claim_id, worker_id, amount, channel, upi_id, status, completed_at, transaction_ref)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    )
    .run(
      "SET-001",
      "CLM-DEMO-001",
      w1,
      500,
      "UPI",
      "ravi@upi",
      "completed",
      now,
      "UPI-TXN-8721634",
    );
  await db
    .prepare(
      `INSERT INTO settlements (id, claim_id, worker_id, amount, channel, upi_id, status, completed_at, transaction_ref)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    )
    .run(
      "SET-002",
      "CLM-DEMO-002",
      w2,
      300,
      "UPI",
      "priya@upi",
      "completed",
      now,
      "UPI-TXN-9134872",
    );
}
