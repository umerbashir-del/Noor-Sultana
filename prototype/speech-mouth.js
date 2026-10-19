// Measure Noor's output audio only. This module never opens a microphone.
export function createSpeechMouth({
  getAvatar = () => window.noorAvatar,
  requestFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame = (id) => cancelAnimationFrame(id),
} = {}) {
  let active;
  let frame;
  let previousTime;
  let openness = 0;
  let mediaEpoch = 0;
  const mediaSources = new WeakMap();

  function stop() {
    mediaEpoch += 1;
    if (frame !== undefined) cancelFrame(frame);
    frame = undefined;
    if (active) {
      try { active.source.disconnect(active.analyser); } catch { /* Already disconnected. */ }
      active.analyser.disconnect();
    }
    active = undefined;
    previousTime = undefined;
    openness = 0;
    getAvatar()?.resetMouth();
  }

  function sample(time) {
    if (!active) return;
    if (active.context.state !== 'running') {
      stop();
      return;
    }
    active.analyser.getFloatTimeDomainData(active.samples);
    let energy = 0;
    for (const value of active.samples) energy += value * value;
    const rms = Math.sqrt(energy / active.samples.length);
    // Ignore the noise floor; compress speech levels into the rig's 0–1 range.
    const target = Number.isFinite(rms) ? Math.min(1, Math.max(0, (rms - 0.008) / 0.16)) : 0;
    const elapsed = previousTime === undefined ? 16 : Math.min(100, Math.max(0, time - previousTime));
    previousTime = time;
    const duration = target > openness ? 35 : 85;
    openness += (target - openness) * (1 - Math.exp(-elapsed / duration));
    if (openness < 0.001) openness = 0;
    getAvatar()?.setMouthOpen(openness);
    frame = requestFrame(sample);
  }

  function trackSource(source, context, owner = null) {
    stop();
    if (!source || context?.state !== 'running') return false;
    try {
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);
      active = { source, context, owner, analyser, samples: new Float32Array(analyser.fftSize) };
      frame = requestFrame(sample);
      return true;
    } catch {
      stop();
      return false;
    }
  }

  function watchMediaElement(element, getContext) {
    function stopMedia() {
      // Media cleanup is queued by the browser. It must not stop a newer buffer.
      mediaEpoch += 1;
      if (active?.owner === element) stop();
    }
    async function playing() {
      const epoch = ++mediaEpoch;
      const context = getContext();
      if (!context || context.state === 'closed') return;
      try {
        if (context.state !== 'running') await context.resume();
        if (epoch !== mediaEpoch || element.paused || element.ended || context.state !== 'running') return;
        let connection = mediaSources.get(element);
        if (!connection) {
          // A media element can have only one source node. Retain it for replays.
          const source = context.createMediaElementSource(element);
          source.connect(context.destination);
          connection = { source, context };
          mediaSources.set(element, connection);
        }
        trackSource(connection.source, connection.context, element);
      } catch {
        if (epoch === mediaEpoch) stopMedia();
        // A failed older media resume must not reset a newer buffer analyser.
      }
    }
    const events = ['pause', 'ended', 'waiting', 'error', 'emptied'];
    element.addEventListener('playing', playing);
    for (const event of events) element.addEventListener(event, stopMedia);
    return () => {
      element.removeEventListener('playing', playing);
      for (const event of events) element.removeEventListener(event, stopMedia);
      stopMedia();
    };
  }

  return { trackSource, watchMediaElement, stop };
}
