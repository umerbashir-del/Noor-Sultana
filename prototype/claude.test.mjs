import assert from 'node:assert/strict';
import test from 'node:test';
import { answerWeather, askClaude, ClaudeUnavailable, weatherSystemContext } from './claude.mjs';
import { requestToolModel } from './agent.mjs';

test('Claude failures log only upstream status and request kind, without credentials or provider bodies', async () => {
  const logs = [], original = console.log;
  console.log = value => logs.push(JSON.parse(value));
  try {
    for (const request of [askClaude, requestToolModel]) {
      await assert.rejects(request({ apiKey: 'secret-test-key', model: 'test', system: 'test', messages: [],
        fetchImpl: async () => new Response('private upstream details', { status: 401 }),
      }), { name: 'ClaudeUnavailable' });
    }
    assert.deepEqual(logs.map(({ event, status, kind }) => ({ event, status, kind })), [
      { event: 'claude_upstream_error', status: 401, kind: 'messages' },
      { event: 'claude_upstream_error', status: 401, kind: 'tools' },
    ]);
    assert.doesNotMatch(JSON.stringify(logs), /secret-test-key|private upstream/);
  } finally { console.log = original; }
});

const weather = {
  location: 'Tokyo Haneda area', timeZone: 'Asia/Tokyo', kind: 'arrival',
  validAt: '2026-10-13T06:00:00.000Z', fetchedAt: '2026-10-11T20:00:00.000Z',
  temperatureC: 24, condition: 'Mainly clear', precipitationProbability: 6,
  source: { name: 'Open-Meteo', url: 'https://open-meteo.com/' },
  unusedPrivateValue: 'never send this',
};

test('gives Claude only the checked weather fields and current question', async () => {
  let request;
  const answer = await answerWeather({
    weather, message: 'What is the weather on arrival?', apiKey: 'test-key', model: 'test-model',
    systemPrompt: 'You are Noor.',
    ask: async (input) => {
      request = input;
      return { reply: 'Near Tokyo Haneda, the forecast is mainly clear and 24°C, with a 6% chance of rain around the fictional arrival.', expression: 'thoughtful' };
    },
  });
  assert.deepEqual(request.messages, [{ role: 'user', content: 'What is the weather on arrival?' }]);
  assert.match(request.system, /Open-Meteo/);
  assert.match(request.system, /24/);
  assert.match(request.system, /fictional sample arrival/);
  assert.doesNotMatch(request.system, /never send this/);
  assert.equal(answer.sourceLabel, 'Claude · Open-Meteo forecast · Fictional arrival time');
});

test('uses the checked factual reply when Claude is absent or fails', async () => {
  const noKey = await answerWeather({ weather, message: 'Weather?', systemPrompt: 'Noor', ask: () => { throw new Error('Should not call Claude'); } });
  const failed = await answerWeather({ weather, message: 'Weather?', apiKey: 'test-key', systemPrompt: 'Noor',
    ask: async () => { throw new ClaudeUnavailable('Provider unavailable'); } });
  assert.equal(noKey.reply, failed.reply);
  assert.match(failed.reply, /24°C/);
  assert.equal(failed.sourceLabel, 'Open-Meteo forecast · Fictional arrival time');
  const wrongFacts = await answerWeather({ weather, message: 'Weather?', apiKey: 'test-key', systemPrompt: 'Noor',
    ask: async () => ({ reply: 'It will be rainy and 30°C.', expression: 'thoughtful' }) });
  assert.equal(wrongFacts.reply, noKey.reply);
});

test('sends a bounded Claude request and checks its reply', async () => {
  let sent;
  const answer = await askClaude({
    apiKey: 'test-key', model: 'test-model', system: weatherSystemContext(weather),
    messages: [{ role: 'user', content: 'Weather?' }],
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      sent = JSON.parse(options.body);
      return { ok: true, json: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ reply: 'Mainly clear and 24°C.', expression: 'thoughtful' }) }],
        usage: { input_tokens: 70, output_tokens: 15, cache_creation_input_tokens: 4, cache_read_input_tokens: 3 },
      }) };
    },
  });
  assert.equal(sent.max_tokens, 300);
  assert.equal(sent.messages.length, 1);
  assert.equal(answer.reply, 'Mainly clear and 24°C.');
  assert.equal(answer.usageTokens, 92);
  await assert.rejects(askClaude({
    apiKey: 'test-key', model: 'test-model', system: 'Noor', messages: [],
    fetchImpl: async () => ({ ok: true, json: async () => ({ content: [] }) }),
  }), ClaudeUnavailable);
});

test('shows only the answer from a fenced response and rejects malformed JSON', async () => {
  const args = { apiKey: 'test-key', model: 'test-model', system: 'Noor', messages: [] };
  const response = (text) => async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text }] }) });
  const good = await askClaude({ ...args, fetchImpl: response('```json\n{"reply":"Boarding begins at 8:00.","expression":"thoughtful"}\n```') });
  assert.equal(good.reply, 'Boarding begins at 8:00.');
  await assert.rejects(askClaude({ ...args, fetchImpl: response('{"reply": "Boarding begins at 8:00."') }), ClaudeUnavailable);
});
