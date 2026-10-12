import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, test } from 'node:test';
import { POST as start } from './session.mjs';
import { POST as chat } from './chat.mjs';
import { POST as end } from './session/end.mjs';

process.env.NOOR_SESSION_SECRET = randomBytes(32).toString('hex');
process.env.SUPABASE_URL = 'https://demo.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_test_only';
process.env.ANTHROPIC_API_KEY = 'test-only-key';
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });

function request(path, cookie, message) {
  return new Request(`https://noor.example${path}`, {
    method: 'POST',
    headers: { origin: 'https://noor.example', ...(cookie ? { cookie } : {}) },
    ...(message ? { body: JSON.stringify({ message }) } : {}),
  });
}

test('Vercel stores conversation server-side and deletes it on end', async () => {
  let stored;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers.apikey, url.startsWith(process.env.SUPABASE_URL) ? process.env.SUPABASE_SECRET_KEY : undefined);
    if (url.endsWith('/noor_demo_sessions') && options.method === 'POST') {
      stored = { ...JSON.parse(options.body), calls: 0, messages: [] };
      return new Response(null, { status: 201 });
    }
    if (url.endsWith('/rpc/noor_reserve_demo_call')) {
      assert.equal(JSON.parse(options.body).p_id, stored.id);
      stored.calls++;
      return Response.json({ status: 'ok', messages: stored.messages });
    }
    if (url.endsWith('/rpc/noor_complete_demo_call')) {
      const body = JSON.parse(options.body);
      stored.messages.push({ role: 'user', content: body.p_message }, { role: 'assistant', content: body.p_reply });
      return new Response(null, { status: 204 });
    }
    if (url.startsWith(`${process.env.SUPABASE_URL}/rest/v1/noor_demo_sessions?id=eq.`) && options.method === 'DELETE') {
      assert.ok(stored);
      stored = null;
      return new Response(null, { status: 204 });
    }
    if (url === 'https://api.anthropic.com/v1/messages') {
      const messages = JSON.parse(options.body).messages;
      if (stored.calls === 2) assert.equal(messages[0].content, 'Hello Noor');
      return Response.json({ content: [{ type: 'text', text: JSON.stringify({ reply: 'Welcome aboard.', expression: 'welcoming' }) }], usage: { input_tokens: 10, output_tokens: 5 } });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const first = await start(request('/api/session'));
  assert.equal(first.status, 200);
  const cookie = first.headers.get('set-cookie').split(';')[0];
  assert.ok(!cookie.includes('Hello Noor'));
  assert.equal((await chat(request('/api/chat', cookie, 'Hello Noor'))).status, 200);
  assert.equal(stored.messages.length, 2);
  assert.equal((await chat(request('/api/chat', cookie, 'What did I say?'))).status, 200);
  assert.equal(stored.calls, 2);
  assert.equal((await end(request('/api/session/end', cookie))).status, 200);
  assert.equal(stored, null);
});
