// Pure timing data for a future verified native mouth-shape rig. This module
// neither enables that rig nor derives timing from text or a wall clock.
const shapes = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'X']);
const timelines = new WeakSet();
const MAX_DURATION_SECONDS = 120;
const MAX_CUES = 2000;

export function createMouthCueTimeline({ duration, cues } = {}) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION_SECONDS) {
    throw new TypeError('Invalid mouth-cue duration.');
  }
  if (!Array.isArray(cues) || cues.length > MAX_CUES) {
    throw new TypeError('Invalid mouth-cue list.');
  }
  let previousEnd = 0;
  const validated = [];
  for (const cue of cues) {
    if (!cue || typeof cue !== 'object' || Array.isArray(cue)
      || Object.keys(cue).length !== 3
      || !Object.hasOwn(cue, 'start') || !Object.hasOwn(cue, 'end') || !Object.hasOwn(cue, 'value')
      || !Number.isFinite(cue.start) || !Number.isFinite(cue.end)
      || cue.start < previousEnd || cue.end <= cue.start || cue.end > duration
      || !shapes.has(cue.value)) {
      throw new TypeError('Invalid mouth cue.');
    }
    validated.push(Object.freeze({ start: cue.start, end: cue.end, value: cue.value }));
    previousEnd = cue.end;
  }
  const timeline = Object.freeze({ duration, cues: Object.freeze(validated) });
  timelines.add(timeline);
  return timeline;
}

// Callers supply their audio playback time in seconds. Sampling has no state,
// so a pause, seek or replacement segment cannot advance or revive old cues.
// Interpolation belongs to the verified rig; no parameter targets are invented.
export function sampleMouthCue(timeline, playheadSeconds) {
  if (!timelines.has(timeline)) throw new TypeError('Unvalidated mouth-cue timeline.');
  if (!Number.isFinite(playheadSeconds) || playheadSeconds < 0 || playheadSeconds >= timeline.duration) return 'X';
  const { cues } = timeline;
  let low = 0;
  let high = cues.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (cues[middle].end <= playheadSeconds) low = middle + 1;
    else high = middle;
  }
  const cue = cues[low];
  return cue && cue.start <= playheadSeconds ? cue.value : 'X';
}
