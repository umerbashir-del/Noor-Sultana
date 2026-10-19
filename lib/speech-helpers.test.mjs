import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentSpeech } from './speech-segments.mjs';
import { createSpeechCache } from './speech-cache.mjs';

test('segments retain every word in order and never exceed three chunks', () => {
  const cases = ['', 'Hello.', 'Hello. How can I help?', 'This is a long sentence with words '.repeat(14), 'a'.repeat(500), 'First sentence.\n\nSecond sentence! Third sentence? Fourth.'];
  for (const text of cases) {
    const chunks = segmentSpeech(text);
    assert.ok(chunks.length <= 3);
    assert.equal(chunks.join(' ').replace(/\s+/gu, ' ').trim(), text.replace(/\s+/gu, ' ').trim());
    assert.ok(chunks.every(chunk => chunk.length > 0));
  }
  assert.equal(segmentSpeech('Ready. ' + 'More information '.repeat(20))[0], 'Ready.');
});

test('cache accepts exact fixed phrases only and isolates model/reference identity', () => {
  const cache = createSpeechCache(), audio = Uint8Array.of(1, 2);
  assert.equal(cache.set('model/refA', 'A private response about passenger Alice.', audio), false);
  assert.equal(cache.get('model/refA', 'A private response about passenger Alice.'), null);
  assert.equal(cache.set('model/refA', 'Hello.', audio), true);
  assert.equal(cache.get('model/refB', 'Hello.'), null);
  assert.equal(cache.get('other-model/refA', 'Hello.'), null);
  audio[0] = 9;
  const read = cache.get('model/refA', 'Hello.'); assert.equal(read[0], 1);
  read[0] = 8; assert.equal(cache.get('model/refA', 'Hello.')[0], 1);
  assert.equal(cache.set('', 'Hello.', audio), false);
});

test('cache enforces TTL and byte bounds with oldest-entry eviction', () => {
  let now = 0;
  const cache = createSpeechCache({ ttlMs: 100, maxBytes: 4, now: () => now });
  assert.equal(cache.set('a', 'Hello.', Uint8Array.of(1, 2, 3)), true);
  assert.equal(cache.set('b', 'Hello.', Uint8Array.of(4, 5)), true);
  assert.equal(cache.get('a', 'Hello.'), null);
  assert.equal(cache.set('c', 'Hello.', new Uint8Array(5)), false);
  now = 100; assert.equal(cache.get('b', 'Hello.'), null);
});
