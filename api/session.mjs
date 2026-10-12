import { freshSession, sessionCookie } from '../lib/vercel-session.mjs';
import { json, sameOrigin } from '../lib/vercel-shared.mjs';

export function POST(request) {
  if (!sameOrigin(request)) return json({ error: 'Request origin is not allowed.' }, 403);
  return json({ started: true }, 200, { 'set-cookie': sessionCookie(freshSession()) });
}
