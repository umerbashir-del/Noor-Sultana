import test from 'node:test';
import assert from 'node:assert/strict';
import { createMouthCueTimeline, sampleMouthCue } from './mouth-cues.mjs';

const fixture = () => ({ duration: 2, cues: [
  { start: 0, end: 0.2, value: 'X' },
  { start: 0.2, end: 0.5, value: 'A' },
  { start: 0.5, end: 0.9, value: 'D' },
  { start: 1.2, end: 1.8, value: 'F' },
] });

test('samples the supplied audio time with inclusive starts and exclusive ends', () => {
  const timeline = createMouthCueTimeline(fixture());
  for (const [time, shape] of [[0, 'X'], [0.199, 'X'], [0.2, 'A'], [0.499, 'A'], [0.5, 'D'], [0.899, 'D'], [1.2, 'F']]) {
    assert.equal(sampleMouthCue(timeline, time), shape, `playhead ${time}`);
  }
});

test('rests during gaps, silence, audio end and invalid playback times', () => {
  const timeline = createMouthCueTimeline(fixture());
  for (const time of [-1, NaN, Infinity, -Infinity, '0.5', 0.9, 1.1, 1.8, 2, 3]) {
    assert.equal(sampleMouthCue(timeline, time), 'X');
  }
  assert.equal(sampleMouthCue(createMouthCueTimeline({ duration: 2, cues: [] }), 1), 'X');
});

test('seeks and pauses use the audio playhead without stale cursor state', () => {
  const timeline = createMouthCueTimeline(fixture());
  assert.deepEqual([1.4, 0.3, 0.3, 0.7, 0, 2, 0.7].map(time => sampleMouthCue(timeline, time)), ['F', 'A', 'A', 'D', 'X', 'X', 'D']);
  const replacement = createMouthCueTimeline({ duration: 2, cues: [{ start: 0, end: 2, value: 'B' }] });
  assert.equal(sampleMouthCue(replacement, 0.7), 'B');
  assert.equal(sampleMouthCue(timeline, 0.7), 'D');
});

test('copies and freezes validated data so late mutation cannot replace a cue', () => {
  const input = fixture();
  const timeline = createMouthCueTimeline(input);
  input.cues[2].value = 'E';
  input.cues.length = 0;
  assert.equal(sampleMouthCue(timeline, 0.7), 'D');
  assert(Object.isFrozen(timeline));
  assert(Object.isFrozen(timeline.cues));
  assert(Object.isFrozen(timeline.cues[0]));
});

test('accepts only supported basic shapes and relaxed closed X', () => {
  for (const value of ['A', 'B', 'C', 'D', 'E', 'F', 'X']) {
    assert.equal(sampleMouthCue(createMouthCueTimeline({ duration: 1, cues: [{ start: 0, end: 1, value }] }), 0.5), value);
  }
  for (const value of ['G', 'H', 'a', '', 'AA', null, {}, 1]) {
    assert.throws(() => createMouthCueTimeline({ duration: 1, cues: [{ start: 0, end: 1, value }] }), TypeError);
  }
});

test('rejects malformed intervals, overlap, reversed order and audio overrun', () => {
  for (const cue of [null, [], {}, { start: 0, end: 1 },
    { start: -1, end: 1, value: 'A' }, { start: 1, end: 1, value: 'A' },
    { start: 1, end: 0, value: 'A' }, { start: 0, end: 3, value: 'A' },
    { start: NaN, end: 1, value: 'A' }, { start: 0, end: Infinity, value: 'A' },
    { start: '0', end: 1, value: 'A' }, { start: 0, end: 1, value: 'A', extra: 'unexpected' }]) {
    assert.throws(() => createMouthCueTimeline({ duration: 2, cues: [cue] }), TypeError);
  }
  for (const cues of [
    [{ start: 0, end: 1, value: 'A' }, { start: 0.9, end: 2, value: 'B' }],
    [{ start: 1, end: 2, value: 'B' }, { start: 0, end: 1, value: 'A' }],
  ]) assert.throws(() => createMouthCueTimeline({ duration: 2, cues }), TypeError);
});

test('bounds duration and cue count before sampling untrusted timing data', () => {
  for (const duration of [undefined, null, '2', 0, -1, NaN, Infinity, 120.01]) {
    assert.throws(() => createMouthCueTimeline({ duration, cues: [] }), TypeError);
  }
  for (const cues of [undefined, null, {}, 'large', Array(2001).fill({ start: 0, end: 1, value: 'A' })]) {
    assert.throws(() => createMouthCueTimeline({ duration: 2, cues }), TypeError);
  }
  assert.equal(createMouthCueTimeline({ duration: 120, cues: [] }).duration, 120);
  assert.throws(() => sampleMouthCue({ duration: 1, cues: [] }, 0), TypeError);
  assert.throws(() => sampleMouthCue(null, 0), TypeError);
});
