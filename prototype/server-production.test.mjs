import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';

test('production requires its configured origin and emits secure cookies', async () => {
  process.env.NODE_ENV = 'production';
  process.env.PUBLIC_ORIGIN = 'https://noor.example';
  process.env.NOOR_HOST = '127.0.0.1';
  process.env.PORT = '0';
  process.env.NOOR_SKIP_VOICE_WARMUP = '1';
  process.env.NOOR_EMAIL_DB = ':memory:';
  process.env.NOOR_USAGE_DB = ':memory:';
  process.env.NOOR_LOCAL_UNLIMITED_USAGE = '1';
  process.env.NOOR_DAILY_SPEAK_VISITOR_REQUESTS = '1';
  process.env.CHATTERBOX_PYTHON = '/nonexistent/noor-production-test-python';
  const { server } = await import('./server.mjs');
  if (!server.listening) await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // Local-use SDK/model assets must never be served in production mode.
    assert.equal((await fetch(`${base}/live2d-local/manifest.json`)).status, 404);
    assert.equal((await fetch(`${base}/live2d-local/core/live2dcubismcore.min.js`)).status, 404);
    assert.equal((await fetch(`${base}/avatar.js`)).status, 200);
    const missingOrigin = await fetch(`${base}/api/session`, { method: 'POST' });
    assert.equal(missingOrigin.status, 403);
    const started = await fetch(`${base}/api/session`, {
      method: 'POST', headers: { origin: 'https://noor.example' },
    });
    assert.equal(started.status, 200);
    assert.match(started.headers.get('strict-transport-security'), /max-age=31536000/);
    const cookies = started.headers.getSetCookie();
    assert.equal(cookies.length, 2);
    assert.ok(cookies.every((cookie) => cookie.includes('; Secure')));
    const speechRequest = () => fetch(`${base}/api/speak`, {
      method: 'POST',
      headers: { origin: 'https://noor.example', 'content-type': 'application/json',
        cookie: cookies.map(cookie => cookie.split(';')[0]).join('; ') },
      body: JSON.stringify({ text: 'Production limit check.' }),
    });
    // No synthesis runs, but the first valid attempt still consumes its quota.
    assert.equal((await speechRequest()).status, 503);
    const limited = await speechRequest();
    assert.equal(limited.status, 429);
    assert.match((await limited.json()).error, /today’s usage limit/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
