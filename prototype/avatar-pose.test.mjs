import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativePoseController } from './avatar-pose.mjs';

const hash = 'a'.repeat(64);
const head = { min: -5, max: 5, neutral: 0, thoughtful: -3, listening: 1, idleAmplitude: 0.2 };
function fixture({ keyCounts = [3, 0, 3, 2], badGeometry = false, staticGeometry = false } = {}) {
  const ids = ['ParamAngleZ', 'ParamBrowLY', 'ParamEyeLOpen', 'ParamMouthOpenY'];
  const values = [0.4, 0, 0.8, 0.7];
  let positions = new Float32Array(4), writes = 0;
  const model = {
    getParameterCount: () => ids.length,
    getParameterId: i => ({ getString: () => ids[i] }),
    getParameterMinimumValue: i => i === 0 ? -5 : 0,
    getParameterMaximumValue: i => i === 0 ? 5 : 1,
    getParameterValueByIndex: i => values[i],
    setParameterValueByIndex(i, value) { writes++; values[i] = value; },
    getModel: () => ({ parameters: { keyCounts } }),
    getDrawableCount: () => 1,
    getDrawableVertexPositions: () => positions,
    update() {
      positions = Float32Array.from([staticGeometry ? 0 : values[0], badGeometry && values[0] === 5 ? NaN : 1, values[2], values[3]]);
    },
  };
  model.update();
  return { model, values, get writes() { return writes; } };
}
const manifest = parameters => ({ version: 'noor-v6', nativePose: { verified: true, mocSHA256: hash, transitionMs: 400, idlePeriodMs: 7000, parameters } });
const controller = (f, m = manifest({ ParamAngleZ: head }), h = hash) => createNativePoseController({ model: f.model, manifest: m, mocSHA256: h });

test('V5, unverified rig and mismatched hash leave model untouched', () => {
  for (const m of [{ ...manifest({}), version: 'noor-v5' }, { nativePose: { verified: false } }, manifest({ ParamAngleZ: head })]) {
    const f = fixture(), c = controller(f, m, 'b'.repeat(64));
    assert.deepEqual(c.parameterIds, []);
    c.update(0, 'thoughtful');
    assert.equal(f.writes, 0);
    assert.ok(c.reason);
  }
});

test('partial native rig accepts head and rejects placeholders and reserved ownership', () => {
  const f = fixture(), before = [...f.values];
  const c = controller(f, manifest({ ParamAngleZ: head, ParamBrowLY: { min: 0, max: 1, neutral: 0 }, ParamEyeLOpen: { min: 0, max: 1, neutral: 1 }, ParamMouthOpenY: { min: 0, max: 1, neutral: 0 } }));
  assert.deepEqual(c.parameterIds, ['ParamAngleZ']);
  assert.match(c.rejected.ParamBrowLY, /no native keyforms/);
  assert.match(c.rejected.ParamEyeLOpen, /ownership/);
  assert.match(c.rejected.ParamMouthOpenY, /ownership/);
  assert.deepEqual(f.values, before, 'geometry probes restore all initial parameter values');
  assert.equal(c.hasStateTargets, true);
  assert.equal(c.hasIdleMotion, true);
});

test('metadata with key counts but no vertex movement stays inactive', () => {
  const f = fixture({ staticGeometry: true }), c = controller(f);
  assert.deepEqual(c.parameterIds, []);
  assert.match(c.rejected.ParamAngleZ, /no measured native vertex movement/);
});

test('nonfinite native endpoint rejects pose and restores original model values', () => {
  const f = fixture({ badGeometry: true }), before = [...f.values], c = controller(f);
  assert.deepEqual(c.parameterIds, []);
  assert.match(c.rejected.ParamAngleZ, /not finite/);
  assert.deepEqual(f.values, before);
});

test('state targets ease at start, midpoint and completion without eye or mouth writes', () => {
  const f = fixture(), c = controller(f);
  c.update(0, 'thoughtful'); assert.equal(f.values[0], 0);
  c.update(200, 'thoughtful'); assert.equal(f.values[0], -1.5);
  c.update(400, 'thoughtful'); assert.equal(f.values[0], -3);
  c.update(500, 'listening'); assert.equal(f.values[0], -3);
  c.update(900, 'listening'); assert.equal(f.values[0], 1);
  assert.deepEqual(f.values.slice(2), [0.8, 0.7]);
});

test('reduced motion neutralizes pose and idle while preserving speech mouth and blink', () => {
  const f = fixture(), c = controller(f);
  c.update(0, 'thoughtful'); c.update(400, 'thoughtful');
  c.update(500, 'thoughtful', true); assert.equal(f.values[0], 0);
  c.update(5000, 'idle', true); assert.equal(f.values[0], 0);
  assert.deepEqual(f.values.slice(2), [0.8, 0.7]);
  c.update(6000, 'thoughtful'); assert.equal(f.values[0], 0, 'resumed transition starts from neutral');
});

test('idle stays bounded and stops in active/error states; reset clears stale motion', () => {
  const f = fixture(), c = controller(f);
  c.update(0, 'idle');
  for (let t = 400; t < 20000; t += 71) { c.update(t, 'idle'); assert.ok(Math.abs(f.values[0]) <= 0.2); }
  c.update(20000, 'error'); c.update(20400, 'error'); assert.equal(f.values[0], 0);
  c.update(21000, 'idle'); c.update(23000, 'idle');
  c.reset(); assert.equal(f.values[0], 0);
  c.update(30000, 'idle'); assert.equal(f.values[0], 0);
});

test('invalid native targets, limits and unsupported IDs do not activate poses', () => {
  for (const value of [{ ...head, thoughtful: -6 }, { ...head, min: -6 }, { ...head, idleAmplitude: NaN }, { ...head, neutral: NaN }]) {
    const c = controller(fixture(), manifest({ ParamAngleZ: value }));
    assert.deepEqual(c.parameterIds, []);
    assert.match(c.rejected.ParamAngleZ, /invalid/);
  }
  const c = controller(fixture(), manifest({ ParamUnknown: head }));
  assert.deepEqual(c.parameterIds, []);
});

test('suspend preserves the last pose and resumes without a neutral frame', () => {
  const f = fixture(), c = controller(f);
  c.update(0, 'thoughtful'); c.update(400, 'thoughtful');
  assert.equal(f.values[0], -3);
  c.suspend(); assert.equal(f.values[0], -3);
  c.update(50000, 'thoughtful'); assert.equal(f.values[0], -3);
  c.update(50400, 'thoughtful'); assert.equal(f.values[0], -3);
  c.update(51000, 'idle'); c.update(53000, 'idle');
  const last = f.values[0]; c.suspend(); c.update(90000, 'idle');
  assert.equal(f.values[0], last);
});

test('rejection report safely retains a literal __proto__ key', () => {
  const parameters = JSON.parse('{"__proto__":{"min":0,"max":1,"neutral":0}}');
  const c = controller(fixture(), manifest(parameters));
  assert.equal(Object.hasOwn(c.rejected, '__proto__'), true);
  assert.equal(c.rejected.__proto__, 'Parameter is outside native pose ownership');
});

test('confirmed custom arm parameter follows native geometry gate and keeps independent mouth', () => {
  const f = fixture(), base = f.model;
  let arm = 0;
  const model = {
    ...base,
    getParameterCount: () => 5,
    getParameterId: i => i === 4 ? { getString: () => 'ParamArmLGesture' } : base.getParameterId(i),
    getParameterValueByIndex: i => i === 4 ? arm : base.getParameterValueByIndex(i),
    setParameterValueByIndex: (i, v) => i === 4 ? arm = v : base.setParameterValueByIndex(i, v),
    getModel: () => ({ parameters: { keyCounts: [3, 0, 3, 2, 2] } }),
    getDrawableVertexPositions: () => { const vertices = Float32Array.from(base.getDrawableVertexPositions()); vertices[0] += arm * 0.1; return vertices; },
  };
  const c = createNativePoseController({ model, mocSHA256: hash, manifest: manifest({ ParamArmLGesture: { min: 0, max: 1, neutral: 0, thoughtful: 0.6 } }) });
  assert.deepEqual(c.parameterIds, ['ParamArmLGesture']);
  c.update(0, 'thoughtful'); c.update(400, 'thoughtful');
  assert.equal(arm, 0.6); assert.deepEqual(f.values.slice(2), [0.8, 0.7]);
});

function speakingFixture(overrides = {}) {
  const parameters = {
    ParamAngleZ: { min: -30, max: 30, neutral: 0, speaking: 6, thoughtful: -12 },
    ParamBodyAngleZ: { min: -10, max: 10, neutral: 0, speaking: 3, thoughtful: -2 },
    ParamArmLGesture: { min: 0, max: 1, neutral: 0, speaking: 0.65 },
    ...overrides,
  };
  const ids = [...Object.keys(parameters), 'ParamEyeLOpen', 'ParamMouthOpenY'];
  const values = [...Object.values(parameters).map(p => p.neutral), 0.8, 0.7];
  let positions = Float32Array.from(values);
  const model = {
    getParameterCount: () => ids.length,
    getParameterId: i => ({ getString: () => ids[i] }),
    getParameterMinimumValue: i => parameters[ids[i]]?.min ?? 0,
    getParameterMaximumValue: i => parameters[ids[i]]?.max ?? 1,
    getParameterValueByIndex: i => values[i],
    setParameterValueByIndex: (i, v) => { values[i] = v; },
    getDrawableCount: () => 1,
    getDrawableVertexPositions: () => positions,
    update: () => { positions = Float32Array.from(values); },
    getModel: () => ({ parameters: { keyCounts: ids.map(() => 3) } }),
  };
  const c = createNativePoseController({ model, manifest: manifest(parameters), mocSHA256: hash });
  return { c, values };
}

test('speaking emphasis gestures are deterministic and bounded with settled body', () => {
  const a = speakingFixture(), b = speakingFixture();
  const samples = [[], [], []];
  a.c.update(0, 'speaking'); b.c.update(0, 'speaking');
  assert.deepEqual(a.values, [0, 0, 0, 0.8, 0.7], 'no jump on entry');
  for (let t = 400; t < 60000; t += 37) {
    a.c.update(t, 'speaking'); b.c.update(t, 'speaking');
    assert.deepEqual(a.values, b.values);
    for (let i = 0; i < 3; i++) samples[i].push(a.values[i]);
    assert.ok(a.values[0] >= -24 && a.values[0] <= 24);
    assert.equal(a.values[1], 3, 'body holds its speaking target');
    assert.ok(a.values[2] >= 0.1 && a.values[2] <= 0.95);
    assert.deepEqual(a.values.slice(3), [0.8, 0.7], 'blink and audio mouth stay independent');
  }
  assert.ok(Math.max(...samples[0]) - Math.min(...samples[0]) > 47);
  assert.ok(Math.max(...samples[2]) - Math.min(...samples[2]) > 0.84);
});

test('gestures hold at emphasis and rest instead of continually wobbling', () => {
  const { c, values } = speakingFixture();
  c.update(0, 'speaking');
  c.update(600, 'speaking'); const peak = [...values];
  c.update(1200, 'speaking'); assert.deepEqual(values, peak);
  assert.equal(values[0], 24); assert.equal(values[2], 0.95);
  c.update(2200, 'speaking'); const rest = [...values];
  c.update(3600, 'speaking'); assert.deepEqual(values, rest);
  assert.equal(values[0], 0); assert.equal(values[2], 0.1);
  c.update(6100, 'speaking'); const longRest = [...values];
  c.update(10700, 'speaking'); assert.deepEqual(values, longRest);
  c.update(11400, 'speaking'); assert.equal(values[0], -24, 'next phrase alternates tilt');
});

test('short streaming speech entries alternate gestures without a pose jump', () => {
  const { c, values } = speakingFixture();
  c.update(0, 'speaking'); c.update(600, 'speaking');
  assert.equal(values[0], 24);
  const prior = [...values]; c.update(601, 'idle');
  assert.deepEqual(values, prior);
  c.update(1001, 'idle'); c.update(1200, 'speaking');
  assert.deepEqual(values, [0, 0, 0, 0.8, 0.7]);
  c.update(1800, 'speaking'); assert.equal(values[0], -24);
  c.update(1801, 'idle'); c.update(2201, 'idle');
  c.update(2400, 'speaking'); c.update(3000, 'speaking'); assert.equal(values[0], 24);
});

test('idle upper body remains still even when old manifest requests body sway', () => {
  const { c, values } = speakingFixture({ ParamBodyAngleZ: { min: -10, max: 10, neutral: 0, idleAmplitude: 1.2 } });
  c.update(0, 'idle');
  for (let t = 400; t < 20000; t += 71) { c.update(t, 'idle'); assert.equal(values[1], 0); }
});

test('speaking movement fades in, leaves a continuous distinct thoughtful pose and resets on Stop', () => {
  const { c, values } = speakingFixture();
  c.update(0, 'speaking'); c.update(1, 'speaking');
  assert.ok(Math.abs(values[0]) < 0.001);
  assert.ok(Math.abs(values[2]) < 0.001);
  c.update(800, 'speaking');
  const speaking = [...values];
  c.update(801, 'thoughtful');
  assert.deepEqual(values, speaking, 'transition starts at the last rendered gesture');
  c.update(1201, 'thoughtful'); assert.ok(Math.abs(values[0] + 12) < 1e-12); assert.deepEqual(values.slice(1), [-2, 0, 0.8, 0.7]);
  c.update(9000, 'thoughtful'); assert.ok(Math.abs(values[0] + 12) < 1e-12); assert.deepEqual(values.slice(1), [-2, 0, 0.8, 0.7]);
  c.update(10000, 'speaking'); c.update(11000, 'speaking');
  c.update(11001, 'idle'); c.update(11401, 'idle');
  assert.deepEqual(values, [0, 0, 0, 0.8, 0.7], 'idle Stop target removes speaking movement');
  c.update(15000, 'idle'); assert.deepEqual(values, [0, 0, 0, 0.8, 0.7]);
});

test('reduced motion, reset, suspend and error cannot retain a speaking wave', () => {
  const { c, values } = speakingFixture();
  c.update(0, 'speaking'); c.update(800, 'speaking');
  const last = [...values];
  c.suspend(); c.update(50000, 'speaking'); assert.deepEqual(values, last);
  c.update(50800, 'speaking'); c.update(51000, 'speaking', true);
  assert.deepEqual(values, [0, 0, 0, 0.8, 0.7]);
  c.update(52000, 'speaking', true); assert.deepEqual(values, [0, 0, 0, 0.8, 0.7]);
  c.update(53000, 'speaking'); assert.deepEqual(values, [0, 0, 0, 0.8, 0.7]);
  c.update(53800, 'speaking'); c.update(54000, 'error'); c.update(54400, 'error');
  assert.deepEqual(values, [0, 0, 0, 0.8, 0.7]);
  c.update(60000, 'error'); assert.deepEqual(values, [0, 0, 0, 0.8, 0.7]);
  c.update(61000, 'speaking'); c.update(62000, 'speaking'); c.reset();
  assert.deepEqual(values, [0, 0, 0, 0.8, 0.7]);
});

test('speaking gesture adapts to narrower verified ranges and does not animate unrelated parameters', () => {
  const { c, values } = speakingFixture({
    ParamAngleZ: { min: -2, max: 2, neutral: 0, speaking: 1.9 },
    ParamBrowLAngle: { min: -1, max: 1, neutral: 0, speaking: 0.2 },
  });
  c.update(0, 'speaking');
  for (let t = 400; t < 10000; t += 43) {
    c.update(t, 'speaking');
    assert.ok(values[0] >= -1.6 && values[0] <= 1.6);
    assert.equal(values[3], 0.2, 'brow keeps its state target instead of oscillating');
  }
});
