import { continuousIdleAt } from './avatar-motion.mjs';
// State targets drive verified native Cubism keyforms; this module never edits vertices.
const states = ['welcoming', 'thoughtful', 'listening', 'speaking', 'idle', 'error'];
const allowed = new Set([
  'ParamAngleX', 'ParamAngleY', 'ParamAngleZ',
  'ParamBrowLY', 'ParamBrowRY', 'ParamBrowLX', 'ParamBrowRX',
  'ParamBrowLAngle', 'ParamBrowRAngle', 'ParamBrowLForm', 'ParamBrowRForm',
  'ParamEyeBallX', 'ParamEyeBallY',
  'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ', 'ParamBreath',
  'ParamArmLGesture',
  'ParamEyeLSmile', 'ParamEyeRSmile', 'ParamMouthForm',
]);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smooth = value => value * value * (3 - 2 * value);
const tolerance = 1e-6;

// Timed emphasis gestures use only existing geometry-verified head and arm
// keyforms. Hold intervals let Noor settle instead of rocking continuously.
// These are presentation gestures, not word- or phoneme-aligned movements.
const gestureDurationMs = 10800;
const gestureFrames = [
  [0, 0, 0.1], [550, 1, 0.95], [1250, 1, 0.95],
  [2000, 0, 0.1], [3700, 0, 0.1],
  [4400, -0.75, 0.72], [5050, -0.75, 0.72],
  [5850, 0, 0.1], [gestureDurationMs, 0, 0.1],
];

function speakingTarget(entry, elapsed, speakingEntry) {
  if (entry.id !== 'ParamAngleZ' && entry.id !== 'ParamArmLGesture') return entry.targets.speaking;
  const cycle = Math.floor(elapsed / gestureDurationMs);
  const time = elapsed % gestureDurationMs;
  const end = gestureFrames.findIndex(frame => frame[0] > time);
  const before = gestureFrames[end - 1], after = gestureFrames[end];
  const amount = smooth((time - before[0]) / (after[0] - before[0]));
  if (entry.id === 'ParamArmLGesture') {
    const position = before[2] + (after[2] - before[2]) * amount;
    return entry.min + (entry.max - entry.min) * position;
  }
  const direction = (speakingEntry + cycle) % 2 === 0 ? 1 : -1;
  const accent = (before[1] + (after[1] - before[1]) * amount) * direction;
  // Standard V6 endpoints produce +24/-18 parameter units (4/-3 degrees).
  // Scale within each verified side of neutral for narrower future keyforms.
  return entry.neutral + accent * 0.8 * (accent >= 0 ? entry.max - entry.neutral : entry.neutral - entry.min);
}

function vertices(model) {
  return Array.from({ length: model.getDrawableCount() }, (_, i) => Float32Array.from(model.getDrawableVertexPositions(i)));
}

function geometryChanges(model, baseline) {
  let moved = false;
  for (let i = 0; i < model.getDrawableCount(); i++) {
    const current = model.getDrawableVertexPositions(i), before = baseline[i];
    if (current.length !== before.length) throw new Error('Native geometry topology changed');
    for (let j = 0; j < current.length; j++) {
      if (!Number.isFinite(current[j]) || !Number.isFinite(before[j])) throw new Error('Native geometry is not finite');
      if (Math.abs(current[j] - before[j]) > tolerance) moved = true;
    }
  }
  return moved;
}

function settings(value, model, index) {
  const { min, max, neutral } = value ?? {};
  if (![min, max, neutral].every(Number.isFinite) || min >= max || neutral < min || neutral > max) return null;
  if (min < model.getParameterMinimumValue(index) || max > model.getParameterMaximumValue(index)) return null;
  const targets = {};
  for (const state of states) {
    const target = value[state] ?? neutral;
    if (!Number.isFinite(target) || target < min || target > max) return null;
    targets[state] = target;
  }
  const idleAmplitude = value.idleAmplitude ?? 0;
  if (!Number.isFinite(idleAmplitude) || idleAmplitude < 0 || idleAmplitude > (max - min) / 4) return null;
  return { min, max, neutral, targets, idleAmplitude };
}

export function createNativePoseController({ model, manifest, mocSHA256 }) {
  const configuration = manifest?.nativePose;
  const rejected = Object.create(null);
  const entries = [];
  let reason = null;
  if (!['noor-v6', 'noor-v7'].includes(manifest?.version) || configuration?.verified !== true) reason = 'Native pose rig is not verified';
  else if (!/^[a-f0-9]{64}$/.test(configuration.mocSHA256 ?? '') || configuration.mocSHA256 !== mocSHA256) reason = 'Verified pose identity does not match the loaded moc';
  else if (!configuration.parameters || typeof configuration.parameters !== 'object' || Array.isArray(configuration.parameters)) reason = 'Verified pose parameter settings are missing';
  if (!reason) {
    const ids = new Map(Array.from({ length: model.getParameterCount() }, (_, i) => [model.getParameterId(i).getString(), i]));
    for (const [id, value] of Object.entries(configuration.parameters)) {
      const index = ids.get(id);
      if (!allowed.has(id)) { rejected[id] = 'Parameter is outside native pose ownership'; continue; }
      if (index === undefined) { rejected[id] = 'Parameter is absent from the native model'; continue; }
      const config = settings(value, model, index);
      if (!config) { rejected[id] = 'Parameter targets or limits are invalid'; continue; }
      const keyCounts = model.getModel?.()?.parameters?.keyCounts;
      if (keyCounts && keyCounts[index] === 0) { rejected[id] = 'Parameter has no native keyforms'; continue; }
      entries.push({ id, index, ...config });
    }
    const original = entries.map(entry => model.getParameterValueByIndex(entry.index));
    try {
      for (const entry of entries) model.setParameterValueByIndex(entry.index, entry.neutral);
      model.update();
      const baseline = vertices(model);
      for (const entry of entries) {
        let moved = false;
        try {
          for (const value of [entry.min, entry.max]) {
            model.setParameterValueByIndex(entry.index, value);
            model.update();
            const changed = geometryChanges(model, baseline);
            moved = moved || changed;
          }
          if (!moved) rejected[entry.id] = 'Parameter has no measured native vertex movement';
        } catch (error) {
          rejected[entry.id] = error.message;
        } finally {
          model.setParameterValueByIndex(entry.index, entry.neutral);
          model.update();
        }
      }
    } finally {
      entries.forEach((entry, i) => model.setParameterValueByIndex(entry.index, original[i]));
      model.update();
    }
  }
  const verified = entries.filter(entry => !rejected[entry.id]);
  const transitionMs = Number.isFinite(configuration?.transitionMs) ? clamp(configuration.transitionMs, 100, 2000) : 400;
  const idlePeriodMs = Number.isFinite(configuration?.idlePeriodMs) ? clamp(configuration.idlePeriodMs, 4000, 20000) : 7000;
  const values = new Map(verified.map(entry => [entry.id, entry.neutral]));
  let state = null;
  let stateStart = null;
  let idleStart = null;
  let starts = new Map(values);
  let speakingEntry = -1;
  let suspendedState = null;
  const continuous = manifest?.version === 'noor-v7' && configuration?.continuousIdle === true;
  let activeTime = 0, lastTime = null;
  let stateOffsets = new Map(verified.map(entry => [entry.id, entry.neutral]));

  function reset() {
    speakingEntry = -1;
    suspendedState = null;
    state = null;
    stateStart = null;
    idleStart = null;
    activeTime = 0;
    lastTime = null;
    stateOffsets = new Map(verified.map(entry => [entry.id, entry.neutral]));
    for (const entry of verified) {
      values.set(entry.id, entry.neutral);
      model.setParameterValueByIndex(entry.index, entry.neutral);
    }
    starts = new Map(values);
  }

  return {
    get parameterIds() { return verified.map(entry => entry.id); },
    get rejected() { return { ...rejected }; },
    get reason() { return reason; },
    get hasStateTargets() { return verified.some(entry => states.some(state => entry.targets[state] !== entry.neutral)); },
    get hasIdleMotion() { return continuous || verified.some(entry => entry.idleAmplitude > 0); },
    reset,
    suspend() {
      lastTime = null;
      // Keep the last rendered values; restart easing from them on the next frame.
      suspendedState = state;
      state = null;
      stateStart = null;
      idleStart = null;
    },
    update(now, nextState, reducedMotion = false) {
      if (!Number.isFinite(now)) return;
      if (reducedMotion) { reset(); return; }
      const canonical = states.includes(nextState) ? nextState : 'idle';
      if (continuous) {
        const delta = lastTime === null ? 0 : clamp(now - lastTime, 0, 100);
        lastTime = now;
        activeTime += delta;
        const motion = continuousIdleAt(activeTime / 1000);
        const startup = smooth(clamp(activeTime / transitionMs, 0, 1));
        const blend = 1 - Math.exp(-delta / (transitionMs / 4));
        for (const entry of verified) {
          const before = stateOffsets.get(entry.id);
          const offset = before + (entry.targets[canonical] - before) * blend;
          stateOffsets.set(entry.id, offset);
          const value = clamp(offset + (motion[entry.id] ?? 0) * startup, entry.min, entry.max);
          values.set(entry.id, value);
          model.setParameterValueByIndex(entry.index, value);
        }
        return;
      }
      if (state !== canonical) {
        if (canonical === 'speaking' && suspendedState !== 'speaking') speakingEntry++;
        suspendedState = null;
        state = canonical;
        stateStart = now;
        idleStart = now;
        starts = new Map(values);
      }
      const amount = smooth(clamp((now - stateStart) / transitionMs, 0, 1));
      const idleEnabled = state === 'idle' || state === 'welcoming';
      for (const [i, entry] of verified.entries()) {
        const target = state === 'speaking' ? speakingTarget(entry, Math.max(0, now - stateStart), speakingEntry) : entry.targets[state];
        const pose = starts.get(entry.id) + (target - starts.get(entry.id)) * amount;
        // Upper-body rocking adds no gesture information; keep it settled.
        const idle = idleEnabled && entry.id !== 'ParamBodyAngleZ' ? Math.sin((now - idleStart) * 2 * Math.PI / idlePeriodMs + i * 1.7) * entry.idleAmplitude * amount : 0;
        const value = clamp(pose + idle, entry.min, entry.max);
        values.set(entry.id, value);
        model.setParameterValueByIndex(entry.index, value);
      }
    },
  };
}
