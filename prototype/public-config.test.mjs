import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedOrigin, cookieHeader, createPublicConfig, newVisitorId } from './public-config.mjs';

test('public settings require an HTTPS origin and secure cookies', () => {
  assert.throws(() => createPublicConfig({ NODE_ENV: 'production', PUBLIC_ORIGIN: 'http://noor.example' }), /HTTPS/);
  assert.throws(() => createPublicConfig({ NODE_ENV: 'production' }), /PUBLIC_ORIGIN/);
  const config = createPublicConfig({ NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://noor.example' });
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.secureCookies, true);
  assert.equal(allowedOrigin('https://noor.example', config), true);
  assert.equal(allowedOrigin('https://other.example', config), false);
  assert.equal(allowedOrigin(undefined, config), false);
  assert.match(cookieHeader('noor_session', newVisitorId(), 3600, config.secureCookies), /; Secure$/);
});

test('local settings keep loopback access available', () => {
  const config = createPublicConfig({ PORT: '4173' });
  assert.equal(config.host, '127.0.0.1');
  assert.equal(allowedOrigin('http://localhost:4173', config), true);
  assert.equal(allowedOrigin(undefined, config), true);
  assert.doesNotMatch(cookieHeader('noor_session', '', 0, config.secureCookies), /; Secure/);
});

test('Render production uses its assigned HTTPS URL unless a custom origin is set', () => {
  const config = createPublicConfig({
    NODE_ENV: 'production', RENDER: 'true', RENDER_EXTERNAL_URL: 'https://noor-demo.onrender.com',
  });
  assert.equal(config.publicOrigin, 'https://noor-demo.onrender.com');
  assert.equal(allowedOrigin('https://noor-demo.onrender.com', config), true);
  assert.throws(() => createPublicConfig({
    NODE_ENV: 'production', RENDER: 'true', RENDER_EXTERNAL_URL: 'http://noor-demo.onrender.com',
  }), /HTTPS/);
});
