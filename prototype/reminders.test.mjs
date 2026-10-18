import test from 'node:test';
import assert from 'node:assert/strict';
import { reminderAction, reminderIntent, reminderReply } from './reminders.mjs';
const draftFor = (s, now = 1000) => reminderAction(s, { action: 'review', kind: 'boarding', dueAt: now + 60000, timeZone: 'America/New_York' }, now).draft;
test('reminders require reviewed confirmation, preserve reviewed time, and deduplicate saves', () => {
 const session = {}, draft = draftFor(session);
 assert.equal(reminderAction(session, { action: 'list' }, 1001).reminders.length, 0);
 assert.throws(() => reminderAction(session, { action: 'save', token: draft.token }, 1001));
 const input = { action: 'save', token: draft.token, confirmed: true, dueAt: 99, message: 'changed' };
 const one = reminderAction(session, input, 1001).reminder;
 assert.equal(one.dueAt, 61000);
 assert.equal(one.message, 'Check boarding information');
 assert.equal(one.token, undefined);
 assert.equal(reminderAction(session, input, 1002).reminder.id, one.id);
 assert.equal(reminderAction(session, { action: 'list' }, 60999).reminders[0].status, 'pending');
 assert.equal(reminderAction(session, { action: 'list' }, 61000).reminders[0].status, 'due');
});
test('ownership, cancellation, expiry and timing validation', () => {
 const a = {}, b = {}, draft = draftFor(a);
 assert.throws(() => reminderAction(b, { action: 'save', token: draft.token, confirmed: true }, 1001));
 assert.throws(() => reminderAction(a, { action: 'save', token: draft.token, confirmed: true }, 61000));
 const fresh = draftFor(a, 70000);
 const item = reminderAction(a, { action: 'save', token: fresh.token, confirmed: true }, 70001).reminder;
 assert.throws(() => reminderAction(b, { action: 'cancel', id: item.id }, 70002));
 assert.equal(reminderAction(a, { action: 'cancel', id: item.id }, 70002).reminder.status, 'cancelled');
 assert.equal(reminderAction(a, { action: 'list' }, 150000).reminders[0].status, 'cancelled');
 for (const changes of [{ dueAt: 0 }, { dueAt: 999999999 }, { timeZone: 'wrong-zone' }, { kind: '__proto__' }]) assert.throws(() => reminderAction({}, { action: 'review', kind: 'boarding', dueAt: 61000, timeZone: 'UTC', ...changes }, 1000));
});
test('routing preserves urgent help and email and caps reminder count', () => {
 assert.equal(reminderIntent('Remind me before boarding'), true);
 assert.equal(reminderIntent('Show my reminders'), true);
 assert.equal(reminderIntent('Email a reminder'), false);
 assert.equal(reminderIntent('Remind me about a medical emergency'), false);
 assert.equal(reminderReply(false).passengerReminders, false);
 const s = {};
 for (let i = 0; i < 10; i++) {
  const d = draftFor(s);
  reminderAction(s, { action: 'save', token: d.token, confirmed: true }, 1001);
 }
 assert.throws(() => draftFor(s), /limit/);
});
