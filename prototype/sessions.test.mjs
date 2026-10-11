import assert from 'node:assert/strict';
import test from 'node:test';
import { absoluteSessionMs, createSessionStore, idleSessionMs } from './sessions.mjs';

test('keeps conversations separate and rejects a reply after ending its session', () => {
  const store = createSessionStore();
  const first = store.create();
  const second = store.create();
  assert.notEqual(first.id, second.id);
  const turn = store.beginTurn(first);
  assert.deepEqual(store.context(first, 'Where are we going?'), [{ role: 'user', content: 'Where are we going?' }]);
  assert.equal(store.commit(first, turn, 'Where are we going?', 'Tokyo.'), true);
  assert.deepEqual(store.context(second, 'Hello'), [{ role: 'user', content: 'Hello' }]);
  store.end(first.id);
  assert.equal(store.get(first.id), null);
  assert.equal(store.commit(first, turn, 'Another question', 'Private answer'), false);
});

test('expires idle and long-running sessions on the server', () => {
  let now = 1_000_000;
  const store = createSessionStore({ clock: () => now });
  const idle = store.create();
  now += idleSessionMs;
  assert.equal(store.get(idle.id), null);

  const long = store.create();
  now += idleSessionMs - 1;
  assert.ok(store.get(long.id));
  now = long.createdAt + absoluteSessionMs;
  assert.equal(store.get(long.id), null);
});

test('a later request supersedes an unfinished response and history stays bounded', () => {
  const store = createSessionStore();
  const session = store.create();
  const oldTurn = store.beginTurn(session);
  const newTurn = store.beginTurn(session);
  assert.equal(store.commit(session, oldTurn, 'Old', 'Old reply'), false);
  assert.equal(store.commit(session, newTurn, 'New', 'New reply'), true);
  for (let i = 0; i < 8; i += 1) {
    const turn = store.beginTurn(session);
    store.commit(session, turn, `Question ${i}`, `Answer ${i}`);
  }
  const context = store.context(session, 'Final question');
  assert.equal(context.length, 11);
  assert.equal(context[0].role, 'user');
  assert.equal(context.at(-1).content, 'Final question');
});
