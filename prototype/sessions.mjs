import { cleanSessionMemory, updateSessionMemory } from './session-memory.mjs';
import { randomBytes } from 'node:crypto';

export const idleSessionMs = 15 * 60 * 1000;
export const absoluteSessionMs = 2 * 60 * 60 * 1000;
const maxStoredMessages = 12;

export function createSessionStore({ clock = Date.now } = {}) {
  const sessions = new Map();

  function expired(session) {
    const now = clock();
    return now - session.lastActiveAt >= idleSessionMs || now - session.createdAt >= absoluteSessionMs;
  }

  function active(session) {
    if (!session || sessions.get(session.id) !== session) return false;
    if (!expired(session)) return true;
    sessions.delete(session.id);
    return false;
  }

  return {
    create(visitorId = null) {
      const now = clock();
      const session = {
        id: randomBytes(32).toString('hex'), visitorId, createdAt: now, lastActiveAt: now,
        revision: 0, messages: [], memory: cleanSessionMemory(),
      };
      sessions.set(session.id, session);
      return session;
    },
    get(id) {
      const session = sessions.get(id);
      if (!active(session)) return null;
      session.lastActiveAt = clock();
      return session;
    },
    end(id) {
      return sessions.delete(id);
    },
    prune() {
      for (const session of sessions.values()) active(session);
    },
    beginTurn(session) {
      if (!active(session)) return null;
      session.revision += 1;
      return session.revision;
    },
    cancelTurn(session, revision) {
      if (active(session) && session.revision === revision) session.revision += 1;
    },
    context(session, message) {
      return [...session.messages.slice(-(maxStoredMessages - 2)), { role: 'user', content: message }];
    },
    commit(session, revision, message, reply, sources=[]) {
      if (!active(session) || session.revision !== revision) return false;
      session.memory=updateSessionMemory(session.memory,message,sources);
      session.messages.push({ role: 'user', content: message }, { role: 'assistant', content: reply });
      if (session.messages.length > maxStoredMessages) {
        session.messages.splice(0, session.messages.length - maxStoredMessages);
      }
      session.lastActiveAt = clock();
      return true;
    },
  };
}
