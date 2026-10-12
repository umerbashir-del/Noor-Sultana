import { clearSessionCookie, sessionIdFrom } from '../../lib/vercel-session.mjs';
import { deleteStoredSession, supabaseEnabled } from '../../lib/supabase-store.mjs';
import { json, sameOrigin } from '../../lib/vercel-shared.mjs';

export async function POST(request) {
  if (!sameOrigin(request)) return json({ error: 'Request origin is not allowed.' }, 403);
  try {
    if (supabaseEnabled()) {
      const id = sessionIdFrom(request);
      if (id) await deleteStoredSession(id);
    }
  } catch {
    return json({ error: 'Could not clear the conversation. Please retry.' }, 503);
  }
  return json({ ended: true }, 200, { 'set-cookie': clearSessionCookie() });
}
