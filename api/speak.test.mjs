import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { sessionIdCookie } from '../lib/vercel-session.mjs';
import { browserCompatibleWav, GET, POST } from './speak.mjs';

process.env.NOOR_SESSION_SECRET = randomBytes(32).toString('hex');
process.env.SUPABASE_URL = 'https://demo.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_test_only';
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });

function request(cookie, text, origin = 'https://noor.example', signal) {
  return new Request('https://noor.example/api/speak', {
    method: 'POST',
    headers: { origin, cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
  });
}

function floatWav(samples) {
  const buffer = new ArrayBuffer(44 + samples.length * 4);
  const wav = new DataView(buffer);
  wav.setUint32(0, 0x52494646, false);
  wav.setUint32(4, buffer.byteLength - 8, true);
  wav.setUint32(8, 0x57415645, false);
  wav.setUint32(12, 0x666d7420, false);
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 3, true);
  wav.setUint16(22, 1, true);
  wav.setUint32(24, 24000, true);
  wav.setUint32(28, 96000, true);
  wav.setUint16(32, 4, true);
  wav.setUint16(34, 32, true);
  wav.setUint32(36, 0x64617461, false);
  wav.setUint32(40, samples.length * 4, true);
  samples.forEach((sample, index) => wav.setFloat32(44 + index * 4, sample, true));
  return buffer;
}

test('converts provider float WAV samples to browser compatible PCM', () => {
  const pcm = new DataView(browserCompatibleWav(floatWav([-1, -0.5, 0, 0.5, 1])));
  assert.equal(pcm.getUint16(20, true), 1);
  assert.equal(pcm.getUint16(34, true), 16);
  assert.equal(pcm.getUint32(24, true), 24000);
  assert.equal(pcm.getUint32(40, true), 10);
  assert.deepEqual(Array.from({ length: 5 }, (_, index) => pcm.getInt16(44 + index * 2, true)),
    [-32768, -16384, 0, 16384, 32767]);
});

test('voice stays unavailable without a provider token', async () => {
  process.env.NOOR_VOICE_ENABLED = 'true';
  delete process.env.REPLICATE_API_TOKEN;
  assert.deepEqual(await (await GET()).json(), { available: false });
  assert.equal((await POST(request('', 'Welcome aboard.'))).status, 503);
});

test('voice stays unavailable until explicitly enabled', async () => {
  delete process.env.NOOR_VOICE_ENABLED;
  process.env.REPLICATE_API_TOKEN = 'test-only-token';
  assert.deepEqual(await (await GET()).json(), { available: false });
  assert.equal((await POST(request('', 'Welcome aboard.'))).status, 503);
});

test('voice checks session reply and usage before generating Chatterbox audio', async () => {
  process.env.NOOR_VOICE_ENABLED = 'true';
  process.env.REPLICATE_API_TOKEN = 'test-only-token';
  const id = randomUUID();
  const cookie = sessionIdCookie(id).split(';')[0];
  const text = 'Welcome aboard.';
  const wav = new Uint8Array(floatWav([0, 0.5, -0.5]));
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    if (String(url).endsWith('/rpc/noor_reserve_demo_voice')) {
      assert.equal(JSON.parse(options.body).p_id, id);
      assert.equal(JSON.parse(options.body).p_text, text);
      return Response.json('ok');
    }
    if (String(url).endsWith('/models/resemble-ai/chatterbox-turbo/predictions')) {
      assert.equal(options.headers.authorization, 'Bearer test-only-token');
      const input = JSON.parse(options.body).input;
      assert.equal(input.text, text);
      assert.equal('voice' in input, false);
      assert.match(input.reference_audio, /^data:audio\/wav;base64,/);
      const reference = Buffer.from(input.reference_audio.split(',')[1], 'base64');
      assert.equal(reference.toString('ascii', 0, 4), 'RIFF');
      assert.ok(reference.length > 500_000);
      return Response.json({ status: 'succeeded', output: 'https://replicate.delivery/voice.wav' });
    }
    if (String(url) === 'https://replicate.delivery/voice.wav') return new Response(wav);
    throw new Error(`Unexpected URL: ${url}`);
  };
  assert.deepEqual(await (await GET()).json(), { available: true });
  assert.equal((await POST(request(cookie, text, 'https://evil.example'))).status, 403);
  assert.equal(calls.length, 0);
  const response = await POST(request(cookie, text));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/wav');
  const returned = new DataView(await response.arrayBuffer());
  assert.equal(returned.getUint16(20, true), 1);
  assert.equal(returned.getUint16(34, true), 16);
  assert.equal(returned.getInt16(46, true), 16384);
  assert.equal(calls.length, 3);
});

test('voice limit blocks the provider call', async () => {
  process.env.NOOR_VOICE_ENABLED = 'true';
  process.env.REPLICATE_API_TOKEN = 'test-only-token';
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    assert.ok(String(url).endsWith('/rpc/noor_reserve_demo_voice'));
    return Response.json('limit');
  };
  const response = await POST(request(sessionIdCookie(randomUUID()).split(';')[0], 'Hello.'));
  assert.equal(response.status, 429);
  assert.equal(calls, 1);
});

test('interrupting speech cancels the active provider prediction', async () => {
  process.env.NOOR_VOICE_ENABLED = 'true';
  process.env.REPLICATE_API_TOKEN = 'test-only-token';
  const controller = new AbortController();
  const cookie = sessionIdCookie(randomUUID()).split(';')[0];
  let releaseCreate;
  let createStarted;
  const createStartedPromise = new Promise((resolve) => { createStarted = resolve; });
  const calls = [];
  const background = [];
  globalThis.fetch = async (url) => {
    const destination = String(url);
    calls.push(destination);
    if (destination.endsWith('/rpc/noor_reserve_demo_voice')) return Response.json('ok');
    if (destination.endsWith('/models/resemble-ai/chatterbox-turbo/predictions')) {
      createStarted();
      return new Promise((resolve) => { releaseCreate = resolve; });
    }
    if (destination.endsWith('/predictions/abc123/cancel')) return Response.json({ status: 'canceled' });
    throw new Error(`Unexpected destination: ${destination}`);
  };
  const pending = POST(request(cookie, 'Welcome aboard.', 'https://noor.example', controller.signal), {
    waitUntil: (promise) => background.push(promise),
  });
  await createStartedPromise;
  releaseCreate(Response.json({ id: 'abc123', status: 'processing' }));
  await new Promise(setImmediate);
  controller.abort();
  const response = await pending;
  assert.equal(response.status, 204);
  assert.equal(calls.filter((url) => url.endsWith('/predictions/abc123/cancel')).length, 1);
  assert.equal(background.length, 1);
});
