import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmailScheduler } from './email-scheduler.mjs';

const minute = 60_000;
const day = 24 * 60 * minute;

function fixture(dbPath = ':memory:') {
  let now = Date.parse('2026-10-11T12:00:00.000Z');
  let sequence = 0;
  let lastEvent = 'delivered';
  const sends = [];
  const provider = {
    async send(message) {
      sends.push(message);
      return { id: `provider-${++sequence}` };
    },
    async get() { return { lastEvent }; },
  };
  const clock = () => now;
  const scheduler = createEmailScheduler({ dbPath, provider, clock });
  return {
    scheduler, provider, sends, clock,
    advance: (duration) => { now += duration; },
    setEvent: (event) => { lastEvent = event; },
  };
}

async function verified(f, session = 'session-one', address = 'passenger@example.com') {
  const challenge = await f.scheduler.requestVerification(session, address);
  const code = /\b(\d{6})\b/.exec(f.sends.at(-1).text)?.[1];
  assert.ok(code);
  assert.equal(f.scheduler.verify(session, challenge.challengeId, code).verified, true);
  return challenge.challengeId;
}

test('verification controls review; confirmation persists; worker sends and tracks delivery', async () => {
  const f = fixture();
  try {
    const challengeId = await verified(f);
    const scheduledAt = new Date(f.clock() + 3 * minute).toISOString();
    assert.throws(() => f.scheduler.review('other-session', challengeId, scheduledAt), /conversation/);
    const preview = f.scheduler.review('session-one', challengeId, scheduledAt);
    assert.equal(preview.to, 'passenger@example.com');
    assert.deepEqual(preview.attachments, []);
    assert.throws(() => f.scheduler.schedule('session-one', challengeId, scheduledAt, 'wrong'), /Review it again/);
    const job = f.scheduler.schedule('session-one', challengeId, scheduledAt, preview.reviewHash);
    assert.equal(job.status, 'scheduled');
    assert.equal(f.scheduler.schedule('session-one', challengeId, scheduledAt, preview.reviewHash).id, job.id);
    f.advance(11 * minute);
    assert.equal(f.scheduler.list('session-one', challengeId)[0].status, 'scheduled');
    await f.scheduler.runDue();
    assert.equal(f.sends.length, 2);
    assert.equal(f.sends[1].text, preview.body);
    assert.equal(f.sends[1].idempotencyKey, `arrival/${job.id}`);
    assert.equal(f.scheduler.list('session-one', challengeId)[0].status, 'sent');
    await f.scheduler.runDue();
    assert.equal(f.scheduler.list('session-one', challengeId)[0].deliveryEvent, 'delivered');
  } finally { f.scheduler.close(); }
});

test('cancel prevents send; a new verified session can see the same address status', async () => {
  const f = fixture();
  try {
    const original = await verified(f);
    const scheduledAt = new Date(f.clock() + 2 * minute).toISOString();
    const preview = f.scheduler.review('session-one', original, scheduledAt);
    const job = f.scheduler.schedule('session-one', original, scheduledAt, preview.reviewHash);
    const next = await verified(f, 'session-two');
    assert.equal(f.scheduler.list('session-two', next)[0].id, job.id);
    assert.throws(() => f.scheduler.cancel('other-session', next, job.id), /conversation/);
    assert.equal(f.scheduler.cancel('session-two', next, job.id).status, 'cancelled');
    f.advance(3 * minute);
    await f.scheduler.runDue();
    assert.equal(f.sends.length, 2);
  } finally { f.scheduler.close(); }
});

test('failed delivery is visible and terminal message data expires after 30 days', async () => {
  const f = fixture();
  try {
    const challengeId = await verified(f);
    const scheduledAt = new Date(f.clock() + 2 * minute).toISOString();
    const preview = f.scheduler.review('session-one', challengeId, scheduledAt);
    f.scheduler.schedule('session-one', challengeId, scheduledAt, preview.reviewHash);
    f.advance(3 * minute);
    f.setEvent('bounced');
    await f.scheduler.runDue();
    assert.equal(f.scheduler.list('session-one', challengeId)[0].status, 'failed');
    f.advance(31 * day);
    f.scheduler.prune();
    const fresh = await verified(f, 'session-two');
    assert.deepEqual(f.scheduler.list('session-two', fresh), []);
  } finally { f.scheduler.close(); }
});

test('scheduled requests survive scheduler restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'noor-email-test-'));
  const path = join(directory, 'email.sqlite');
  const f = fixture(path);
  try {
    const challengeId = await verified(f);
    const scheduledAt = new Date(f.clock() + 2 * minute).toISOString();
    const preview = f.scheduler.review('session-one', challengeId, scheduledAt);
    const job = f.scheduler.schedule('session-one', challengeId, scheduledAt, preview.reviewHash);
    f.scheduler.close();
    const restarted = createEmailScheduler({ dbPath: path, provider: f.provider, clock: f.clock });
    try {
      assert.equal(restarted.list('session-one', challengeId)[0].id, job.id);
      f.advance(3 * minute);
      await restarted.runDue();
      assert.equal(restarted.list('session-one', challengeId)[0].status, 'sent');
    } finally { restarted.close(); }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an unconfirmed provider outcome is never reported as sent', async () => {
  const f = fixture();
  try {
    const challengeId = await verified(f);
    const scheduledAt = new Date(f.clock() + 2 * minute).toISOString();
    const preview = f.scheduler.review('session-one', challengeId, scheduledAt);
    f.scheduler.schedule('session-one', challengeId, scheduledAt, preview.reviewHash);
    f.provider.send = async () => { throw new Error('Connection lost after request'); };
    f.advance(3 * minute);
    await f.scheduler.runDue();
    assert.equal(f.scheduler.list('session-one', challengeId)[0].status, 'sending');
    f.advance(3 * minute);
    await f.scheduler.runDue();
    f.advance(3 * minute);
    await f.scheduler.runDue();
    assert.equal(f.scheduler.list('session-one', challengeId)[0].status, 'unknown');
  } finally { f.scheduler.close(); }
});
