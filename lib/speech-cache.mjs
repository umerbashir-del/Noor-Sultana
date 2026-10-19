// Warm-instance memory only. Never retain arbitrary conversation replies.
export const cacheableSpeech = Object.freeze([
  'Welcome aboard.', 'Hello.', 'Thank you.', "You're welcome.", 'Please try again.',
]);
const allowed = new Set(cacheableSpeech);
export function createSpeechCache({ ttlMs = 600_000, maxBytes = 2_000_000, now = Date.now } = {}) {
  const ttl = Number.isFinite(ttlMs) ? Math.max(1, Math.min(ttlMs, 3_600_000)) : 600_000;
  const limit = Number.isFinite(maxBytes) ? Math.max(1, Math.min(maxBytes, 20_000_000)) : 2_000_000;
  const entries = new Map();
  let bytes = 0;
  const keyFor = (identity, text) => typeof identity === 'string' && identity.length > 0 && identity.length <= 512 && !/[\r\n]/u.test(identity) && allowed.has(text) ? JSON.stringify([identity, text]) : null;
  function remove(key) { const item = entries.get(key); if (item) { bytes -= item.audio.byteLength; entries.delete(key); } }
  function expire() { for (const [key, item] of entries) if (now() >= item.expires) remove(key); }
  return {
    get(identity, text) {
      const key = keyFor(identity, text); if (!key) return null;
      expire(); const item = entries.get(key); if (!item) return null;
      entries.delete(key); entries.set(key, item);
      return Uint8Array.from(item.audio);
    },
    set(identity, text, audio) {
      const key = keyFor(identity, text);
      if (!key || !(audio instanceof Uint8Array) || !audio.byteLength || audio.byteLength > limit) return false;
      expire(); remove(key);
      while (entries.size >= 24 || bytes + audio.byteLength > limit) remove(entries.keys().next().value);
      const copy = Uint8Array.from(audio);
      entries.set(key, { audio: copy, expires: now() + ttl }); bytes += copy.byteLength;
      return true;
    },
  };
}
