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

test('Vercel answers named-city weather from checked provider facts', async () => {
  const started = await start(request('/api/session'));
  const cookie = started.headers.get('set-cookie').split(';')[0];
  const hosts = [];
  globalThis.fetch = async (url, options) => {
    const address = new URL(url);
    hosts.push(address.hostname);
    if (address.hostname === 'geocoding-api.open-meteo.com') {
      assert.equal(address.searchParams.get('name'), 'Paris, France');
      return Response.json({ results: [{ name: 'Paris', country: 'France', latitude: 48.85,
        longitude: 2.35, timezone: 'Europe/Paris', population: 2_100_000 }] });
    }
    if (address.hostname === 'api.open-meteo.com') {
      return Response.json({ timezone: 'Europe/Paris', current: {
        time: Math.floor(Date.now() / 1000), temperature_2m: 19, weather_code: 3,
      } });
    }
    assert.equal(address.hostname, 'api.anthropic.com');
    assert.match(JSON.parse(options.body).system, /Paris, France/);
    return Response.json({ content: [{ type: 'text', text: JSON.stringify({
      reply: 'Paris is overcast and 19°C right now according to Open-Meteo.', expression: 'thoughtful',
    }) }], usage: { input_tokens: 10, output_tokens: 5 } });
  };
  const result = await chat(request('/api/chat', cookie, 'What is the current weather in Paris, France?'));
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.weather.city, 'Paris');
  assert.equal(body.weather.temperatureC, 19);
  assert.match(body.reply, /Paris/);
  assert.deepEqual(hosts, ['geocoding-api.open-meteo.com', 'api.open-meteo.com', 'api.anthropic.com']);
});

test('sample guidance shortcuts return fixed information without model calls', async () => {
  const started = await start(request('/api/session'));
  let cookie = started.headers.get('set-cookie').split(';')[0];
  globalThis.fetch = async () => { throw new Error('Shortcuts should not call a provider'); };
  const weather = await chat(request('/api/chat', cookie, 'What weather information can you check?'));
  assert.equal(weather.status, 200);
  assert.match((await weather.json()).reply, /named city/);
  cookie = weather.headers.get('set-cookie').split(';')[0];
  const note = await chat(request('/api/chat', cookie, 'Show me the fixed arrival note.'));
  assert.equal(note.status, 200);
  assert.match((await note.json()).reply, /check that you have your belongings/);
});
