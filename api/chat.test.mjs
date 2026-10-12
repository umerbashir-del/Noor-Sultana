import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, test } from 'node:test';
import { POST as start } from './session.mjs';
import { POST as chat } from './chat.mjs';
import { POST as end } from './session/end.mjs';

process.env.NOOR_SESSION_SECRET = randomBytes(32).toString('hex');
process.env.ANTHROPIC_API_KEY = 'test-only-key';
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });

function request(path, cookie, message, origin = 'https://noor.example') {
  return new Request(`https://noor.example${path}`, {
    method: 'POST',
    headers: { origin, ...(cookie ? { cookie } : {}), ...(message ? { 'content-type': 'application/json' } : {}) },
    ...(message ? { body: JSON.stringify({ message }) } : {}),
  });
}

test('Vercel chat retains a short private conversation and clears it', async () => {
  const first = await start(request('/api/session'));
  assert.equal(first.status, 200);
  let cookie = first.headers.get('set-cookie').split(';')[0];
  const seen = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    const body = JSON.parse(options.body);
    seen.push(body.messages);
    return Response.json({ content: [{ type: 'text', text: JSON.stringify({ reply: 'Welcome aboard.', expression: 'welcoming' }) }], usage: { input_tokens: 10, output_tokens: 5 } });
  };
  const reply1 = await chat(request('/api/chat', cookie, 'Hello Noor'));
  assert.equal(reply1.status, 200);
  assert.equal((await reply1.json()).reply, 'Welcome aboard.');
  cookie = reply1.headers.get('set-cookie').split(';')[0];
  const reply2 = await chat(request('/api/chat', cookie, 'What did you say?'));
  assert.equal(reply2.status, 200);
  assert.deepEqual(seen[1], [
    { role: 'user', content: 'Hello Noor' },
    { role: 'assistant', content: 'Welcome aboard.' },
    { role: 'user', content: 'What did you say?' },
  ]);
  const ended = await end(request('/api/session/end', cookie));
  assert.equal(ended.status, 200);
  assert.match(ended.headers.get('set-cookie'), /Max-Age=0/);
});

test('Vercel chat rejects cross-origin and missing-session requests', async () => {
  assert.equal((await start(request('/api/session', null, null, 'https://elsewhere.example'))).status, 403);
  assert.equal((await chat(request('/api/chat', null, 'Hello'))).status, 401);
});
