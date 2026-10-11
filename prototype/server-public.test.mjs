import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';

test('health, visitor cookies, origin checks, and session isolation work over HTTP', async () => {
  process.env.PORT = '0';
  process.env.NOOR_SKIP_VOICE_WARMUP = '1';
  process.env.NOOR_EMAIL_DB = ':memory:';
  process.env.NOOR_USAGE_DB = ':memory:';
  const { server } = await import('./server.mjs');
  if (!server.listening) await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const startAlice = await fetch(`${base}/api/session`, { method: 'POST' });
    assert.equal(startAlice.status, 200);
    const aliceCookies = startAlice.headers.getSetCookie().map((header) => header.split(';')[0]).join('; ');
    assert.match(aliceCookies, /noor_session=/);
    assert.match(aliceCookies, /noor_visitor=/);

    const startBob = await fetch(`${base}/api/session`, { method: 'POST' });
    const bobCookies = startBob.headers.getSetCookie().map((header) => header.split(';')[0]).join('; ');
    const aliceSession = /noor_session=([a-f0-9]+)/.exec(aliceCookies)[1];
    const bobVisitor = /noor_visitor=([a-f0-9]+)/.exec(bobCookies)[1];
    const mixed = await fetch(`${base}/api/stop`, {
      method: 'POST', headers: { cookie: `noor_session=${aliceSession}; noor_visitor=${bobVisitor}` },
    });
    assert.equal(mixed.status, 401);

    const chat = await fetch(`${base}/api/chat`, {
      method: 'POST', headers: { cookie: aliceCookies, 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Prepare my arrival email draft.' }),
    });
    assert.equal(chat.status, 200);
    assert.match((await chat.json()).reply, /verify/);

    const forbidden = await fetch(`${base}/api/stop`, {
      method: 'POST', headers: { cookie: aliceCookies, origin: 'https://other.example' },
    });
    assert.equal(forbidden.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
