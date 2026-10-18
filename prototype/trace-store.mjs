import { migrateDatabase } from './database-migrations.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const events = new Set(['run_start','model_start','model_end','tool_start','tool_end','tool_reuse','evidence_check','evidence_repair','argument_repair','action_claim_blocked','run_end']);
const statuses = new Set(['started','success','error']);
const errors = new Set(['missing_api_key','usage_limit','model_unavailable','invalid_response','unknown_tool','invalid_arguments','tool_failed','call_limit','agent_failed','missing_evidence']);
const numericFields = ['round','durationMs','tokens','inputTokens','reservedTokens','modelCalls','toolCalls','successfulTools','failedTools','reusedTools'];
// Deliberately no prompt, response, arguments, headers, error messages, or session identifier fields.
export function safeTraceFields(fields = {}, toolNames = []) {
 const safe = {};
 if (['ok','unsupported','unavailable','needs_confirmation'].includes(fields.resultStatus)) safe.resultStatus = fields.resultStatus;
 if (['grounded','limited','not_required'].includes(fields.evidenceStatus)) safe.evidenceStatus = fields.evidenceStatus;
 if (['counted','fallback'].includes(fields.reservationMethod)) safe.reservationMethod = fields.reservationMethod;
 if (typeof fields.confirmationRequired === 'boolean') safe.confirmationRequired = fields.confirmationRequired;
 if (statuses.has(fields.status)) safe.status = fields.status;
 if (errors.has(fields.errorKind)) safe.errorKind = fields.errorKind;
 if (fields.tool !== undefined) safe.tool = toolNames.includes(fields.tool) ? fields.tool : 'unknown';
 for (const key of numericFields) if (Number.isSafeInteger(fields[key]) && fields[key] >= 0) safe[key] = fields[key];
 if (typeof fields.model === 'string' && /^claude-[a-z0-9._:-]{1,80}$/i.test(fields.model)) safe.model = fields.model;
 if (/^[a-f0-9]{16}$/.test(fields.promptVersion || '')) safe.promptVersion = fields.promptVersion;
 return safe;
}
export function createTraceStore({ dbPath, toolNames = [], clock = Date.now, retentionMs = 7 * 86400000, maxEvents = 10000 } = {}) {
 if (!Number.isSafeInteger(retentionMs) || retentionMs < 1 || !Number.isSafeInteger(maxEvents) || maxEvents < 1) throw new Error('Invalid trace retention limits.');
 if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
 const db = new DatabaseSync(dbPath);
 db.exec('PRAGMA secure_delete=ON;');
 try { migrateDatabase(db, 'traces', { dbPath }); } catch (error) { db.close(); throw error; }
 const insert = db.prepare('INSERT INTO agent_events(trace_id, at_ms, event, metadata) VALUES (?, ?, ?, ?)');
 const expire = db.prepare('DELETE FROM agent_events WHERE at_ms < ?');
 const trim = db.prepare('DELETE FROM agent_events WHERE seq NOT IN (SELECT seq FROM agent_events ORDER BY seq DESC LIMIT ?)');
 const rows = db.prepare('SELECT seq, trace_id AS traceId, at_ms AS atMs, event, metadata FROM agent_events ORDER BY seq');
 let writes = 0;
 function prune() { expire.run(clock() - retentionMs); trim.run(maxEvents); }
 prune();
 return {
  start() {
   const id = randomUUID();
   return { id, event(event, fields = {}) {
    if (!events.has(event)) return;
    insert.run(id, clock(), event, JSON.stringify(safeTraceFields(fields, toolNames)));
    trim.run(maxEvents);
    if (++writes % 100 === 0) prune();
   } };
  },
  read() { prune(); return rows.all().map((r) => ({ ...r, metadata: JSON.parse(r.metadata) })); },
  prune,
  close() { db.close(); },
 };
}
