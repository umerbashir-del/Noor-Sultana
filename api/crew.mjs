import { json, sameOrigin } from '../lib/vercel-shared.mjs';
export async function POST(request) {
  if (!sameOrigin(request)) return json({ error: 'Request origin is not allowed.' }, 403);
  return json({ error: 'Crew requests are available in the local demo only. No real crew contacted.' }, 503);
}
