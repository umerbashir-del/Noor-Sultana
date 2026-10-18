import { cleanSessionMemory, updateSessionMemory } from '../prototype/session-memory.mjs';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const cookieName = 'noor_demo';
const idleMs = 15 * 60_000;
const absoluteMs = 2 * 60 * 60_000;
const maxCookieLength = 3700;

function secretKey() {
  const value = process.env.NOOR_SESSION_SECRET;
  if (!/^[a-f0-9]{64}$/i.test(value || '')) throw new Error('NOOR_SESSION_SECRET must be a 32-byte hex value.');
  return Buffer.from(value, 'hex');
}

function seal(session) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(session)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

function unseal(value) {
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', secretKey(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
  } catch { return null; }
}

export function sessionFrom(request, now = Date.now()) {
  const pair = (request.headers.get('cookie') || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));
  const session = unseal(pair?.slice(cookieName.length + 1) || '');
  if (!session || !Number.isFinite(session.createdAt) || !Number.isFinite(session.activeAt)
    || now < session.createdAt || now - session.createdAt >= absoluteMs
    || now - session.activeAt >= idleMs || !Array.isArray(session.messages)
    || !Number.isInteger(session.calls) || session.calls < 0) return null;
  return session;
}

export function freshSession(now = Date.now()) {
  return { createdAt: now, activeAt: now, calls: 0, messages: [], memory: cleanSessionMemory() };
}

export function sessionIdFrom(request) {
  const pair = (request.headers.get('cookie') || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));
  const id = unseal(pair?.slice(cookieName.length + 1) || '')?.id;
  return typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
    ? id : null;
}

export function sessionMemoryFrom(request) {
 const pair=(request.headers.get('cookie')||'').split(';').map(part=>part.trim()).find(part=>part.startsWith(cookieName+'='));
 return cleanSessionMemory(unseal(pair?.slice(cookieName.length+1)||'')?.memory);
}
export function sessionIdCookie(id,memory) {
  return `${cookieName}=${seal({ id, ...(memory===undefined?{}:{memory:cleanSessionMemory(memory)}) })}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(absoluteMs / 1000)}`;
}

export function sessionCookie(session) {
  let value = seal(session);
  while (value.length > maxCookieLength && session.messages.length > 2) {
    session.messages.splice(0, 2);
    value = seal(session);
  }
  if (value.length > maxCookieLength) throw new Error('Conversation state is too large.');
  return `${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(absoluteMs / 1000)}`;
}

export function clearSessionCookie() {
  return `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function updateSession(session, message, reply, now = Date.now(), sources=[]) {
  session.memory=updateSessionMemory(session.memory,message,sources);
  session.activeAt = now;
  session.calls += 1;
  session.messages.push({ role: 'user', content: message }, { role: 'assistant', content: reply });
  if (session.messages.length > 6) session.messages.splice(0, session.messages.length - 6);
  return session;
}

// Anonymous visitor continuity is separate from revocable conversation sessions.
export function visitorIdFrom(request) {
 const pair=(request.headers.get('cookie')||'').split(';').map(p=>p.trim()).find(p=>p.startsWith('noor_visitor='));
 const id=unseal(pair?.slice('noor_visitor='.length)||'')?.visitorId;
 return typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)?id:null;
}
export function visitorCookie(visitorId) {
 return 'noor_visitor='+seal({visitorId})+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000';
}
