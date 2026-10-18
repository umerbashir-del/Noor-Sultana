import assert from 'node:assert/strict';
import test from 'node:test';
import { baggageAllowanceIntent, baggageAllowanceReply } from './baggage.mjs';
test('routes allowance questions without intercepting lost bags or restricted items', () => {
 for (const q of ['Does my ticket include a checked bag?', 'What is my baggage allowance?', 'How much can my suitcase weigh?', 'What size carry-on can I bring?', 'Extra luggage fee?']) assert.equal(baggageAllowanceIntent(q), true, q);
 for (const q of ['Where is baggage claim?', 'My bag is missing', 'Can I bring batteries in my bag?', 'Email my baggage allowance', '2+2']) assert.equal(baggageAllowanceIntent(q), false, q);
});
test('returns fare-specific fictional rules without taking action', () => {
 assert.match(baggageAllowanceReply('', 'basic').reply, /No checked bag is included/);
 assert.match(baggageAllowanceReply('', 'standard').reply, /1 checked bag is included, up to 23 kg/);
 assert.match(baggageAllowanceReply('', 'business').reply, /2 checked bags are included, up to 32 kg/);
 for (const fare of ['basic', 'standard', 'business']) {
  const r = baggageAllowanceReply('', fare);
  assert.match(r.reply, /not real airline policy/);
  assert.match(r.reply, /cannot quote a fee, purchase baggage/);
 }
});
test('rejects unknown fares and does not apply rules to other flights or connections', () => {
 for (const fare of ['invalid', '__proto__', null]) assert.match(baggageAllowanceReply('', fare).reply, /Select Economy/);
 assert.match(baggageAllowanceReply('NH110 baggage allowance').reply, /does not verify/);
 assert.match(baggageAllowanceReply('My connecting flight baggage allowance').reply, /through-checked/);
});
