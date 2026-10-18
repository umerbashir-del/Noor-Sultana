import assert from 'node:assert/strict';
import test from 'node:test';
import { flightStatusIntent, flightStatusReply } from './flight-status.mjs';
test('status routing leaves weather, email, and explicit FR24 tracking alone', () => {
  for (const q of ['Are we delayed?', 'Has my flight landed?', 'When do we arrive?', 'When do we board?', 'Is CL204 on time?']) assert.equal(flightStatusIntent(q), true, q);
  for (const q of ['Weather at arrival', 'Arrival email', 'FR24 flight status', '2+2']) assert.equal(flightStatusIntent(q), false, q);
});
test('scenarios provide consistent times and keep all answers labeled simulated', () => {
  for (const scenario of ['on-time', 'delayed', 'landed']) {
    const answer = flightStatusReply('Flight status', scenario);
    assert.equal(answer.scenario, scenario);
    assert.match(answer.sourceLabel, /Simulated.*Not live/);
    assert.match(answer.reply, /simulated/i);
  }
  assert.match(flightStatusReply('', 'delayed').reply, /12:15 PM.*3:25 PM/);
  assert.match(flightStatusReply('', 'landed').reply, /2:35 PM/);
  assert.match(flightStatusReply('', 'invalid').reply, /On time/);
});
test('never applies fictional status to a different flight number', () => {
  assert.match(flightStatusReply('Is NH110 delayed?', 'delayed').reply, /cannot verify/);
  assert.match(flightStatusReply('Is CL 204 delayed?', 'delayed').reply, /Delayed by 45/);
});
