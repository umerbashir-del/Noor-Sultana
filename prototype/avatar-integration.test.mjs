import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const original = await readFile(new URL('./avatar.js', import.meta.url), 'utf8');

function harness({ version = 'noor-v5', createPose } = {}) {
  const events = {}, imports = [], writes = [], wrap = { dataset: {} };
  const gl = new Proxy({ NO_ERROR: 0, getError: () => 0, createTexture: () => ({}), readPixels: (...args) => { args.at(-1)[3] = 255; } }, { get: (target, name) => target[name] ?? (() => {}) });
  const canvas = { width: 400, height: 600, getBoundingClientRect: () => ({ width: 400, height: 600 }), getContext: () => gl, addEventListener() {} };
  const values = { ParamEyeLOpen: 1, ParamEyeROpen: 1, ParamMouthOpenY: 0 };
  const model = {
    getParameterCount: () => 3, getParameterId: i => ({ getString: () => Object.keys(values)[i] }),
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
  const modules = {
    './live2d-local/framework/live2dcubismframework.js': { CubismFramework: framework, Option: class {}, LogLevel: { LogLevel_Warning: 1 } },
    './live2d-local/framework/model/cubismusermodel.js': { CubismUserModel: User },
    './live2d-local/framework/math/cubismmatrix44.js': { CubismMatrix44: class { scale() {} multiplyByMatrix() {} } },
    './live2d-local/framework/rendering/cubismshader_webgl.js': { CubismShaderManager_WebGL: { getInstance: () => ({ getShader: () => ({ _isShaderLoaded: true }) }) } },
    './avatar-pose.mjs': { createNativePoseController: createPose ?? (() => { throw new Error('pose creation failed'); }) },
  };
  const manifest = { version, renderAdapter: null, mouthRigVerified: true, model: 'models/test.model3.json', nativePose: { verified: true } };
  const encode = object => new TextEncoder().encode(JSON.stringify(object)).buffer;
  const context = {
    URL, TextDecoder, Uint8Array, Float32Array, console: { warn() {} }, performance: { now: () => 0 },
    devicePixelRatio: 1, matchMedia: () => ({ matches: false }), requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    crypto: { subtle: { digest: async () => new Uint8Array(32).buffer } },
    Image: class { async decode() {} }, CustomEvent: class {},
    location: { hostname: '127.0.0.1', origin: 'http://127.0.0.1:4180' },
    document: { hidden: false, documentElement: { dataset: {} }, querySelector: selector => selector === '#noorWrap' ? wrap : canvas, addEventListener: (name, handler) => { events[name] = handler; } },
    window: { Live2DCubismCore: {}, dispatchEvent() {}, addEventListener: (name, handler) => { events[name] = handler; } },
    fetch: async url => ({ ok: true, arrayBuffer: async () => String(url).endsWith('manifest.json') ? encode(manifest) : String(url).endsWith('model3.json') ? encode({ FileReferences: { Moc: 'test.moc3', Textures: ['texture.png'] } }) : new ArrayBuffer(8) }),
    __import: async name => { imports.push(name); return modules[name]; },
  };
  vm.createContext(context);
  const source = original.replaceAll('import.meta.url', "'http://127.0.0.1:4180/avatar.js'").replace(/\bimport\(/g, '__import(').replace(/start\(\);\s*$/, '');
  vm.runInContext(source + '\nglobalThis.qa = {start, draw, frame, fail};', context);
  return { context, events, imports, writes, wrap, api: context.window.noorAvatar, qa: context.qa };
}

test('V5 actual loader path never imports optional pose module', async () => {
  const h = harness(); await h.qa.start();
  assert.equal(h.api.ready, true);
  assert.equal(h.api.capabilities.blink, true); assert.equal(h.api.capabilities.mouth, true);
  assert.equal(h.imports.includes('./avatar-pose.mjs'), false);
});

test('pose creation error leaves actual renderer blink and mouth running', async () => {
  const h = harness({ version: 'noor-v6' }); await h.qa.start();
  assert.equal(h.imports.includes('./avatar-pose.mjs'), true);
  h.api.setMouthOpen(0.7); h.qa.frame(1000);
  assert.equal(h.api.ready, true); assert.equal(h.api.capabilities.mouth, true);
  assert.ok(h.writes.some(([id, value]) => id === 'ParamMouthOpenY' && value === 0.7));
});

test('runtime pose update error drops only poses; main fail clears controller', async () => {
  let updates = 0, resets = 0;
  const h = harness({ version: 'noor-v6', createPose: () => ({ parameterIds: ['ParamAngleZ'], rejected: {}, hasStateTargets: true, update() { if (++updates > 1) throw new Error('native pose failure'); }, reset() { resets++; } }) });
  await h.qa.start(); h.api.setMouthOpen(0.6); h.qa.frame(1000);
  assert.equal(h.api.ready, true); assert.equal(h.api.capabilities.blink, true); assert.equal(h.api.capabilities.mouth, true);
  assert.equal(h.api.capabilities.expressions, false); assert.equal(h.api.nativePose.parameterIds.length, 0);
  assert.equal(resets, 1); assert.ok(h.writes.some(([id, v]) => id === 'ParamMouthOpenY' && v === 0.6));
  h.qa.fail(new Error('render failed')); assert.equal(h.api.ready, false); assert.equal(h.wrap.dataset.avatar, 'fallback');
});

test('visibility and cached page transitions suspend poses without resetting rendered values', async () => {
  let suspended = 0, resets = 0;
  const h = harness({ version: 'noor-v6', createPose: () => ({ parameterIds: ['ParamAngleZ'], rejected: {}, hasStateTargets: true, update() {}, suspend() { suspended++; }, reset() { resets++; } }) });
  await h.qa.start();
  h.events.visibilitychange(); h.events.pagehide({ persisted: true });
  assert.equal(suspended, 2); assert.equal(resets, 0); assert.equal(h.api.ready, true);
  h.qa.fail(new Error('render failed')); assert.equal(resets, 1); assert.equal(h.api.nativePose.parameterIds.length, 0);
});
