export class VoiceJobCancelled extends Error {
  constructor() {
    super('Voice job cancelled.');
    this.name = 'VoiceJobCancelled';
  }
}

export class VoiceQueueFull extends Error {
  constructor() {
    super('Voice is busy. Please try again shortly.');
    this.name = 'VoiceQueueFull';
  }
}

export function createVoiceJobQueue({ run, cancelActive, maxQueued = 8 }) {
  const queued = [];
  const bySession = new Map();
  let active;
  let draining = false;

  function cancel(job) {
    if (job.cancelled || (active !== job && !queued.includes(job))) return false;
    job.cancelled = true;
    if (bySession.get(job.sessionId) === job) bySession.delete(job.sessionId);
    if (active === job) {
      cancelActive();
    } else {
      queued.splice(queued.indexOf(job), 1);
      job.reject(new VoiceJobCancelled());
    }
    return true;
  }

  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (queued.length) {
        const job = queued.shift();
        active = job;
        try {
          const audio = await run(job.text);
          if (job.cancelled) throw new VoiceJobCancelled();
          job.resolve(audio);
        } catch (error) {
          job.reject(job.cancelled ? new VoiceJobCancelled() : error);
        } finally {
          if (bySession.get(job.sessionId) === job) bySession.delete(job.sessionId);
          active = undefined;
        }
      }
    } finally {
      draining = false;
      if (queued.length) void drain();
    }
  }

  return {
    submit(sessionId, text) {
      const previous = bySession.get(sessionId);
      if (previous) cancel(previous);
      if (queued.length >= maxQueued) throw new VoiceQueueFull();
      let resolve;
      let reject;
      const promise = new Promise((fulfill, fail) => {
        resolve = fulfill;
        reject = fail;
      });
      const job = { sessionId, text, resolve, reject, cancelled: false };
      bySession.set(sessionId, job);
      queued.push(job);
      void drain();
      return { promise, cancel: () => cancel(job) };
    },
    cancelSession(sessionId) {
      const job = bySession.get(sessionId);
      return job ? cancel(job) : false;
    },
  };
}
