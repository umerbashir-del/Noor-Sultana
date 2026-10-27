// A single synthetic HTTP turn. Offline by default; --live uses Claude API credits.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const live = process.argv.includes('--live');
const compareCache = process.argv.includes('--compare-cache');
const verifyFlow = process.argv.includes('--verify-flow');
const reportArg = process.argv.find(arg => arg.startsWith('--report='))?.slice(9);
if (reportArg && !/^[a-z0-9][a-z0-9-]*\.json$/.test(reportArg)) throw new Error('--report must be a simple JSON filename.');
if (compareCache || verifyFlow) process.env.NOOR_PROMPT_CACHE = '1';
const baselinePath = fileURLToPath(new URL('../prototype/data/tracing-baseline/live/report.json', import.meta.url));
const outputArg = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
const dataDir = resolve(outputArg || fileURLToPath(new URL(`../prototype/data/tracing-baseline/${live ? 'live' : 'offline'}/`, import.meta.url)));
await mkdir(dataDir, { recursive: true });
Object.assign(process.env, {
 PORT: '0', NOOR_HOST: '127.0.0.1', NODE_ENV: 'development', PUBLIC_ORIGIN: '',
 NOOR_SKIP_VOICE_WARMUP: '1', NOOR_EMAIL_DB: ':memory:', NOOR_USAGE_DB: resolve(dataDir, 'usage.sqlite'),
 NOOR_DATA_DIR: dataDir, RESEND_API_KEY: '', NOOR_EMAIL_FROM: '', REPLICATE_API_TOKEN: '',
});
if (!live) Object.assign(process.env, { ANTHROPIC_API_KEY: 'offline-fixture', ANTHROPIC_MODEL: 'claude-test' });
const identityPath = resolve(dataDir, 'visitor.json');
let visitorCookie = '';
try {
 const saved = JSON.parse(await readFile(identityPath, 'utf8'));
 assert.match(saved.visitorCookie, /^noor_visitor=[a-f0-9]{64}$/);
 visitorCookie = saved.visitorCookie;
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const originalFetch = globalThis.fetch;
let modelCalls = 0, server, db, cookie, base;
const fixtureCache = new Set();
// Permit only loopback HTTP and, in live mode, the two existing Claude endpoints.
globalThis.fetch = async (url, options) => {
 const target = String(url);
 if (target === 'https://api.anthropic.com/v1/messages/count_tokens') {
  if (live) return originalFetch(url, options);
  return Response.json({ input_tokens: 100 });
 }
 if (target === 'https://api.anthropic.com/v1/messages') {
  modelCalls++;
  if (live) return originalFetch(url, options);
  const body = JSON.parse(options.body);
  const prefix = Array.isArray(body.system) && body.system[0]?.cache_control
   ? JSON.stringify([body.tools, body.system[0]]) : null;
  const hit = prefix && fixtureCache.has(prefix);
  if (prefix) fixtureCache.add(prefix);
  return Response.json({ content: modelCalls % 2 === 1
   ? [{ type: 'tool_use', id: 'synthetic-status', name: 'flight_status', input: { flightId: 'CL204' } }]
   : [{ type: 'text', text: '{"reply":"This fictional demo flight is on time.","expression":"thoughtful"}' }],
   usage: { input_tokens: prefix ? 10 : 100, output_tokens: 20, cache_creation_input_tokens: prefix && !hit ? 90 : 0, cache_read_input_tokens: hit ? 90 : 0 },
  });
 }
 if (base && new URL(target).origin === base) return originalFetch(url, options);
 throw new Error('Baseline runner blocked an unexpected network destination.');
};
try {
 ({ server } = await import('../prototype/server.mjs'));
 if (!server.listening) await once(server, 'listening');
 base = 'http://127.0.0.1:' + server.address().port;
 const reports = [];
 for (const phase of compareCache ? ['cache-miss', 'cache-hit'] : ['single']) {
  const callsBefore = modelCalls;
  const session = await fetch(base + '/api/session?journey=tokyo', { method: 'POST', headers: { cookie: visitorCookie } });
  assert.equal(session.status, 200);
  const pairs = session.headers.getSetCookie().map(value => value.split(';')[0]);
  cookie = pairs.join('; ');
  visitorCookie = pairs.find(value => value.startsWith('noor_visitor='));
  assert.match(visitorCookie, /^noor_visitor=[a-f0-9]{64}$/);
  await writeFile(identityPath, JSON.stringify({ visitorCookie }) + '\n', { mode: 0o600 });
  const started = performance.now();
  const response = await fetch(base + '/api/chat', {
   method: 'POST', headers: { cookie, 'content-type': 'application/json' },
   body: JSON.stringify({ message: 'What is the status of my flight?', expectedJourneyId: 'tokyo' }),
  });
  const answer = await response.json();
  const httpDurationMs = Math.round(performance.now() - started);
  db ??= new DatabaseSync(resolve(dataDir, 'agent-traces.sqlite'), { readOnly: true });
  const rows = db.prepare('SELECT event, metadata FROM agent_events WHERE trace_id = ? ORDER BY seq').all(answer.traceId || '')
   .map(row => ({ event: row.event, ...JSON.parse(row.metadata) }));
  const end = rows.findLast(row => row.event === 'run_end');
  const models = rows.filter(row => row.event === 'model_end');
  const passed = response.status === 200 && end?.status === 'success' && answer.evidenceStatus === 'grounded'
   && answer.toolsUsed?.includes('flight_status') && models.length > 0
   && models.every(row => Number.isSafeInteger(row.uncachedInputTokens) && Number.isSafeInteger(row.outputTokens));
  const hookOrder = rows.filter(row => row.event === 'call_hook').map(row => row.hookPhase);
  const expectedHookOrder = ['beforeModel','afterModel','beforeTool','afterTool','beforeModel','afterModel'];
  const flowChecks = {
   replyShape: typeof answer.reply === 'string' && answer.reply.length > 0 && ['welcoming','thoughtful'].includes(answer.expression),
   hookOrder: JSON.stringify(hookOrder) === JSON.stringify(expectedHookOrder),
   cacheRead: end?.cacheReadInputTokens > 0,
   cleanOutcome: !rows.some(row => row.event === 'hook_failure' || row.status === 'error'),
   usageComplete: ['uncachedInputTokens','outputTokens','cacheCreationInputTokens','cacheReadInputTokens']
    .every(field => Number.isSafeInteger(end?.[field]) && end[field] >= 0),
  };
  const report = {
   at: new Date().toISOString(), mode: live ? 'live-claude' : 'offline-fixture', passed: passed && (!verifyFlow || Object.values(flowChecks).every(Boolean)),
   ...(verifyFlow ? { flowChecks, hookOrder } : {}),
   scenario: 'tokyo-flight-status', httpStatus: response.status, httpDurationMs,
   traceId: answer.traceId, evidenceStatus: answer.evidenceStatus, toolsUsed: answer.toolsUsed,
   phase, modelCalls: modelCalls - callsBefore, end, events: rows,
   limits: live ? 'One synthetic turn; not a latency distribution or browser/voice acceptance.'
    : 'Scripted Claude responses and token counts; timing does not measure the real provider.',
  };

  reports.push(report);
  const ended = await fetch(base + '/api/session/end', { method: 'POST', headers: { cookie } });
  if (verifyFlow) {
   const rejected = await fetch(base + '/api/chat', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Thanks' }) });
   flowChecks.sessionEnded = ended.status === 200;
   flowChecks.endedSessionRejected = rejected.status === 401;
   flowChecks.noCallsAfterEnd = modelCalls - callsBefore === report.modelCalls;
   report.passed &&= Object.values(flowChecks).every(Boolean);
  }
  cookie = undefined;
  if (!report.passed) break; // Preserve a provider/limit failure; do not spend on another turn.
 }
 let result = reports[0];
 if (compareCache) {
  const firstModel = report => report?.events.find(row => row.event === 'model_end');
  const cold = firstModel(reports[0]), warm = firstModel(reports[1]);
  let baseline;
  if (live) baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  const summarize = report => report && ({
   traceId: report.traceId, httpDurationMs: report.httpDurationMs, modelCalls: report.modelCalls,
   uncachedInputTokens: report.end?.uncachedInputTokens, outputTokens: report.end?.outputTokens,
   cacheCreationInputTokens: report.end?.cacheCreationInputTokens, cacheReadInputTokens: report.end?.cacheReadInputTokens,
   // Five-minute write/read multipliers; a relative input-charge estimate, not billed dollars.
   inputChargeEquivalentTokens: report.end && report.end.uncachedInputTokens
    + 1.25 * report.end.cacheCreationInputTokens + 0.1 * report.end.cacheReadInputTokens,
  });
  result = {
   at: new Date().toISOString(), mode: live ? 'live-claude' : 'offline-fixture',
   passed: reports.length === 2 && reports.every(report => report.passed)
    && cold?.cacheCreationInputTokens > 0 && cold?.cacheReadInputTokens === 0 && warm?.cacheReadInputTokens > 0,
   baseline: summarize(baseline), cold: summarize(reports[0]), warm: summarize(reports[1]), reports,
   cachePolicy: 'Explicit stable system-prefix breakpoint, five-minute TTL; dynamic context and messages remain outside.',
   pricingSource: 'https://platform.claude.com/docs/en/build-with-claude/prompt-caching',
   limits: 'Two fresh-session synthetic turns; observed first-round miss then hit required. Single samples do not establish a latency improvement. Input-charge equivalents exclude output charges and are not a bill.',
  };
 }
 const reportPath = resolve(dataDir, reportArg || (compareCache ? 'cache-comparison.json' : 'report.json'));
 // Keep the original live report intact during comparisons; no prompts, replies or cookies.
 await writeFile(reportPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
 console.log(JSON.stringify({ ...result, events: undefined, reports: undefined, reportPath }));
 if (!result.passed) process.exitCode = 1;
} finally {
 if (cookie && base) await originalFetch(base + '/api/session/end', { method: 'POST', headers: { cookie } }).catch(() => {});
 globalThis.fetch = originalFetch;
 db?.close();
 if (server) await new Promise(resolve => server.close(resolve));
}
