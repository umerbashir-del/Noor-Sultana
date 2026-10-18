import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
test('crew HTTP endpoints enforce ownership, origin and reviewed confirmation', async () => {
 process.env.PORT = '0';
 process.env.NOOR_SKIP_VOICE_WARMUP = '1';
 process.env.NOOR_EMAIL_DB = ':memory:';
 process.env.NOOR_USAGE_DB = ':memory:';
 const { server } = await import('./server.mjs');
 if (!server.listening) await once(server, 'listening');
 const base = `http://127.0.0.1:${server.address().port}`;
 const start = async () => {
  const response = await fetch(base + '/api/session', { method: 'POST' });
  return response.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
 };
 const call = (cookie, body, origin) => fetch(base + '/api/crew', { method: 'POST', headers: { cookie, 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
 try {
  assert.equal((await call('', { action: 'list' })).status, 401);
  const alice = await start(), bob = await start();
  assert.equal((await call(alice, { action: 'list' }, 'https://other.example')).status, 403);
  const review = await call(alice, { action: 'review', category: 'seat', details: 'Recline is stuck' });
  assert.equal(review.status, 200);
  const { draft } = await review.json();
  assert.equal((await call(alice, { action: 'submit', token: draft.token })).status, 400);
  const submission = await call(alice, { action: 'submit', token: draft.token, confirmed: true });
  assert.equal(submission.status, 200);
  const { request } = await submission.json();
  assert.equal(request.status, 'submitted');
  assert.equal((await call(bob, { action: 'cancel', id: request.id })).status, 404);
  assert.equal((await (await call(bob, { action: 'list' })).json()).requests.length, 0);
  const duplicate = await (await call(alice, { action: 'submit', token: draft.token, confirmed: true })).json();
  assert.equal(duplicate.request.id, request.id);
  const cancelled = await (await call(alice, { action: 'cancel', id: request.id })).json();
  assert.equal(cancelled.request.status, 'cancelled');
  await fetch(base + '/api/session/end', { method: 'POST', headers: { cookie: alice } });
  assert.equal((await call(alice, { action: 'list' })).status, 401);
 } finally { await new Promise((resolve) => server.close(resolve)); }
});
