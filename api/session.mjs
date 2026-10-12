import { freshSession, sessionCookie, sessionIdCookie } from '../lib/vercel-session.mjs';
import { createStoredSession, supabaseEnabled } from '../lib/supabase-store.mjs';
import { json, sameOrigin } from '../lib/vercel-shared.mjs';

export async function POST(request) {
  if (!sameOrigin(request)) return json({ error: 'Request origin is not allowed.' }, 403);
  try {
    const cookie = supabaseEnabled() ? sessionIdCookie(await createStoredSession()) : sessionCookie(freshSession());
    return json({ started: true }, 200, { 'set-cookie': cookie });
  } catch {
    return json({ error: 'Could not start a conversation. Please try again.' }, 503);
  }
}
