import test from 'node:test';
import assert from 'node:assert/strict';
import { continuousIdleAt, createSecondaryMotion } from './avatar-motion.mjs';
import { createNativePoseController } from './avatar-pose.mjs';

test('continuous choreography stays bounded and moving beyond the old ten-second hold and twenty-second end', () => {
  let previous = continuousIdleAt(0), windowMovement = 0;
  for (let frame = 1; frame <= 3600; frame++) {
    const current = continuousIdleAt(frame / 60);
    assert.ok(Math.abs(current.ParamAngleX) <= 18);
    assert.ok(Math.abs(current.ParamAngleY) <= 10);
    assert.ok(Math.abs(current.ParamAngleZ) <= 6);
    assert.ok(Math.abs(current.ParamBodyAngleZ) <= 5);
    assert.ok(current.ParamBreath >= 0 && current.ParamBreath <= 1);
    windowMovement += Math.max(...Object.keys(current).map(id => Math.abs(current[id] - previous[id])));
    if (frame % 30 === 0) { assert.ok(windowMovement > .1, `motion stopped at ${frame / 60}s`); windowMovement = 0; }
    previous = current;
  }
});

test('physics stabilizes initial/resumed pose, bounds long deltas and clears all outputs for reduced motion', () => {
  const writes = [], calls = [];
  const motion = createSecondaryMotion({
    model: { setParameterValueById: (...args) => writes.push(args) },
    physics: { stabilization: () => calls.push('stabilize'), evaluate: (_, dt) => calls.push(dt) },
    outputIds: ['hair', 'scarf'],
  });
  motion.update(1000, false); motion.update(1016, false); motion.update(61016, false);
  assert.deepEqual(calls, ['stabilize', .016, .1]);
  motion.suspend(); motion.update(90000, false);
  assert.equal(calls.at(-1), 'stabilize');
  motion.update(90016, true);
  assert.deepEqual(writes, [['hair', 0], ['scarf', 0]]);
  motion.update(90032, false);
  assert.equal(calls.at(-1), 'stabilize');
});

test('V7 state changes and hidden-tab resume preserve motion and reserved parameter ownership', () => {
  const ids = ['ParamAngleX', 'ParamMouthForm', 'ParamEyeLOpen', 'ParamMouthOpenY', 'ParamHairFront'];
  const values = [0, 0, .75, .6, .1];
  let geometry;
  const model = {
    getParameterCount: () => ids.length,
    getParameterId: i => ({ getString: () => ids[i] }),
    getParameterMinimumValue: i => i === 0 ? -30 : -1,
    getParameterMaximumValue: i => i === 0 ? 30 : 1,
    getParameterValueByIndex: i => values[i],
    setParameterValueByIndex: (i, value) => { values[i] = value; },
    getDrawableCount: () => 1,
    getDrawableVertexPositions: () => geometry,
    update: () => { geometry = Float32Array.from(values); },
  };
  model.update();
  const hash = 'a'.repeat(64);
  const parameters = {
    ParamAngleX: { min: -30, max: 30, neutral: 0 },
    ParamMouthForm: { min: -1, max: 1, neutral: 0, speaking: .7, thoughtful: -.35 },
    ParamEyeLOpen: { min: 0, max: 1, neutral: 1 },
    ParamMouthOpenY: { min: 0, max: 1, neutral: 0 },
    ParamHairFront: { min: -1, max: 1, neutral: 0 },
  };
  const pose = createNativePoseController({ model, mocSHA256: hash, manifest: { version: 'noor-v7', nativePose: { verified: true, mocSHA256: hash, continuousIdle: true, parameters } } });
  assert.deepEqual(pose.parameterIds, ['ParamAngleX', 'ParamMouthForm']);
  pose.update(0, 'idle'); pose.update(100, 'idle'); pose.update(200, 'idle');
  const before = [...values];
  pose.update(200, 'thoughtful'); assert.deepEqual(values, before, 'no state-entry snap');
  pose.suspend(); pose.update(60200, 'thoughtful'); assert.deepEqual(values, before, 'no background catch-up');
  pose.update(60216, 'speaking'); assert.ok(Math.abs(values[1] - before[1]) < .15);
  assert.deepEqual(values.slice(2), [.75, .6, .1]);
  pose.update(60232, 'speaking', true); assert.deepEqual(values, [0, 0, .75, .6, .1]);
});
