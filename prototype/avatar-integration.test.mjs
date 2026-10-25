import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createSecondaryMotion } from './avatar-motion.mjs';
const original = await readFile(new URL('./avatar.js', import.meta.url), 'utf8');

function harness({ version = 'noor-v7', createPose, hosted = false, badPhysics = false } = {}) {
  const events = {}, imports = [], writes = [], wrap = { dataset: {} }, physicsCalls = [];
  const gl = new Proxy({ NO_ERROR: 0, getError: () => 0, createTexture: () => ({}), readPixels: (...args) => { args.at(-1)[3] = 255; } }, { get: (target, name) => target[name] ?? (() => {}) });
  const canvas = { width: 400, height: 600, getBoundingClientRect: () => ({ width: 400, height: 600 }), getContext: () => gl, addEventListener() {} };
  const values = { ParamEyeLOpen: 1, ParamEyeROpen: 1, ParamMouthOpenY: 0, ParamHairFront: 0, ParamHairBack: 0, ParamScarfSway: 0 };
  const model = {
    getParameterCount: () => Object.keys(values).length, getParameterId: i => ({ getString: () => Object.keys(values)[i] }),
    setParameterValueById: (id, value) => { writes.push([id, value]); values[id] = value; },
    getParameterValueById: id => values[id], update() {}, getDrawableCount: () => 1,
    getDrawableId: () => ({ getString: () => 'Mouth_Interior' }), getDrawableOpacity: () => 1,
    getDrawableVertexPositions: () => [values.ParamMouthOpenY, 0],
  };
  class User {
    loadModel(buffer, consistency) { assert.equal(buffer.byteLength, 8); assert.equal(consistency, true); }
    getModel() { return model; } createRenderer() {}
    getRenderer() { return new Proxy({}, { get: () => () => {} }); }
    getModelMatrix() { return { setHeight() {}, setPosition() {} }; }
    release() {}
  }
  const framework = { startUp: () => true, initialize() {}, getIdManager: () => ({ getId: id => id }) };
  const physics = { stabilization() { physicsCalls.push('stabilize'); }, evaluate() { physicsCalls.push('evaluate'); }, release() {} };
  const defaultPose = () => ({ parameterIds: ['ParamAngleZ'], rejected: {}, reason: null, hasStateTargets: true, hasIdleMotion: true, update() {}, suspend() {}, reset() {} });
  const modules = {
    './live2d/noor-v7/framework/live2dcubismframework.js': { CubismFramework: framework, Option: class {}, LogLevel: { LogLevel_Warning: 1 } },
    './live2d/noor-v7/framework/model/cubismusermodel.js': { CubismUserModel: User },
    './live2d/noor-v7/framework/math/cubismmatrix44.js': { CubismMatrix44: class { scale() {} multiplyByMatrix() {} } },
    './live2d/noor-v7/framework/rendering/cubismshader_webgl.js': { CubismShaderManager_WebGL: { getInstance: () => ({ getShader: () => ({ _isShaderLoaded: true }) }) } },
    './live2d/noor-v7/framework/physics/cubismphysics.js': { CubismPhysics: { create: () => physics } },
    './avatar-pose.mjs': { createNativePoseController: createPose ?? defaultPose },
  };
  const manifest = { version, renderAdapter: null, mouthRigVerified: true, model: 'models/test.model3.json', nativePose: { verified: true }, physics: { verified: true, file: 'models/test.physics3.json' }, sha256: { 'models/test.physics3.json': (badPhysics ? 'f' : '0').repeat(64) } };
  const encode = object => new TextEncoder().encode(JSON.stringify(object)).buffer;
  const context = {
    createSecondaryMotion, URL, TextDecoder, Uint8Array, Float32Array, console: { warn() {} }, performance: { now: () => 0 },
    devicePixelRatio: 1, matchMedia: () => ({ matches: false }), requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    crypto: { subtle: { digest: async () => new Uint8Array(32).buffer } },
    Image: class { async decode() {} }, CustomEvent: class {},
    location: { hostname: hosted ? 'noor.example' : '127.0.0.1', origin: hosted ? 'https://noor.example' : 'http://127.0.0.1:4180' },
    document: { hidden: false, querySelector: selector => selector === '#noorWrap' ? wrap : canvas, addEventListener: (name, handler) => { events[name] = handler; } },
    window: { Live2DCubismCore: {}, dispatchEvent() {}, addEventListener: (name, handler) => { events[name] = handler; } },
    fetch: async url => ({ ok: true, arrayBuffer: async () => String(url).endsWith('manifest.json') ? encode(manifest) : String(url).endsWith('model3.json') ? encode({ FileReferences: { Moc: 'test.moc3', Textures: ['texture.png'], Physics: 'test.physics3.json' } }) : String(url).endsWith('physics3.json') ? encode({ PhysicsSettings: Object.keys(values).filter(id => id.startsWith('ParamHair') || id === 'ParamScarfSway').map(id => ({ Output: [{ Destination: { Id: id } }] })) }) : new ArrayBuffer(8) }),
    __import: async name => { imports.push(name); return modules[name]; },
  };
  vm.createContext(context);
  const source = original.replace(/^import .*;\n/, '').replaceAll('import.meta.url', hosted ? "'https://noor.example/avatar.js'" : "'http://127.0.0.1:4180/avatar.js'").replace(/\bimport\(/g, '__import(').replace(/start\(\);\s*$/, '');
  vm.runInContext(source + '\nglobalThis.qa = {start, draw, frame, fail};', context);
  return { context, events, imports, writes, wrap, physicsCalls, api: context.window.noorAvatar, qa: context.qa };
}

test('loader rejects an unapproved runtime before importing controls', async () => {
  const h = harness({ version: 'noor-v5' }); await h.qa.start();
  assert.equal(h.api.ready, false); assert.equal(h.wrap.dataset.avatar, 'fallback');
  assert.equal(h.imports.length, 0);
});

test('local and hosted loader compose native blink, audio mouth, expressions and physics', async () => {
  for (const hosted of [false, true]) {
    const h = harness({ hosted }); await h.qa.start();
    assert.equal(h.api.ready, true);
    for (const capability of ['blink', 'mouth', 'expressions', 'physics', 'idle']) assert.equal(h.api.capabilities[capability], true);
    h.api.setMouthOpen(.8); h.qa.frame(1000);
    assert.ok(h.writes.some(([id, value]) => id === 'ParamMouthOpenY' && value === .8));
    assert.deepEqual(h.physicsCalls, ['stabilize', 'evaluate']);
  }
});

test('failed pose initialization or physics identity retains the static fallback', async () => {
  for (const options of [{ createPose: () => { throw Error('pose failure'); } }, { badPhysics: true }]) {
    const h = harness(options); await h.qa.start();
    assert.equal(h.api.ready, false); assert.equal(h.wrap.dataset.avatar, 'fallback');
    assert.equal(h.api.capabilities.physics, false);
  }
});

test('runtime pose failure returns to fallback rather than claiming the full approved model still works', async () => {
  let updates = 0, resets = 0;
  const h = harness({ createPose: () => ({ parameterIds: ['ParamAngleZ'], rejected: {}, hasStateTargets: true, hasIdleMotion: true, update() { if (++updates > 1) throw Error('pose failure'); }, reset() { resets++; } }) });
  await h.qa.start(); assert.equal(h.api.ready, true); h.qa.frame(1000);
  assert.equal(h.api.ready, false); assert.equal(h.wrap.dataset.avatar, 'fallback');
  assert.equal(h.api.capabilities.idle, false); assert.equal(resets, 1);
});

test('visibility and cached page recovery suspend pose and restabilize physics without resetting the source', async () => {
  let suspended = 0, resets = 0;
  const h = harness({ createPose: () => ({ parameterIds: ['ParamAngleZ'], rejected: {}, hasStateTargets: true, hasIdleMotion: true, update() {}, suspend() { suspended++; }, reset() { resets++; } }) });
  await h.qa.start(); h.events.visibilitychange(); h.events.pagehide({ persisted: true }); h.qa.frame(50000);
  assert.equal(suspended, 2); assert.equal(resets, 0); assert.equal(h.api.ready, true);
  assert.deepEqual(h.physicsCalls, ['stabilize', 'stabilize']);
  h.qa.fail(Error('render failed')); assert.equal(resets, 1);
});
