import assert from 'node:assert/strict';
import test from 'node:test';
import { createUsageStore, UsageLimitError, usageLimitsFromEnv } from './usage-store.mjs';

const alice = 'a'.repeat(64);
const bob = 'b'.repeat(64);

test('local opt-in removes daily caps while retaining usage records', () => {
  const limits = usageLimitsFromEnv({ NOOR_LOCAL_UNLIMITED_USAGE: '1' }, { allowUnlimitedLocal: true });
  for (const policy of Object.values(limits)) {
    for (const cap of Object.values(policy)) assert.equal(cap, Infinity);
  }
  const store = createUsageStore({ limits });
  for (let i = 0; i < 32; i++) {
    store.settleClaude(store.reserveClaude(alice, 400_000), 400_000);
    store.recordOperation(alice, 'speak');
  }
  assert.equal(store.totals(alice).visitor.tokens, 12_800_000);
  assert.equal(store.totals(alice, 'speak').visitor.requests, 32);
  store.close();
});

test('production and servers without local permission ignore unlimited flag', () => {
  const defaults = usageLimitsFromEnv({});
  assert.deepEqual(usageLimitsFromEnv({ NOOR_LOCAL_UNLIMITED_USAGE: '1' }), defaults);
  assert.deepEqual(usageLimitsFromEnv({
    NOOR_LOCAL_UNLIMITED_USAGE: '1', NODE_ENV: 'production',
  }, { allowUnlimitedLocal: true }), defaults);
});

test('visitor and overall limits apply across separate conversations', () => {
  const limits = usageLimitsFromEnv({
    NOOR_DAILY_CLAUDE_VISITOR_REQUESTS: '2', NOOR_DAILY_CLAUDE_GLOBAL_REQUESTS: '3',
    NOOR_DAILY_CLAUDE_VISITOR_TOKENS: '5000', NOOR_DAILY_CLAUDE_GLOBAL_TOKENS: '9000',
  });
  const store = createUsageStore({ limits });
  const first = store.reserveClaude(alice, 3000);
  store.settleClaude(first, 500);
  store.settleClaude(store.reserveClaude(alice, 3000), 600);
  assert.throws(() => store.reserveClaude(alice, 3000), (error) => error instanceof UsageLimitError && error.scope === 'visitor');
  store.settleClaude(store.reserveClaude(bob, 3000), 700);
  assert.throws(() => store.reserveClaude(bob, 3000), (error) => error instanceof UsageLimitError && error.scope === 'global');
  assert.equal(store.totals(alice).visitor.tokens, 1100);
  store.close();
});

test('reservations prevent concurrent overspend and old usage is deleted', () => {
  let now = Date.UTC(2026, 9, 11);
  const limits = usageLimitsFromEnv({ NOOR_DAILY_CLAUDE_GLOBAL_TOKENS: '5000' });
  const store = createUsageStore({ clock: () => now, limits });
  store.reserveClaude(alice, 3000);
  assert.throws(() => store.reserveClaude(bob, 3000), UsageLimitError);
  now += 31 * 24 * 60 * 60 * 1000;
  store.prune();
  assert.equal(store.totals(alice).global.requests, 0);
  store.close();
});

test('voice and transcription have separate daily limits', () => {
  const limits = usageLimitsFromEnv({ NOOR_DAILY_SPEAK_VISITOR_REQUESTS: '1' });
  const store = createUsageStore({ limits });
  store.recordOperation(alice, 'speak');
  assert.throws(() => store.recordOperation(alice, 'speak'), UsageLimitError);
  store.recordOperation(alice, 'transcribe');
  store.recordOperation(bob, 'speak');
  store.close();
});
