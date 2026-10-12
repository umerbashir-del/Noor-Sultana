import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { sessionIdCookie } from '../lib/vercel-session.mjs';
import { GET, POST } from './speak.mjs';

process.env.NOOR_SESSION_SECRET = randomBytes(32).toString('hex');
process.env.SUPABASE_URL = 'https://demo.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_test_only';
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });

function request(cookie, text, origin = 'https://noor.example') {
  return new Request('https://noor.example/api/speak', {
    method: 'POST',
    headers: { origin, cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

test('voice stays unavailable without a provider token', async () => {
  delete process.env.REPLICATE_API_TOKEN;
  assert.deepEqual(await (await GET()).json(), { available: false });
  assert.equal((await POST(request('', 'Welcome aboard.'))).status, 503);
});

test('voice checks session reply and usage before generating Chatterbox audio', async () => {
  process.env.REPLICATE_API_TOKEN = 'test-only-token';
  const id = randomUUID();
  const cookie = sessionIdCookie(id).split(';')[0];
  const text = 'Welcome aboard.';
  const wav = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
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
      assert.deepEqual(JSON.parse(options.body).input, { text, voice: 'Abigail' });
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
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), wav);
  assert.equal(calls.length, 3);
});

test('voice limit blocks the provider call', async () => {
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
