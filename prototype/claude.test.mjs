import assert from 'node:assert/strict';
import test from 'node:test';
import { answerWeather, askClaude, ClaudeUnavailable, weatherSystemContext } from './claude.mjs';

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
  assert.equal(answer.sourceLabel, 'Claude · Open-Meteo weather · Fictional flight');
});

test('uses the checked factual reply when Claude is absent or fails', async () => {
  const noKey = await answerWeather({ weather, message: 'Weather?', systemPrompt: 'Noor', ask: () => { throw new Error('Should not call Claude'); } });
  const failed = await answerWeather({ weather, message: 'Weather?', apiKey: 'test-key', systemPrompt: 'Noor',
    ask: async () => { throw new ClaudeUnavailable('Provider unavailable'); } });
  assert.equal(noKey.reply, failed.reply);
  assert.match(failed.reply, /24°C/);
  assert.equal(failed.sourceLabel, 'Open-Meteo weather · Fictional flight');
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
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ reply: 'Mainly clear and 24°C.', expression: 'thoughtful' }) }] }) };
    },
  });
  assert.equal(sent.max_tokens, 300);
  assert.equal(sent.messages.length, 1);
  assert.equal(answer.reply, 'Mainly clear and 24°C.');
  await assert.rejects(askClaude({
    apiKey: 'test-key', model: 'test-model', system: 'Noor', messages: [],
    fetchImpl: async () => ({ ok: true, json: async () => ({ content: [] }) }),
  }), ClaudeUnavailable);
});
