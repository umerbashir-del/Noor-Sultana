import { randomBytes } from 'node:crypto';

export function createPublicConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const port = Number(env.PORT ?? 4173);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be a valid port number.');
  const host = env.NOOR_HOST || (production ? '0.0.0.0' : '127.0.0.1');
  const origin = env.PUBLIC_ORIGIN || (production ? '' : `http://127.0.0.1:${port}`);
  let parsed;
  try { parsed = new URL(origin); } catch { throw new Error('PUBLIC_ORIGIN must be an absolute website URL.'); }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error('PUBLIC_ORIGIN must contain only the website origin.');
  }
  if (production && parsed.protocol !== 'https:') throw new Error('Production PUBLIC_ORIGIN must use HTTPS.');
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('PUBLIC_ORIGIN must use HTTP or HTTPS.');
  return { production, port, host, publicOrigin: parsed.origin, secureCookies: production || parsed.protocol === 'https:' };
}

export function allowedOrigin(origin, config) {
  if (!config.production && !origin) return true;
  if (origin === config.publicOrigin) return true;
  return !config.production && [
    `http://localhost:${config.port}`, `http://127.0.0.1:${config.port}`,
  ].includes(origin);
}

export function cookieHeader(name, value, maxAgeSeconds, secure) {
  const safeName = /^[a-z_]+$/.test(name);
  const safeValue = /^[a-f0-9]*$/.test(value);
  if (!safeName || !safeValue) throw new Error('Invalid cookie value.');
  return `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

export function newVisitorId() {
  return randomBytes(32).toString('hex');
}
