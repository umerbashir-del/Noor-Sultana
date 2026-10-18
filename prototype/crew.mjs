import { randomUUID } from 'node:crypto';
export const crewCategories = Object.freeze({ seat: 'Seat assistance', comfort: 'Comfort item', general: 'General assistance' });
export function urgentCrew(message) {
 return /\b(emergency|medical|chest pain|cannot breathe|can’t breathe|can't breathe|bleeding|fire|smoke|unsafe|security|urgent)\b/i.test(message);
}
export function crewIntent(message) {
 return urgentCrew(message) || /\b(crew|flight attendant|steward)\b/i.test(message)
  || /\b(help|assistance|problem|broken)\b.*\bseat\b/i.test(message)
  || /\b(blanket|pillow|seat assistance)\b/i.test(message);
}
export function crewReply(message, available = true) {
 const base = { expression: 'thoughtful', sourceLabel: 'Demo crew assistance · No real crew contacted' };
 if (urgentCrew(message)) return { ...base, reply: 'For urgent, medical, safety, or security help, contact cabin crew directly and follow their instructions. This demo cannot summon real assistance.' };
 return { ...base, crewAssistance: available, reply: available
  ? 'You can prepare a demo assistance request for seat 12A below. Review the category and message, then confirm submission; nothing has been submitted yet. No real crew will be contacted.'
  : 'Crew requests are available in the local demo only. This hosted preview cannot submit or store requests; no real crew has been contacted.' };
}
export class CrewError extends Error {
 constructor(message, status = 400) { super(message); this.status = status; }
}
export function crewAction(session, input, now = Date.now()) {
 if (!input || typeof input !== 'object') throw new CrewError('Please send a valid action.');
 const state = session.crew ||= { draft: null, requests: [] };
 const publicRequest = ({ token, ...request }) => request;
 if (input.action === 'list') return { requests: state.requests.map(publicRequest) };
 if (input.action === 'review') {
  if (!Object.hasOwn(crewCategories, input.category)) throw new CrewError('Choose a supported request category.');
  if (typeof input.details !== 'string' || !input.details.trim() || input.details.length > 200) throw new CrewError('Enter a message of 1–200 characters.');
  if (urgentCrew(input.details)) throw new CrewError('For urgent help, contact cabin crew directly. This demo cannot summon assistance.');
  if (state.requests.length >= 10) throw new CrewError('This demo session has reached its 10-request limit.', 429);
  state.draft = { token: randomUUID(), seat: '12A', category: input.category, details: input.details.trim(), expiresAt: now + 5 * 60_000 };
  return { draft: { ...state.draft, categoryLabel: crewCategories[state.draft.category] } };
 }
 if (input.action === 'submit') {
  if (input.confirmed !== true || typeof input.token !== 'string') throw new CrewError('Review and confirm the request before submitting.');
  const existing = state.requests.find((r) => r.token === input.token);
  if (existing) return { request: publicRequest(existing) };
  const draft = state.draft;
  if (!draft || draft.token !== input.token || now >= draft.expiresAt) throw new CrewError('The review expired or changed. Review the request again.', 409);
  if (state.requests.length >= 10) throw new CrewError('This demo session has reached its 10-request limit.', 429);
  const request = { id: randomUUID(), token: draft.token, seat: draft.seat, category: draft.category, details: draft.details, status: 'submitted', createdAt: now };
  state.requests.push(request);
  state.draft = null;
  return { request: publicRequest(request) };
 }
 if (input.action === 'cancel') {
  const request = state.requests.find((r) => r.id === input.id);
  if (!request) throw new CrewError('Request not found in this conversation.', 404);
  if (request.status === 'completed') throw new CrewError('This demo request is already completed.', 409);
  request.status = 'cancelled';
  request.updatedAt = now;
  return { request: publicRequest(request) };
 }
 throw new CrewError('Unsupported crew action.');
}
