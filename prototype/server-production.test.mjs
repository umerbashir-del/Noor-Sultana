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
  const { server } = await import('./server.mjs');
  if (!server.listening) await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
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
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
