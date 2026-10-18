import assert from 'node:assert/strict';
import test from 'node:test';
import { airportGuideIntent, airportGuideReply } from './airport-guide.mjs';
test('recognizes facilities while leaving connection, weather and allowance routes alone', () => {
 for (const q of ['Where is baggage claim?', 'Where are the toilets?', 'Airport map', 'Where is the wheelchair assistance desk?', 'How do I reach the train station?', 'Where is lost and found?']) assert.equal(airportGuideIntent(q), true, q);
 for (const q of ['Where do I go for my next flight?', 'Weather at Haneda', 'Does my ticket include a checked bag?', 'Email the airport guide', '2+2']) assert.equal(airportGuideIntent(q), false, q);
});
test('gives bounded fictional routes for each facility', () => {
 for (const [q, expected] of [['baggage claim', /Carousel B2/], ['toilets', /Junction A/], ['wheelchair', /no assistance request/], ['train', /No real fares/], ['lost property', /information desk/]]) {
  const result = airportGuideReply(q);
  assert.match(result.reply, expected);
  assert.match(result.reply, /not a real Haneda map/);
  assert.match(result.sourceLabel, /Invented/);
 }
});
test('does not invent routes for unsupported airports or facilities', () => {
 assert.match(airportGuideReply('Baggage claim at JFK').reply, /do not have directions/);
 assert.match(airportGuideReply('Airport guide').reply, /Which would you like/);
});
