import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { POST, GET, hostedTranscriptionLimits } from './transcribe.mjs';
import { createHostedTestBackend } from '../lib/test-hosted-backend.mjs';
import { createStoredSession } from '../lib/supabase-store.mjs';
import { sessionIdCookie } from '../lib/vercel-session.mjs';
process.env.NOOR_SESSION_SECRET = randomBytes(32).toString('hex');
process.env.SUPABASE_URL = 'https://demo.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_test_only';
process.env.REPLICATE_API_TOKEN = 'test-only';
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });
const url = 'https://noor.example/api/transcribe';
function request(cookie, { bytes = 2000, mime = 'audio/ogg;codecs=opus', origin = 'https://noor.example', signal } = {}) {
  return new Request(url, { method: 'POST', headers: { cookie, origin, 'content-type': mime }, body: Buffer.alloc(bytes), signal });
}
async function fixture(provider = async () => Response.json({ id: 'asr1', status: 'succeeded', output: { transcription: 'Where is my gate?' } })) {
  let calls = 0;
  const backend = createHostedTestBackend((...args) => { calls++; return provider(...args); });
  globalThis.fetch = backend.fetch;
  const id = await createStoredSession(randomUUID());
  return { backend, id, cookie: sessionIdCookie(id), calls: () => calls };
}
test('transcription rejects foreign origin, missing session, unsupported types and oversized uploads before spending', async () => {
  const f = await fixture();
  assert.equal((await POST(request(f.cookie, { origin: 'https://evil.example' }))).status, 403);
  assert.equal((await POST(request(''))).status, 401);
  assert.equal((await POST(request(f.cookie, { mime: 'text/plain' }))).status, 415);
  assert.equal((await POST(request(f.cookie, { bytes: 900001 }))).status, 413);
  assert.equal(f.calls(), 0); assert.equal(f.backend.ledger.length, 0);
});
test('successful pinned Whisper request returns editable text and conservatively charges the shared budget once', async () => {
  let body;
  const f = await fixture(async (_, options) => { body = JSON.parse(options.body); return Response.json({ id: 'asr1', status: 'succeeded', output: { transcription: ' Where is my gate? ' } }); });
  const response = await POST(request(f.cookie));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { text: 'Where is my gate?' });
  assert.equal(body.version.length, 64); assert.match(body.input.audio, /^data:audio\/ogg;base64,/);
  assert.equal(body.input.transcription, 'plain text');
  assert.equal(f.backend.ledger.length, 1); assert.equal(f.backend.ledger[0].reserved, 3000);
  assert.equal(f.backend.ledger[0].actual, null); assert.equal(f.backend.ledger[0].state, 'done');
});
test('expired sessions and shared global budget stop provider calls; storage fails closed', async () => {
  const f = await fixture(); f.backend.advance(900001);
  assert.equal((await POST(request(f.cookie))).status, 401); assert.equal(f.calls(), 0);
  const g = await fixture(); process.env.NOOR_DAILY_CLAUDE_GLOBAL_TOKENS = '2999';
  try { assert.equal((await POST(request(g.cookie))).status, 429); assert.equal(g.calls(), 0); }
  finally { delete process.env.NOOR_DAILY_CLAUDE_GLOBAL_TOKENS; }
  g.backend.failReserve = true;
  assert.equal((await POST(request(g.cookie))).status, 503); assert.equal(g.calls(), 0);
});
test('Stop during creation obtains prediction ID, cancels upstream, and retains uncertain spending', async () => {
  const controller = new AbortController(); const paths = [];
  const f = await fixture(async (address) => {
    paths.push(String(address));
    if (String(address).endsWith('/cancel')) return Response.json({ status: 'canceled' });
    controller.abort(); return Response.json({ id: 'asr1', status: 'starting' });
  });
  const response = await POST(request(f.cookie, { signal: controller.signal }));
  assert.equal(response.status, 504); assert.ok(paths.some(path => path.endsWith('/asr1/cancel')));
  assert.equal(f.backend.ledger[0].state, 'uncertain'); assert.equal(f.backend.ledger[0].actual, null);
});
test('provider failures are sanitized and capabilities report missing configuration', async () => {
  const f = await fixture(async () => { throw new Error('private-provider-token-and-transcript'); });
  const response = await POST(request(f.cookie)); assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private-provider/);
  delete process.env.REPLICATE_API_TOKEN;
  assert.equal((await GET().json()).available, false);
  process.env.REPLICATE_API_TOKEN = 'test-only';
});

test('Stop while storage reservation is pending never starts a paid provider call', async () => {
  const f = await fixture(); const controller = new AbortController(); const backendFetch = globalThis.fetch;
  globalThis.fetch = async (address, options) => {
    const response = await backendFetch(address, options);
    if (String(address).endsWith('/rpc/noor_reserve_demo_model_call')) controller.abort();
    return response;
  };
  const response = await POST(request(f.cookie, { signal: controller.signal }));
  assert.equal(response.status, 504); assert.equal(f.calls(), 0);
  assert.equal(f.backend.ledger[0].state, 'uncertain');
});

test('transcription follows the approved deployed presentation-day policy and restores normal configured limits', () => {
  const env = { VERCEL_ENV: 'production', NOOR_DAILY_CLAUDE_VISITOR_REQUESTS: '2', NOOR_DAILY_CLAUDE_GLOBAL_TOKENS: '20000' };
  const normal = { visitorRequests: 2, globalRequests: 500, visitorTokens: 30000, globalTokens: 20000 };
  assert.deepEqual(hostedTranscriptionLimits(env, Date.parse('2026-10-19T03:59:59Z')), normal);
  assert.deepEqual(hostedTranscriptionLimits(env, Date.parse('2026-10-19T04:00:00Z')), {
    visitorRequests: 2147483647, globalRequests: 2147483647, visitorTokens: 2147483647, globalTokens: 2147483647,
  });
  assert.deepEqual(hostedTranscriptionLimits(env, Date.parse('2026-10-20T04:00:00Z')), normal);
  assert.deepEqual(hostedTranscriptionLimits({ ...env, VERCEL_ENV: 'preview' }, Date.parse('2026-10-19T12:00:00Z')), normal);
});


test('provider creation 429 returns safe retry guidance without retrying or refunding quota', async () => {
  const f = await fixture(async () => new Response('private provider details', { status: 429, headers: { 'retry-after': '12' } }));
  const response = await POST(request(f.cookie));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '12');
  assert.match((await response.json()).error, /temporarily busy.*12 seconds/);
  assert.equal(f.calls(), 1);
  assert.equal(f.backend.ledger.length, 1);
  assert.equal(f.backend.ledger[0].state, 'uncertain');
  assert.equal(f.backend.ledger[0].reserved, 3000);
  assert.equal(f.backend.ledger[0].actual, null);
});

test('provider Retry-After is bounded and sanitized for missing, invalid, negative and excessive values', async () => {
  for (const [header, expected] of [[undefined, '30'], ['private provider detail', '30'], ['-5', '1'], ['999999', '300']]) {
    const f = await fixture(async () => new Response('secret', { status: 429, headers: header === undefined ? {} : { 'retry-after': header } }));
    const response = await POST(request(f.cookie));
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), expected);
    assert.doesNotMatch(await response.text(), /private provider detail|secret/);
    assert.equal(f.calls(), 1);
  }
  const f = await fixture(async () => new Response(null, { status: 429, headers: { 'retry-after': new Date(Date.now() + 60000).toUTCString() } }));
  const response = await POST(request(f.cookie));
  assert.ok(Number(response.headers.get('retry-after')) >= 59);
  assert.ok(Number(response.headers.get('retry-after')) <= 60);
});

test('provider 5xx remains a sanitized service failure, rather than a quota or busy claim', async () => {
  const f = await fixture(async () => new Response('private upstream diagnosis', { status: 503, headers: { 'retry-after': '20' } }));
  const response = await POST(request(f.cookie));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), null);
  assert.doesNotMatch(await response.text(), /private upstream|temporarily busy|usage limit/);
  assert.equal(f.calls(), 1);
  assert.equal(f.backend.ledger[0].state, 'uncertain');
});

test('caller Stop takes priority over a simultaneous provider rate limit', async () => {
  const controller = new AbortController();
  const f = await fixture(async () => { controller.abort(); return new Response(null, { status: 429, headers: { 'retry-after': '10' } }); });
  const response = await POST(request(f.cookie, { signal: controller.signal }));
  assert.equal(response.status, 504);
  assert.equal(response.headers.get('retry-after'), null);
  assert.match((await response.json()).error, /stopped or timed out/);
  assert.equal(f.calls(), 1);
  assert.equal(f.backend.ledger[0].state, 'uncertain');
});


test('provider polling 429 cancels the known prediction and keeps the reservation charged', async () => {
  const paths = [];
  const f = await fixture(async (address) => {
    paths.push(String(address));
    if (String(address).endsWith('/cancel')) return Response.json({ status: 'canceled' });
    if (paths.length === 1) return Response.json({ id: 'asr1', status: 'starting' });
    return new Response(null, { status: 429, headers: { 'retry-after': '5' } });
  });
  const response = await POST(request(f.cookie));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '5');
  assert.equal(f.calls(), 3);
  assert.ok(paths[2].endsWith('/asr1/cancel'));
  assert.equal(f.backend.ledger[0].state, 'uncertain');
});
