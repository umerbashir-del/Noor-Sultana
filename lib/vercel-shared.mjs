export function json(payload, status = 200, headers = {}) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      ...headers,
    },
  });
}

export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).host === new URL(request.url).host; }
  catch { return false; }
}

export async function readMessage(request) {
  if (Number(request.headers.get('content-length')) > 16_000) return null;
  const body = await request.text();
  if (body.length > 16_000) return null;
  let parsed;
  try { parsed = JSON.parse(body); } catch { return null; }
  const message = typeof parsed?.message === 'string' ? parsed.message.trim() : '';
  return message && message.length <= 500 ? message : null;
}
