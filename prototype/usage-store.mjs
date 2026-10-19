import { migrateDatabase } from './database-migrations.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dayMs = 24 * 60 * 60 * 1000;
const defaultLimits = {
  claude: { visitorRequests: 30, globalRequests: 500, visitorTokens: 30_000, globalTokens: 300_000 },
  speak: { visitorRequests: 30, globalRequests: 500 },
  transcribe: { visitorRequests: 30, globalRequests: 500 },
  verification: { visitorRequests: 5, globalRequests: 100 },
};

function positiveInt(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${name} must be a positive integer.`);
  return number;
}

export function usageLimitsFromEnv(env = process.env, { allowUnlimitedLocal = false } = {}) {
  const result = structuredClone(defaultLimits);
  // Only the loopback development server can opt out; production always has caps.
  if (allowUnlimitedLocal && env.NODE_ENV !== 'production' && env.NOOR_LOCAL_UNLIMITED_USAGE === '1') {
    for (const limits of Object.values(result)) {
      for (const key of Object.keys(limits)) limits[key] = Infinity;
    }
    return result;
  }
  for (const [kind, limits] of Object.entries(result)) {
    const prefix = `NOOR_DAILY_${kind.toUpperCase()}`;
    limits.visitorRequests = positiveInt(env[`${prefix}_VISITOR_REQUESTS`], limits.visitorRequests, `${prefix}_VISITOR_REQUESTS`);
    limits.globalRequests = positiveInt(env[`${prefix}_GLOBAL_REQUESTS`], limits.globalRequests, `${prefix}_GLOBAL_REQUESTS`);
    if (kind === 'claude') {
      limits.visitorTokens = positiveInt(env[`${prefix}_VISITOR_TOKENS`], limits.visitorTokens, `${prefix}_VISITOR_TOKENS`);
      limits.globalTokens = positiveInt(env[`${prefix}_GLOBAL_TOKENS`], limits.globalTokens, `${prefix}_GLOBAL_TOKENS`);
    }
  }
  return result;
}

export function estimateClaudeTokens({ system, messages }) {
  const bytes = Buffer.byteLength(JSON.stringify({ system, messages }), 'utf8');
  return Math.max(3_000, bytes + 300);
}

export class UsageLimitError extends Error {
  constructor(scope) {
    super(scope === 'global' ? 'Noor has reached today’s overall usage limit. Please try tomorrow.'
      : 'You have reached today’s usage limit. Please try tomorrow.');
    this.name = 'UsageLimitError';
    this.scope = scope;
  }
}

export function createUsageStore({ dbPath = ':memory:', clock = Date.now, limits = defaultLimits } = {}) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA secure_delete=ON; PRAGMA journal_mode=WAL;');
  try { migrateDatabase(db, 'usage', { dbPath }); } catch (error) { db.close(); throw error; }
  const insert = db.prepare(`INSERT INTO usage_events
    (id, day, visitor_hash, kind, state, reserved_tokens, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const globalTotals = db.prepare(`SELECT COUNT(*) AS requests,
    COALESCE(SUM(COALESCE(actual_tokens, reserved_tokens)), 0) AS tokens
    FROM usage_events WHERE day = ? AND kind = ?`);
  const visitorTotals = db.prepare(`SELECT COUNT(*) AS requests,
    COALESCE(SUM(COALESCE(actual_tokens, reserved_tokens)), 0) AS tokens
    FROM usage_events WHERE day = ? AND kind = ? AND visitor_hash = ?`);

  function visitorHash(visitorId) {
    if (!/^[a-f0-9]{64}$/.test(visitorId || '')) throw new Error('Invalid visitor identity.');
    return createHash('sha256').update(visitorId).digest('hex');
  }

  function record(visitorId, kind, reservedTokens = 0) {
    const policy = limits[kind];
    if (!policy) throw new Error('Unknown usage kind.');
    if (!Number.isSafeInteger(reservedTokens) || reservedTokens < 0) throw new Error('Invalid token reservation.');
    const now = clock();
    const day = new Date(now).toISOString().slice(0, 10);
    const hash = visitorHash(visitorId);
    db.exec('BEGIN IMMEDIATE');
    try {
      const global = globalTotals.get(day, kind);
      const visitor = visitorTotals.get(day, kind, hash);
      if (global.requests >= policy.globalRequests || (policy.globalTokens && global.tokens + reservedTokens > policy.globalTokens)) {
        throw new UsageLimitError('global');
      }
      if (visitor.requests >= policy.visitorRequests || (policy.visitorTokens && visitor.tokens + reservedTokens > policy.visitorTokens)) {
        throw new UsageLimitError('visitor');
      }
      const id = randomUUID();
      insert.run(id, day, hash, kind, reservedTokens ? 'reserved' : 'done', reservedTokens, now);
      db.exec('COMMIT');
      return id;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  return {
    reserveClaude(visitorId, estimate) { return record(visitorId, 'claude', estimate); },
    recordOperation(visitorId, kind) { return record(visitorId, kind); },
    settleClaude(id, actualTokens) {
      const tokens = Number.isSafeInteger(actualTokens) && actualTokens >= 0 ? actualTokens : null;
      db.prepare("UPDATE usage_events SET actual_tokens = ?, state = 'done' WHERE id = ? AND kind = 'claude'")
        .run(tokens, id);
    },
    markUncertain(id) {
      db.prepare("UPDATE usage_events SET state = 'uncertain' WHERE id = ? AND kind = 'claude'").run(id);
    },
    totals(visitorId, kind = 'claude') {
      const day = new Date(clock()).toISOString().slice(0, 10);
      return { global: globalTotals.get(day, kind), visitor: visitorTotals.get(day, kind, visitorHash(visitorId)) };
    },
    prune() {
      db.prepare('DELETE FROM usage_events WHERE created_at < ?').run(clock() - 30 * dayMs);
    },
    close() { db.close(); },
  };
}
