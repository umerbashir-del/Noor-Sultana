import assert from 'node:assert/strict';
import test from 'node:test';
import { logEvent, safeRoute } from './monitor.mjs';

test('monitoring logs route and counts without message contents', () => {
  const original = console.log;
  let line;
  console.log = (value) => { line = value; };
  try { logEvent('request', { route: safeRoute('/api/chat'), status: 200, tokens: 82, message: 'private words' }); }
  finally { console.log = original; }
  const parsed = JSON.parse(line);
  assert.equal(parsed.route, 'chat');
  assert.equal(parsed.tokens, 82);
  assert.doesNotMatch(line, /private words/);
  assert.equal(safeRoute('/api/email/jobs/secret-id'), 'email');
});
