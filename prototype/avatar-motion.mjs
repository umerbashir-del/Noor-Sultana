// Same bounded choreography as the user-approved continuous preview.
// Time is supplied by the active-page clock; it never stops after one cycle.
export function continuousIdleAt(seconds) {
  const t = Math.max(0, seconds), tau = 2 * Math.PI;
  return {
    ParamAngleX: 18 * Math.sin(tau * t / 5) ** 3,
    ParamAngleY: 10 * Math.sin(tau * t / 10 + Math.PI / 3) ** 3,
    ParamAngleZ: 6 * Math.sin(tau * t / 10 + Math.PI / 7),
    ParamBodyAngleZ: 5 * Math.sin(tau * 3 * t / 20 + Math.PI / 4) ** 3,
    ParamBreath: .5 - .5 * Math.cos(tau * t / 4),
  };
}

// Physics owns only its declared secondary-motion outputs. The pose, blink
// and audio controllers write their inputs before this step, once per frame.
export function createSecondaryMotion({ model, physics, outputIds }) {
  let lastTime = null, stabilize = true;
  return {
    suspend() { lastTime = null; stabilize = true; },
    update(now, reducedMotion) {
      if (reducedMotion) {
        for (const id of outputIds) model.setParameterValueById(id, 0);
        lastTime = null;
        stabilize = true;
        return;
      }
      if (stabilize) {
        physics.stabilization(model);
        stabilize = false;
      } else {
        // Never replay a hidden-tab interval or a long main-thread stall.
        physics.evaluate(model, Math.min(.1, Math.max(0, (now - lastTime) / 1000)));
      }
      lastTime = now;
    },
  };
}
