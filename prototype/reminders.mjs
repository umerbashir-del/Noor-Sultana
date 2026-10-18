import { randomUUID } from 'node:crypto';
import { urgentCrew } from './crew.mjs';
export const reminderKinds = Object.freeze({
 boarding: 'Check boarding information',
 connection: 'Check onward connection details',
 belongings: 'Check that you have your belongings',
 comfort: 'Take a comfort break when permitted by crew',
});
export function reminderIntent(message) {
 return !urgentCrew(message) && !/\b(email|e-mail|text message|sms)\b/i.test(message)
  && /\b(remind(?:er|ers)?|remind me|notify me|alert me)\b/i.test(message);
}
export function reminderReply(available = true) {
 return { expression: 'thoughtful', sourceLabel: 'Demo passenger reminders · In-app only',
  passengerReminders: available, reply: available
   ? 'Choose a travel reminder and a delay below, review the exact time and time zone, then confirm saving. Nothing has been saved yet. Reminders work only while this local demo page and conversation remain active; they do not track flight changes or send email or texts.'
   : 'Passenger reminders are available in the local demo only. This hosted preview cannot save or deliver reminders; nothing has been scheduled.' };
}
export class ReminderError extends Error {
 constructor(message, status = 400) { super(message); this.status = status; }
}
export function reminderAction(session, input, now = Date.now()) {
 if (!input || typeof input !== 'object') throw new ReminderError('Please send a valid action.');
 const state = session.reminders ||= { draft: null, items: [] };
 for (const item of state.items) if (item.status === 'pending' && item.dueAt <= now) item.status = 'due';
 const publicItem = ({ token, ...item }) => item;
 if (input.action === 'list') return { reminders: state.items.map(publicItem) };
 if (input.action === 'review') {
  if (!Object.hasOwn(reminderKinds, input.kind)) throw new ReminderError('Choose a supported travel reminder.');
  if (!Number.isSafeInteger(input.dueAt) || input.dueAt <= now || input.dueAt > now + 2 * 60 * 60_000) throw new ReminderError('Choose a future time within two hours.');
  if (typeof input.timeZone !== 'string' || input.timeZone.length > 80) throw new ReminderError('Choose a valid time zone.');
  try { new Intl.DateTimeFormat('en', { timeZone: input.timeZone }); } catch { throw new ReminderError('Choose a valid time zone.'); }
  if (state.items.length >= 10) throw new ReminderError('This conversation has reached its 10-reminder limit.', 429);
  state.draft = { token: randomUUID(), kind: input.kind, message: reminderKinds[input.kind], dueAt: input.dueAt, timeZone: input.timeZone, expiresAt: Math.min(now + 5 * 60_000, input.dueAt) };
  return { draft: { ...state.draft } };
 }
 if (input.action === 'save') {
  if (input.confirmed !== true || typeof input.token !== 'string') throw new ReminderError('Review and confirm before saving.');
  const existing = state.items.find((r) => r.token === input.token);
  if (existing) return { reminder: publicItem(existing) };
  const draft = state.draft;
  if (!draft || draft.token !== input.token || now >= draft.expiresAt) throw new ReminderError('The review expired or changed. Review the reminder again.', 409);
  const item = { id: randomUUID(), token: draft.token, kind: draft.kind, message: draft.message, dueAt: draft.dueAt, timeZone: draft.timeZone, status: 'pending' };
  state.items.push(item);
  state.draft = null;
  return { reminder: publicItem(item) };
 }
 if (input.action === 'cancel') {
  const item = state.items.find((r) => r.id === input.id);
  if (!item) throw new ReminderError('Reminder not found in this conversation.', 404);
  item.status = 'cancelled';
  return { reminder: publicItem(item) };
 }
 throw new ReminderError('Unsupported reminder action.');
}
