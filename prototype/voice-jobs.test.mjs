import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createVoiceJobQueue, VoiceJobCancelled, VoiceQueueFull } from './voice-jobs.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((fulfill, fail) => { resolve = fulfill; reject = fail; });
  return { promise, resolve, reject };
}

test('stopping a queued visitor leaves the active visitor speaking', async () => {
  const first = deferred();
  const calls = [];
  let workerStops = 0;
  const jobs = createVoiceJobQueue({
    run: (text) => { calls.push(text); return first.promise; },
    cancelActive: () => { workerStops += 1; },
  });
  const alice = jobs.submit('alice', 'Hello');
  const bob = jobs.submit('bob', 'Goodbye');
  const bobCancelled = assert.rejects(bob.promise, VoiceJobCancelled);
  assert.equal(jobs.cancelSession('bob'), true);
  first.resolve(Buffer.from('alice audio'));
  assert.equal((await alice.promise).toString(), 'alice audio');
  await bobCancelled;
  assert.deepEqual(calls, ['Hello']);
  assert.equal(workerStops, 0);
});

test('stopping an active visitor lets the next visitor proceed', async () => {
  const first = deferred();
  const calls = [];
  let workerStops = 0;
  const jobs = createVoiceJobQueue({
    run: (text) => {
      calls.push(text);
      return text === 'Alice' ? first.promise : Promise.resolve(Buffer.from('bob audio'));
    },
    cancelActive: () => { workerStops += 1; first.reject(new Error('worker stopped')); },
  });
  const alice = jobs.submit('alice', 'Alice');
  const aliceCancelled = assert.rejects(alice.promise, VoiceJobCancelled);
  const bob = jobs.submit('bob', 'Bob');
  assert.equal(jobs.cancelSession('alice'), true);
  await aliceCancelled;
  assert.equal((await bob.promise).toString(), 'bob audio');
  assert.deepEqual(calls, ['Alice', 'Bob']);
  assert.equal(workerStops, 1);
});

test('one session cannot stack speech jobs beyond the queue bound', async () => {
  const first = deferred();
  const jobs = createVoiceJobQueue({
    run: () => first.promise,
    cancelActive: () => {},
    maxQueued: 1,
  });
  const alice = jobs.submit('alice', 'One');
  const bob = jobs.submit('bob', 'Two');
  assert.throws(() => jobs.submit('carol', 'Three'), VoiceQueueFull);
  const bobCancelled = assert.rejects(bob.promise, VoiceJobCancelled);
  assert.equal(jobs.cancelSession('bob'), true);
  await bobCancelled;
  first.resolve(Buffer.from('alice audio'));
  assert.equal((await alice.promise).toString(), 'alice audio');
});
