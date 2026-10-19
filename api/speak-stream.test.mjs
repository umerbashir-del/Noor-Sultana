import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { sessionIdCookie } from '../lib/vercel-session.mjs';
import { POST } from './speak.mjs';
process.env.NOOR_SESSION_SECRET = randomBytes(32).toString('hex');
process.env.SUPABASE_URL = 'https://demo.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_test_only';
process.env.NOOR_VOICE_ENABLED = 'true'; process.env.REPLICATE_API_TOKEN = 'test-only-token';
const originalFetch = globalThis.fetch; after(() => { globalThis.fetch = originalFetch; });
const createPath = '/models/resemble-ai/chatterbox-turbo/predictions';
const wav = new Uint8Array(46); const view = new DataView(wav.buffer);
view.setUint32(0, 0x52494646); view.setUint32(4, 38, true); view.setUint32(8, 0x57415645);
view.setUint32(12, 0x666d7420); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 24000, true); view.setUint32(28, 48000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(36, 0x64617461); view.setUint32(40, 2, true);
function request(text, signal, extra = {}) { return new Request('https://noor.example/api/speak', { method: 'POST', headers: { origin: 'https://noor.example', cookie: sessionIdCookie(randomUUID()).split(';')[0], 'content-type': 'application/json' }, body: JSON.stringify({ text, stream: true, ...extra }), signal }); }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const bounded = promise => Promise.race([promise, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Timed out awaiting stream proof')), 2000); timer.unref(); })]);
const lines = async response => (await response.text()).trim().split('\n').map(line => JSON.parse(line));

test('first audio arrives before final provider result; reserves exact full text once and ignores submitted chunks', async () => {
  const text = 'A helpful first sentence. Here is the rest of this private reply.', gate = deferred(), secondStarted = deferred();
  const reservations = [], providerTexts = [];
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    if (path.endsWith('/rpc/noor_reserve_demo_voice_v2')) { reservations.push(JSON.parse(options.body)); return Response.json('ok'); }
    if (path.endsWith(createPath)) {
      providerTexts.push(JSON.parse(options.body).input.text);
      if (providerTexts.length === 2) { secondStarted.resolve(); await gate.promise; }
      return Response.json({ status: 'succeeded', output: 'https://replicate.delivery/stream.wav' });
    }
    if (path === 'https://replicate.delivery/stream.wav') return new Response(wav);
    throw new Error('Unexpected URL');
  };
  const response = await POST(request(text, undefined, { segments: ['Unauthorized client content'] }));
  assert.equal(response.headers.get('content-type'), 'application/x-ndjson');
  const reader = response.body.getReader();
  const first = JSON.parse(new TextDecoder().decode((await bounded(reader.read())).value));
  await bounded(secondStarted.promise);
  assert.equal(first.index, 0); assert.equal(Buffer.from(first.audio, 'base64').toString('ascii', 0, 4), 'RIFF');
  assert.equal(reservations.length, 1); assert.equal(reservations[0].p_text, text);
  assert.deepEqual(providerTexts, ['A helpful first sentence.', 'Here is the rest of this private reply.']);
  gate.resolve();
  let tail = ''; while (true) { const result = await reader.read(); if (result.done) break; tail += new TextDecoder().decode(result.value); }
  const remaining = tail.trim().split('\n').map(JSON.parse);
  assert.equal(remaining[0].index, 1); assert.deepEqual(remaining[1], { done: true });
});

for (const mode of ['request', 'reader']) test(`${mode} cancellation cancels active provider and prevents future chunks`, async () => {
  const aborter = new AbortController(), started = deferred(), released = deferred();
  let calls = 0, cancelled = 0; const background = [];
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    if (path.endsWith('/rpc/noor_reserve_demo_voice_v2')) return Response.json('ok');
    if (path.endsWith(createPath)) {
      calls++; started.resolve();
      options.signal.addEventListener('abort', () => released.resolve(), { once: true });
      await released.promise;
      return Response.json({ id: 'stream123', status: 'processing' });
    }
    if (path.endsWith('/stream123/cancel')) { cancelled++; return Response.json({ status: 'canceled' }); }
    throw new Error('Unexpected URL');
  };
  const response = await POST(request('An uncached sentence. A second sentence.', aborter.signal), { waitUntil: promise => background.push(promise) });
  await bounded(started.promise);
  if (mode === 'reader') await bounded(response.body.cancel());
  else { aborter.abort(); await bounded(Promise.all(background)); assert.equal(await response.text(), ''); }
  assert.equal(cancelled, 1); assert.equal(calls, 1);
});

test('initial create 429 refunds once but a partial success 429 never refunds', async () => {
  for (const partial of [false, true]) {
    let creates = 0, releases = 0;
    globalThis.fetch = async (url) => {
      const path = String(url);
      if (path.endsWith('/rpc/noor_reserve_demo_voice_v2')) return Response.json('ok');
      if (path.endsWith('/rpc/noor_release_demo_voice')) { releases++; return Response.json(true); }
      if (path.endsWith(createPath)) {
        creates++;
        return partial && creates === 1 ? Response.json({ status: 'succeeded', output: 'https://replicate.delivery/error.wav' }) : new Response('', { status: 429, headers: { 'retry-after': '30' } });
      }
      if (path === 'https://replicate.delivery/error.wav') return new Response(wav);
      throw new Error('Unexpected URL');
    };
    const output = await lines(await POST(request('A unique sentence for error. Another uncached sentence.')));
    assert.equal(releases, partial ? 0 : 1);
    assert.equal(output.filter(line => line.audio).length, partial ? 1 : 0);
    assert.match(output.at(-1).error, /30 seconds/); assert.equal(output.some(line => line.done), false);
  }
});

test('allowlisted warm cache still requires session reply authorization/quota and arbitrary text is not cached', async () => {
  let status = 'ok', creates = 0, reservations = 0;
  globalThis.fetch = async url => {
    const path = String(url);
    if (path.endsWith('/rpc/noor_reserve_demo_voice_v2')) { reservations++; return Response.json(status); }
    if (path.endsWith(createPath)) { creates++; return Response.json({ status: 'succeeded', output: 'https://replicate.delivery/cache.wav' }); }
    if (path === 'https://replicate.delivery/cache.wav') return new Response(wav);
    throw new Error('Unexpected URL');
  };
  await lines(await POST(request('Hello.'))); await lines(await POST(request('Hello.')));
  assert.equal(creates, 1); assert.equal(reservations, 2);
  status = 'limit'; assert.equal((await POST(request('Hello.'))).status, 429);
  status = 'invalid'; assert.equal((await POST(request('Hello.'))).status, 409);
  assert.equal(creates, 1); assert.equal(reservations, 4);
  status = 'ok';
  await lines(await POST(request('My private itinerary.'))); await lines(await POST(request('My private itinerary.')));
  assert.equal(creates, 3);
});

test('provider errors emit safe terminal error without internal detail', async () => {
  globalThis.fetch = async url => String(url).endsWith('/rpc/noor_reserve_demo_voice_v2') ? Response.json('ok') : (() => { throw new Error('private-token-provider-debug'); })();
  const output = await lines(await POST(request('An uncached provider failure.')));
  assert.deepEqual(output, [{ error: 'Chatterbox could not speak this reply. Please try again.' }]);
});

for (const partial of [false, true]) test(`50-second total deadline${partial ? ' after partial audio' : ''} cancels provider with two-second cleanup cap`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };
  let creates = 0, releases = 0, cancellationSignal, pendingSignal, finished = false;
  const background = [];
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    if (path.endsWith('/rpc/noor_reserve_demo_voice_v2')) {
      // Reservation latency is part of the 50-second budget, not added afterward.
      t.mock.timers.tick(7000);
      return Response.json('ok');
    }
    if (path.endsWith('/rpc/noor_release_demo_voice')) { releases++; return Response.json(true); }
    if (path.endsWith(createPath)) {
      creates++;
      if (partial && creates === 1) return Response.json({ status: 'succeeded', output: 'https://replicate.delivery/deadline.wav' });
      pendingSignal = options.signal;
      await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
      return Response.json({ id: 'deadline123', status: 'processing' });
    }
    if (path.endsWith('/deadline123/cancel')) {
      cancellationSignal = options.signal;
      return new Promise(() => {}); // Even an unresponsive cleanup cannot hold the stream open.
    }
    if (path === 'https://replicate.delivery/deadline.wav') return new Response(wav);
    throw new Error('Unexpected URL');
  };
  try {
    const response = await POST(request('A deadline fixture sentence. Another unique deadline sentence.'), { waitUntil: promise => background.push(promise.then(() => { finished = true; })) });
    await flush(); assert.ok(pendingSignal); assert.equal(pendingSignal.aborted, false);
    t.mock.timers.tick(42_999); await flush(); assert.equal(pendingSignal.aborted, false);
    t.mock.timers.tick(1); await flush();
    assert.equal(Date.now(), 50_000); assert.equal(pendingSignal.aborted, true); assert.ok(cancellationSignal);
    t.mock.timers.tick(1999); await flush(); assert.equal(finished, false);
    t.mock.timers.tick(1); await flush(); assert.equal(finished, true); assert.equal(cancellationSignal.aborted, true);
    const output = await lines(response);
    assert.equal(output.filter(line => line.audio).length, partial ? 1 : 0);
    assert.deepEqual(output.at(-1), { error: 'Voice generation took too long. Please try again.' });
    assert.equal(output.some(line => line.done), false);
    assert.equal(creates, partial ? 2 : 1); assert.equal(releases, 0);
    await Promise.all(background);
  } finally { t.mock.timers.reset(); }
});

test('hosted function explicitly allows 60 seconds for the bounded stream and cleanup', async () => {
  const { readFile } = await import('node:fs/promises');
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.functions['api/speak.mjs'].maxDuration, 60);
  assert.equal(config.functions['api/speak.mjs'].supportsCancellation, true);
});

test('deadline also bounds waiting for an initial429 refund without abandoning its durable attempt', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const refund = deferred(); const background = []; let releases = 0;
  const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };
  globalThis.fetch = async url => {
    const path = String(url);
    if (path.endsWith('/rpc/noor_reserve_demo_voice_v2')) return Response.json('ok');
    if (path.endsWith(createPath)) { t.mock.timers.tick(49_000); return new Response('', { status: 429, headers: { 'retry-after': '30' } }); }
    if (path.endsWith('/rpc/noor_release_demo_voice')) { releases++; return refund.promise; }
    throw new Error('Unexpected URL');
  };
  try {
    const response = await POST(request('A unique slow refund fixture.'), { waitUntil: promise => background.push(promise) });
    await flush(); assert.equal(releases, 1);
    t.mock.timers.tick(1000); await flush();
    assert.deepEqual(await lines(response), [{ error: 'Voice generation took too long. Please try again.' }]);
    refund.resolve(Response.json(true)); await Promise.all(background);
    assert.equal(releases, 1);
  } finally { refund.resolve(Response.json(true)); t.mock.timers.reset(); }
});
