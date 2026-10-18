import assert from 'node:assert/strict';
import test from 'node:test';
import { flightTrackingIntent, flightTrackingReply } from './fr24.mjs';
test('routes tracking requests without intercepting weather or arithmetic', () => {
  for (const q of ['Where is my flight?', 'Track the flight', 'Flight altitude', 'Has NH110 landed?', 'FR24 demo']) assert.equal(flightTrackingIntent(q), true);
  for (const q of ['2+2', 'What is the weather for my flight?', 'When do we board?']) assert.equal(flightTrackingIntent(q), false);
});
test('missing key does not make a network request', async () => {
  const result = await flightTrackingReply({ apiKey: '', fetchImpl: () => { throw new Error('Unexpected call'); } });
  assert.match(result.reply, /not connected/);
});
test('authenticates and labels the actual returned sample, never the requested flight', async () => {
  const result = await flightTrackingReply({ apiKey: 'test-only', fetchImpl: async (url, options) => {
    assert.equal(new URL(url).hostname, 'fr24api.flightradar24.com');
    assert.equal(options.headers.Authorization, 'Bearer test-only');
    assert.equal(options.headers['Accept-Version'], 'v1');
    return Response.json({ data: [{ flight: 'SK7679', lat: 35.34722, lon: -7.90277, alt: 37000, gspeed: 440, timestamp: '2024-10-10T08:08:12Z' }] });
  } });
  assert.match(result.reply, /SK7679/);
  assert.match(result.reply, /37,000 ft/);
  assert.match(result.reply, /fixed simulated data/);
  assert.match(result.sourceLabel, /Not live/);
});
test('fails safely on upstream errors or malformed data without leaking credentials', async () => {
  for (const fetchImpl of [
    async () => { throw new Error('secret-test-key'); },
    async () => new Response('', { status: 401 }),
    async () => Response.json({ data: [] }),
    async () => Response.json({ data: [{ flight: '<script>', lat: 999 }] }),
  ]) {
    const result = await flightTrackingReply({ apiKey: 'secret-test-key', fetchImpl });
    assert.match(result.reply, /unavailable/);
    assert.ok(!JSON.stringify(result).includes('secret-test-key'));
  }
});
