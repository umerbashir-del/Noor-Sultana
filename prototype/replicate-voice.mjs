import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { browserCompatibleWav } from '../lib/voice-wav.mjs';

const api = 'https://api.replicate.com/v1/';
const whisperVersion = '8099696689d249cf8b122d833c36ac3f75505c666a395ca40ef26f68e7d3d16e';
const maxAudioBytes = 5_000_000;

// Local transport only. Sessions, quotas and reply authorization stay in server.mjs.
// No Python, provider URL supplied by a client, or provider response body in logs.
export function createReplicateVoice({ token, fetchImpl = fetch, pollMs = 750,
  reference = () => readFile(new URL('./voice/noor-reference.wav', import.meta.url)) } = {}) {
  let referencePromise;
  async function request(path, options = {}, signal) {
    const response = await fetchImpl(api + path, {
      ...options, redirect: 'error',
      headers: { authorization: `Bearer ${token}`, ...options.headers },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Replicate request failed (HTTP ${response.status}).`);
    return response.json();
  }

  async function predict(path, payload, callerSignal) {
    if (!token) throw new Error('Replicate is not configured.');
    const signal = callerSignal ? AbortSignal.any([callerSignal, AbortSignal.timeout(50_000)]) : AbortSignal.timeout(50_000);
    signal.throwIfAborted();
    let id, running = false;
    try {
      // Finish this bounded create even if the caller cancels, so its returned
      // ID can be cancelled. cancel-after also bounds uncertain create outcomes.
      let prediction = await request(path, {
        method: 'POST', headers: { 'content-type': 'application/json', 'cancel-after': '60s' },
        body: JSON.stringify(payload),
      });
      if (typeof prediction.id === 'string' && /^[a-z0-9]+$/.test(prediction.id)) id = prediction.id;
      running = ['starting', 'processing'].includes(prediction.status);
      signal.throwIfAborted();
      while (running) {
        if (!id) throw new Error('Replicate returned an invalid prediction ID.');
        await delay(pollMs, undefined, { signal });
        prediction = await request(`predictions/${id}`, {}, signal);
        running = ['starting', 'processing'].includes(prediction.status);
        signal.throwIfAborted();
      }
      if (prediction.status !== 'succeeded') throw new Error('Replicate prediction did not succeed.');
      return prediction.output;
    } finally {
      if (id && running) {
        try { await request(`predictions/${id}/cancel`, { method: 'POST' }, AbortSignal.timeout(2000)); }
        catch { console.error('[Replicate] Prediction cancellation was not confirmed.'); }
      }
    }
  }

  return {
    available: Boolean(token),
    async speak(text, signal) {
      signal?.throwIfAborted();
      referencePromise ||= Promise.resolve().then(reference).catch(error => { referencePromise = undefined; throw error; });
      const audio = await referencePromise;
      const output = await predict('models/resemble-ai/chatterbox-turbo/predictions', {
        input: { text, reference_audio: `data:audio/wav;base64,${audio.toString('base64')}` },
      }, signal);
      const url = new URL(output);
      if (typeof output !== 'string' || url.protocol !== 'https:' || url.username || url.password || url.port
        || !(url.hostname === 'replicate.delivery' || url.hostname.endsWith('.replicate.delivery'))) {
        throw new Error('Replicate returned an unexpected audio URL.');
      }
      const downloadSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
      const response = await fetchImpl(url, { redirect: 'error', signal: downloadSignal });
      if (!response.ok || Number(response.headers.get('content-length')) > maxAudioBytes) throw new Error('Replicate audio is unavailable or too large.');
      const chunks = []; let size = 0;
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > maxAudioBytes) throw new Error('Replicate audio is too large.');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      const bytes = Buffer.concat(chunks);
      return Buffer.from(browserCompatibleWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
    },
    async transcribe(audio, mime, signal) {
      const output = await predict('predictions', { version: whisperVersion,
        input: { audio: `data:${mime};base64,${audio.toString('base64')}`, transcription: 'plain text', translate: false },
      }, signal);
      const text = output?.transcription;
      if (typeof text !== 'string' || !text.trim()) throw new Error('No clear speech detected.');
      return text.trim().slice(0, 500);
    },
  };
}
