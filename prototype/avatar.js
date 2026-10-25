import { createSecondaryMotion } from './avatar-motion.mjs';
// The same verified native Noor runtime is bundled in local and built output.
const wrap = document.querySelector('#noorWrap');
const canvas = document.querySelector('#noorCanvas');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const assetRoot = new URL('./live2d/noor-v7/', import.meta.url);
const capabilities = { blink: false, mouth: false, expressions: false, physics: false, idle: false };
let ready = false;
let error = null;
let state = 'welcoming';
let mouthOpen = 0;
let model;
let renderer;
let user;
let gl;
let framework;
let Matrix;
let eyeIds;
let mouthId;
let poseController;
let physics;
let secondaryMotion;
let frameId = 0;
let blinkStart = -1;
let nextBlink = 0;
const textures = [];
const clamp = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

window.noorAvatar = Object.freeze({
  get ready() { return ready; },
  get error() { return error; },
  get state() { return state; },
  get capabilities() { return { ...capabilities }; },
  // Read-only diagnostics; sampled by integration checks, never in the draw loop.
  get parameterValues() {
    if (!model || !framework) return {};
    const names = [...poseController?.parameterIds ?? [], 'ParamEyeLOpen', 'ParamEyeROpen', 'ParamMouthOpenY', 'ParamHairFront', 'ParamHairBack', 'ParamScarfSway'];
    return Object.fromEntries(names.map(name => [name, model.getParameterValueById(framework.getIdManager().getId(name))]));
  },
  get nativePose() {
    return {
      parameterIds: poseController?.parameterIds ?? [],
      rejected: poseController?.rejected ?? {},
      reason: poseController ? poseController.reason : 'Native pose rig is not active',
    };
  },
  setMouthOpen(value) { mouthOpen = clamp(value); },
  resetMouth() { mouthOpen = 0; },
  setState(value) {
    state = ['welcoming', 'thoughtful', 'listening', 'speaking', 'idle', 'error'].includes(value) ? value : 'idle';
    // State targets apply only to parameters verified against the native export.
    if (wrap) wrap.dataset.avatarState = state;
  },
});

function localAsset(name, base = assetRoot) {
  if (typeof name !== 'string' || name.startsWith('/') || name.split('/').includes('..')) throw new Error('Invalid avatar asset');
  const url = new URL(name, base);
  if (url.origin !== location.origin || !url.pathname.startsWith(assetRoot.pathname)) throw new Error('Avatar asset outside bundled runtime');
  return url;
}

async function bytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Avatar asset unavailable (${response.status})`);
  return response.arrayBuffer();
}

async function loadCore() {
  if (window.Live2DCubismCore) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = localAsset('core/live2dcubismcore.min.js');
    script.onload = resolve;
    script.onerror = () => reject(new Error('Cubism Core unavailable'));
    document.head.append(script);
  });
}

function snapshot() {
  return Array.from({ length: model.getDrawableCount() }, (_, i) => ({
    id: model.getDrawableId(i).getString(),
    vertices: Float32Array.from(model.getDrawableVertexPositions(i)),
    opacity: model.getDrawableOpacity(i),
  }));
}

// Display metadata may contain an unused mouth ID. Require actual isolated motion.
function hasNativeMouth() {
  if (!mouthId) return false;
  const original = model.getParameterValueById(mouthId);
  model.setParameterValueById(mouthId, 0);
  model.update();
  const closed = snapshot();
  model.setParameterValueById(mouthId, 1);
  model.update();
  const changed = snapshot().filter((part, i) => Math.abs(part.opacity - closed[i].opacity) > 1e-6 || part.vertices.some((value, j) => Math.abs(value - closed[i].vertices[j]) > 1e-6));
  model.setParameterValueById(mouthId, original);
  model.update();
  return changed.length > 0 && changed.every(part => part.id.startsWith('Mouth_'));
}

function resize() {
  const box = canvas.getBoundingClientRect();
  const ratio = Math.min(devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(box.width * ratio));
  const height = Math.max(1, Math.round(box.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function dropPose(reason) {
  try { poseController?.reset(); } catch { /* Optional poses must not disable blink or speech. */ }
  poseController = undefined;
  capabilities.expressions = false;
  capabilities.idle = false;
  if (reason) console.warn('[Noor avatar] Native poses disabled:', reason);
}

function fail(reason) {
  ready = false;
  error = reason instanceof Error ? reason.message : String(reason);
  capabilities.blink = false;
  capabilities.mouth = false;
  capabilities.physics = false;
  capabilities.idle = false;
  dropPose();
  mouthOpen = 0;
  cancelAnimationFrame(frameId);
  if (canvas) canvas.hidden = true;
  if (wrap) wrap.dataset.avatar = 'fallback';
  // The existing PNG and chat remain available if any runtime stage fails.
  console.warn('[Noor avatar] Static fallback:', error);
}

function draw(now) {
  resize();
  if (reducedMotion.matches) {
    blinkStart = -1;
    nextBlink = now + 3500;
  } else if (now >= nextBlink && blinkStart < 0) {
    blinkStart = now;
    nextBlink = now + 3500;
  }
  const elapsed = now - blinkStart;
  const smooth = value => value * value * (3 - 2 * value);
  let open = 1;
  if (blinkStart >= 0) {
    open = elapsed < 90 ? 1 - smooth(Math.min(1, elapsed / 90)) : elapsed < 145 ? 0 : smooth(Math.min(1, (elapsed - 145) / 125));
    if (elapsed >= 270) blinkStart = -1;
  }
  poseController?.update(now, state, reducedMotion.matches);
  for (const id of eyeIds) model.setParameterValueById(id, open);
  if (capabilities.mouth) model.setParameterValueById(mouthId, mouthOpen);
  secondaryMotion?.update(now, reducedMotion.matches);
  model.update();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const matrix = new Matrix();
  matrix.scale(canvas.height / canvas.width, 1);
  matrix.multiplyByMatrix(user.getModelMatrix());
  renderer.setMvpMatrix(matrix);
  renderer.setRenderState(null, [0, 0, canvas.width, canvas.height]);
  renderer.drawModel(localAsset('shaders/').pathname);
}

function frame(now) {
  try { if (!document.hidden) draw(now); } catch (reason) { fail(reason); return; }
  frameId = requestAnimationFrame(frame);
}

async function start() {
  if (!wrap || !canvas) return;
  wrap.dataset.avatar = 'loading';
  try {
    const manifest = JSON.parse(new TextDecoder().decode(await bytes(localAsset('manifest.json'))));
    if (manifest.version !== 'noor-v7') throw new Error('Approved runtime version unavailable');
    if (manifest.renderAdapter !== null) throw new Error('Only the verified native rig is supported');
    await loadCore();
    const [coreFramework, userModel, matrixModule, shaderModule] = await Promise.all([
      import('./live2d/noor-v7/framework/live2dcubismframework.js'),
      import('./live2d/noor-v7/framework/model/cubismusermodel.js'),
      import('./live2d/noor-v7/framework/math/cubismmatrix44.js'),
      import('./live2d/noor-v7/framework/rendering/cubismshader_webgl.js'),
    ]);
    framework = coreFramework.CubismFramework;
    Matrix = matrixModule.CubismMatrix44;
    const option = new coreFramework.Option();
    option.loggingLevel = coreFramework.LogLevel.LogLevel_Warning;
    option.logFunction = message => console.warn('[Cubism]', message);
    if (!framework.startUp(option)) throw new Error('Cubism startup failed');
    framework.initialize();
    gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true });
    if (!gl) throw new Error('WebGL unavailable');
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); fail(new Error('WebGL context lost')); });
    const modelUrl = localAsset(manifest.model);
    const setting = JSON.parse(new TextDecoder().decode(await bytes(modelUrl)));
    if (!setting.FileReferences?.Moc || !setting.FileReferences?.Textures?.length) throw new Error('Incomplete avatar export');
    user = new userModel.CubismUserModel();
    const mocBytes = await bytes(localAsset(setting.FileReferences.Moc, modelUrl));
    user.loadModel(mocBytes, true);
    model = user.getModel();
    if (!model) throw new Error('Noor model unavailable');
    user.createRenderer(canvas.width, canvas.height);
    renderer = user.getRenderer();
    renderer.startUp(gl);
    renderer.setIsPremultipliedAlpha(true);
    renderer.loadShaders(localAsset('shaders/').pathname);
    // Pinned R5 starts shader loading asynchronously and exposes no ready promise.
    // Retain the PNG until its shader completion flag is set; fail on a bounded wait.
    const shader = shaderModule.CubismShaderManager_WebGL.getInstance().getShader(gl);
    await new Promise((resolve, reject) => {
      const started = performance.now();
      const check = () => {
        if (shader._isShaderLoaded) return resolve();
        if (performance.now() - started > 10000) return reject(new Error('Avatar shader initialization timed out'));
        requestAnimationFrame(check);
      };
      check();
    });
    for (const [i, path] of setting.FileReferences.Textures.entries()) {
      const image = new Image();
      image.src = localAsset(path, modelUrl);
      await image.decode();
      const texture = gl.createTexture();
      if (!texture) throw new Error('Avatar texture unavailable');
      textures.push(texture);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      renderer.bindTexture(i, texture);
    }
    const ids = new Set(Array.from({ length: model.getParameterCount() }, (_, i) => model.getParameterId(i).getString()));
    if (!ids.has('ParamEyeLOpen') || !ids.has('ParamEyeROpen')) throw new Error('Native blink parameters unavailable');
    const id = name => framework.getIdManager().getId(name);
    eyeIds = [id('ParamEyeLOpen'), id('ParamEyeROpen')];
    for (const eye of eyeIds) model.setParameterValueById(eye, 1);
    mouthId = ids.has('ParamMouthOpenY') ? id('ParamMouthOpenY') : null;
    capabilities.mouth = manifest.mouthRigVerified === true && hasNativeMouth();
    if (manifest.version === 'noor-v7' && manifest.nativePose?.verified === true) {
      try {
        const digest = await crypto.subtle.digest('SHA-256', mocBytes);
        const mocSHA256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
        const { createNativePoseController } = await import('./avatar-pose.mjs');
        poseController = createNativePoseController({ model, manifest, mocSHA256 });
        capabilities.expressions = poseController.hasStateTargets;
        capabilities.idle = poseController.hasIdleMotion;
        if (poseController.reason || Object.keys(poseController.rejected).length) {
          console.warn('[Noor avatar] Native pose gate:', poseController.reason, poseController.rejected);
        }
      } catch (reason) {
        console.warn('[Noor avatar] Native poses unavailable:', reason);
      }
    }
    if (!capabilities.mouth || !capabilities.expressions || !capabilities.idle || poseController.reason || Object.keys(poseController.rejected).length) {
      throw new Error('Approved native model controls did not pass verification');
    }
    if (!setting.FileReferences.Physics || manifest.physics?.verified !== true) throw new Error('Approved physics unavailable');
    const physicsUrl = localAsset(setting.FileReferences.Physics, modelUrl);
    const expectedPath = physicsUrl.pathname.slice(assetRoot.pathname.length);
    if (manifest.physics.file !== expectedPath) throw new Error('Physics identity path mismatch');
    const physicsBytes = await bytes(physicsUrl);
    const physicsDigest = await crypto.subtle.digest('SHA-256', physicsBytes);
    const physicsHash = Array.from(new Uint8Array(physicsDigest), value => value.toString(16).padStart(2, '0')).join('');
    if (manifest.sha256[expectedPath] !== physicsHash) throw new Error('Physics integrity mismatch');
    const outputs = ['ParamHairFront', 'ParamHairBack', 'ParamScarfSway'];
    const physicsSetting = JSON.parse(new TextDecoder().decode(physicsBytes));
    const actualOutputs = physicsSetting.PhysicsSettings.flatMap(setting => setting.Output.map(output => output.Destination.Id));
    if (actualOutputs.length !== outputs.length || outputs.some(name => !ids.has(name) || !actualOutputs.includes(name))) throw new Error('Physics output ownership mismatch');
    const { CubismPhysics } = await import('./live2d/noor-v7/framework/physics/cubismphysics.js');
    physics = CubismPhysics.create(physicsBytes, physicsBytes.byteLength);
    if (!physics) throw new Error('Native physics initialization failed');
    secondaryMotion = createSecondaryMotion({ model, physics, outputIds: outputs.map(id) });
    capabilities.physics = true;
    user.getModelMatrix().setHeight(1.9);
    user.getModelMatrix().setPosition(0, 0);
    canvas.hidden = false;
    nextBlink = performance.now() + 3500;
    draw(performance.now());
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    if (gl.getError() !== gl.NO_ERROR || !pixels.some((value, index) => index % 4 === 3 && value > 0)) throw new Error('Avatar first frame did not render');
    ready = true;
    capabilities.blink = true;
    wrap.dataset.avatar = 'ready';
    wrap.dataset.avatarVersion = manifest.version;
    window.dispatchEvent(new CustomEvent('noor-avatar-ready', { detail: { version: manifest.version, capabilities: { ...capabilities } } }));
    frameId = requestAnimationFrame(frame);
  } catch (reason) { fail(reason); }
}

document.addEventListener('visibilitychange', () => {
  poseController?.suspend();
  secondaryMotion?.suspend();
  mouthOpen = 0;
  blinkStart = -1;
  nextBlink = performance.now() + 3500;
});
window.addEventListener('pagehide', event => {
  secondaryMotion?.suspend();
  if (event.persisted) poseController?.suspend();
  else dropPose();
  if (event.persisted) { mouthOpen = 0; return; }
  cancelAnimationFrame(frameId);
  mouthOpen = 0;
  for (const texture of textures) gl?.deleteTexture(texture);
  physics?.release();
  user?.release();
});
start();
