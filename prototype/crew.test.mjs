import test from 'node:test';
import assert from 'node:assert/strict';
import { crewAction, crewReply, crewIntent } from './crew.mjs';
test('requires review and confirmation and fixes the passenger seat', () => {
 const session = {};
 assert.throws(() => crewAction(session, { action: 'submit', token: 'fake', confirmed: true }));
 const { draft } = crewAction(session, { action: 'review', category: 'seat', details: 'Seat recline is stuck', seat: '1A' }, 100);
 assert.equal(draft.seat, '12A');
 assert.equal(crewAction(session, { action: 'list' }).requests.length, 0);
 assert.throws(() => crewAction(session, { action: 'submit', token: draft.token }));
 const payload = { action: 'submit', token: draft.token, confirmed: true, details: 'changed', seat: '1A' };
 const one = crewAction(session, payload, 101).request;
 const two = crewAction(session, payload, 102).request;
 assert.equal(one.id, two.id);
 assert.equal(one.details, 'Seat recline is stuck');
 assert.equal(one.seat, '12A');
 assert.equal(one.status, 'submitted');
 assert.equal(one.token, undefined);
});
test('session isolation, cancellation, expired and superseded reviews', () => {
 const a = {}, b = {};
 const first = crewAction(a, { action: 'review', category: 'comfort', details: 'A pillow please' }, 1).draft;
 assert.throws(() => crewAction(b, { action: 'submit', token: first.token, confirmed: true }, 2));
 assert.throws(() => crewAction(a, { action: 'submit', token: first.token, confirmed: true }, 300001));
 const second = crewAction(a, { action: 'review', category: 'general', details: 'A question please' }, 300002).draft;
 assert.throws(() => crewAction(a, { action: 'submit', token: first.token, confirmed: true }, 300003));
 const req = crewAction(a, { action: 'submit', token: second.token, confirmed: true }, 300004).request;
 assert.throws(() => crewAction(b, { action: 'cancel', id: req.id }));
 assert.equal(crewAction(a, { action: 'cancel', id: req.id }).request.status, 'cancelled');
 assert.equal(crewAction(b, { action: 'list' }).requests.length, 0);
});
test('validates actions, input, urgency and session limits', () => {
 for (const input of [{ action: 'review', category: '__proto__', details: 'Hi' }, { action: 'review', category: 'seat', details: '' }, { action: 'review', category: 'seat', details: 'x'.repeat(201) }, { action: 'review', category: 'seat', details: 'medical emergency' }, { action: 'complete' }]) assert.throws(() => crewAction({}, input));
 const session = {};
 for (let i = 0; i < 10; i++) {
  const { draft } = crewAction(session, { action: 'review', category: 'general', details: 'Demo request' });
  crewAction(session, { action: 'submit', token: draft.token, confirmed: true });
 }
 assert.throws(() => crewAction(session, { action: 'review', category: 'general', details: 'Extra' }), /limit/);
 assert.equal(crewIntent('Could someone help with my seat?'), true);
 assert.equal(crewReply('medical emergency').crewAssistance, undefined);
 assert.match(crewReply('medical emergency').reply, /contact cabin crew directly/);
 assert.equal(crewReply('crew help', false).crewAssistance, false);
});
