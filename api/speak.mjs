import { browserCompatibleWav } from '../lib/voice-wav.mjs';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { segmentSpeech } from '../lib/speech-segments.mjs';
import { createSpeechCache } from '../lib/speech-cache.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { sessionIdFrom } from '../lib/vercel-session.mjs';
import { releaseStoredVoice, reserveStoredVoice, supabaseEnabled } from '../lib/supabase-store.mjs';
import { json, sameOrigin } from '../lib/vercel-shared.mjs';

const predictionEndpoint = 'https://api.replicate.com/v1/models/resemble-ai/chatterbox-turbo/predictions';
const maxAudioBytes = 5_000_000;
let hopeReferencePromise;
const speechCache = createSpeechCache();

class VoiceProviderRateLimit extends Error {
  constructor(retryAfterSeconds) {
    super('Voice provider rate limited this request');
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function retryAfterSeconds(header) {
  const numeric = Number(header);
  const seconds = header && Number.isFinite(numeric) ? numeric : (Date.parse(header) - Date.now()) / 1000;
  return Number.isFinite(seconds) ? Math.max(1, Math.min(300, Math.ceil(seconds))) : 30;
}

function hopeReference() {
  hopeReferencePromise ||= readFile(new URL('../prototype/voice/noor-reference.wav', import.meta.url))
    .then((audio) => `data:audio/wav;base64,${audio.toString('base64')}`)
    .catch((error) => { hopeReferencePromise = undefined; throw error; });
  return hopeReferencePromise;
}

export { browserCompatibleWav } from '../lib/voice-wav.mjs';

function available() {
  return process.env.NOOR_VOICE_ENABLED === 'true'
    && Boolean(process.env.REPLICATE_API_TOKEN)
    && supabaseEnabled();
}

async function predictionRequest(url, options = {}, signal) {
  const isCreate = url === predictionEndpoint && options.method === 'POST';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    signal?.throwIfAborted();
    const response = await fetch(url, {
      ...options,
      headers: { authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`, ...options.headers },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000),
    });
    if (response.status === 429) {
      const seconds = retryAfterSeconds(response.headers.get('retry-after'));
      if (isCreate && attempt === 0 && seconds <= 10) {
        await delay(seconds * 1000, undefined, { signal });
        continue;
      }
      throw new VoiceProviderRateLimit(seconds);
    }
    if (!response.ok) throw new Error(`Voice provider returned ${response.status}`);
    return response.json();
  }
}

export async function GET() {
  try { return json({ available: available() }); }
  catch { return json({ available: false }); }
}


function streamedSpeech(request, context, { text, sessionId, reservationId, startedAt }) {
  if (request.signal.aborted) return new Response(null, { status: 204 });
  const aborter = new AbortController();
  const signal = aborter.signal;
  let deadlineExpired = false;
  const expire = () => { deadlineExpired = true; aborter.abort(); };
  // Include request parsing and the full-reply reservation in the stream budget.
  const remainingMs = Math.max(0, 50_000 - (Date.now() - startedAt));
  const deadline = remainingMs > 0 ? setTimeout(expire, remainingMs) : undefined;
  deadline?.unref?.();
  if (!remainingMs) expire();
  const onAbort = () => aborter.abort();
  request.signal.addEventListener('abort', onAbort, { once: true });
  if (request.signal.aborted) onAbort();
  let predictionId, predictionRunning = false, stage = 'reference', delivered = 0, readerCancelled = false;
  const cancelled = new Set();
  let finishBackground;
  const background = new Promise(resolve => { finishBackground = resolve; });
  context?.waitUntil?.(background);
  async function cancelPrediction() {
    if (!predictionId || !predictionRunning || cancelled.has(predictionId)) return;
    cancelled.add(predictionId);
    const cleanup = new AbortController();
    let timeout;
    const bounded = new Promise(resolve => { timeout = setTimeout(() => { cleanup.abort(); resolve(); }, 2000); });
    try {
      await Promise.race([
        predictionRequest(`https://api.replicate.com/v1/predictions/${predictionId}/cancel`, { method: 'POST' }, cleanup.signal)
          .catch(() => { console.error('[Chatterbox] stream prediction cancellation failed'); }),
        bounded,
      ]);
    } finally { clearTimeout(timeout); }

  }
  async function generate(segment, referenceAudio) {
    predictionId = undefined; predictionRunning = false;
    signal.throwIfAborted();
    stage = 'prediction_create';
    let prediction = await predictionRequest(predictionEndpoint, {
      method: 'POST', headers: { 'content-type': 'application/json', 'cancel-after': '60s' },
      body: JSON.stringify({ input: { text: segment, reference_audio: referenceAudio } }),
    }, signal);
    if (typeof prediction.id === 'string' && /^[a-z0-9]+$/.test(prediction.id)) predictionId = prediction.id;
    predictionRunning = ['starting', 'processing'].includes(prediction.status);
    signal.throwIfAborted();
    stage = 'prediction_wait';
    for (let attempt = 0; attempt < 36 && !prediction.output && ['starting', 'processing'].includes(prediction.status); attempt++) {
      if (!predictionId) break;
      await delay(1500, undefined, { signal });
      prediction = await predictionRequest(`https://api.replicate.com/v1/predictions/${predictionId}`, {}, signal);
      predictionRunning = ['starting', 'processing'].includes(prediction.status);
    }
    signal.throwIfAborted();
    if (typeof prediction.output !== 'string') throw new Error('Voice prediction did not return audio');
    stage = 'audio_download';
    const audioUrl = new URL(prediction.output);
    if (audioUrl.protocol !== 'https:' || !(audioUrl.hostname === 'replicate.delivery' || audioUrl.hostname.endsWith('.replicate.delivery'))) throw new Error('Unexpected voice audio URL');
    const response = await fetch(audioUrl, { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
    if (!response.ok || Number(response.headers.get('content-length')) > maxAudioBytes) throw new Error('Voice audio unavailable');
    const audio = await response.arrayBuffer();
    signal.throwIfAborted();
    if (!audio.byteLength || audio.byteLength > maxAudioBytes) throw new Error('Invalid voice audio');
    stage = 'audio_decode';
    return new Uint8Array(browserCompatibleWav(audio));
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = value => { if (!readerCancelled && !signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(value) + '\n')); };
      try {
        const referenceAudio = await hopeReference();
        signal.throwIfAborted();
        const referenceSHA = createHash('sha256').update(Buffer.from(referenceAudio.slice(referenceAudio.indexOf(',') + 1), 'base64')).digest('hex');
        const identity = `replicate:resemble-ai/chatterbox-turbo:reference:${referenceSHA}`;
        const segments = segmentSpeech(text);
        for (const [index, segment] of segments.entries()) {
          signal.throwIfAborted();
          let audio = speechCache.get(identity, segment);
          if (!audio) {
            audio = await generate(segment, referenceAudio);
            signal.throwIfAborted();
            speechCache.set(identity, segment, audio);
          }
          signal.throwIfAborted();
          send({ index, audio: Buffer.from(audio).toString('base64') });
          delivered++;
        }
        send({ done: true });
      } catch (error) {
        if (!signal.aborted && error instanceof VoiceProviderRateLimit && stage === 'prediction_create' && delivered === 0) {
          // Keep the durable refund attempt, but do not hold the response beyond its budget.
          const refund = releaseStoredVoice(sessionId, reservationId)
            .catch(() => { console.error('[Chatterbox] stream reservation release failed'); });
          context?.waitUntil?.(refund);
          let stopWaiting;
          const aborted = new Promise(resolve => { stopWaiting = resolve; signal.addEventListener('abort', stopWaiting, { once: true }); });
          try { await Promise.race([refund, aborted]); }
          finally { signal.removeEventListener('abort', stopWaiting); }
        }
        if (signal.aborted) {
          await cancelPrediction();
          if (deadlineExpired && !readerCancelled && !request.signal.aborted) {
            controller.enqueue(encoder.encode(JSON.stringify({ error: 'Voice generation took too long. Please try again.' }) + '\n'));
          }
        } else {
          send({ error: error instanceof VoiceProviderRateLimit ? `Voice is temporarily busy. Please try again in about ${error.retryAfterSeconds} seconds.` : 'Chatterbox could not speak this reply. Please try again.' });
          console.warn('[Chatterbox] stream failed at', stage);
        }
      } finally {
        clearTimeout(deadline);
        request.signal.removeEventListener('abort', onAbort);
        if (!readerCancelled) controller.close();
        finishBackground();
      }
    },
    cancel() { readerCancelled = true; aborter.abort(); return background; },
  });
  return new Response(stream, { headers: {
    'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  } });
}

export async function POST(request, context) {
  const startedAt = Date.now();
  if (!sameOrigin(request)) return json({ error: 'Request origin is not allowed.' }, 403);
  if (!available()) return json({ error: 'Chatterbox voice is not connected yet.' }, 503);
  if (Number(request.headers.get('content-length')) > 2500) return json({ error: 'Voice request is too long.' }, 400);
  let body;
  try { body = await request.text(); } catch { return json({ error: 'Invalid voice request.' }, 400); }
  if (body.length > 2500) return json({ error: 'Voice request is too long.' }, 400);
  let text, stream;
  try { const parsed = JSON.parse(body); text = parsed.text; stream = parsed.stream === true; } catch { return json({ error: 'Invalid voice request.' }, 400); }
  if (typeof text !== 'string' || text.length < 1 || text.length > 500) {
    return json({ error: 'This reply is too long for the demo voice.' }, 400);
  }
  const sessionId = sessionIdFrom(request);
  if (!sessionId) return json({ error: 'Conversation expired. Please start a new one.' }, 401);
  const reservationId = randomUUID();
  let reserved;
  try { reserved = await reserveStoredVoice(sessionId, text, reservationId); }
  catch { return json({ error: 'Voice limit check is unavailable.' }, 503); }
  if (reserved === 'limit') return json({ error: 'The demo voice has reached its usage limit. Text chat still works.' }, 429);
  if (reserved !== 'ok') return json({ error: 'This reply is no longer available to speak.' }, 409);
  if (stream) return streamedSpeech(request, context, { text, sessionId, reservationId, startedAt });

  let predictionId;
  let predictionRunning = false;
  let stage = 'reference';
  let finishBackground;
  const background = new Promise((resolve) => { finishBackground = resolve; });
  context?.waitUntil?.(background);
  try {
    const referenceAudio = await hopeReference();
    if (request.signal.aborted) return new Response(null, { status: 204 });
    stage = 'prediction_create';
    let prediction = await predictionRequest(predictionEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cancel-after': '60s' },
      body: JSON.stringify({ input: { text, reference_audio: referenceAudio } }),
    }, request.signal);
    if (typeof prediction.id === 'string' && /^[a-z0-9]+$/.test(prediction.id)) predictionId = prediction.id;
    predictionRunning = ['starting', 'processing'].includes(prediction.status);
    if (request.signal.aborted) throw new Error('Voice request stopped.');
    stage = 'prediction_wait';
    for (let attempt = 0; attempt < 36 && !prediction.output && ['starting', 'processing'].includes(prediction.status); attempt += 1) {
      if (typeof prediction.id !== 'string' || !/^[a-z0-9]+$/.test(prediction.id)) break;
      await delay(1500, undefined, { signal: request.signal });
      prediction = await predictionRequest(`https://api.replicate.com/v1/predictions/${prediction.id}`, {}, request.signal);
      predictionRunning = ['starting', 'processing'].includes(prediction.status);
    }
    if (typeof prediction.output !== 'string') throw new Error(`Voice prediction ended as ${prediction.status || 'unknown'} without audio`);
    stage = 'audio_download';
    const audioUrl = new URL(prediction.output);
    if (audioUrl.protocol !== 'https:' || !(
      audioUrl.hostname === 'replicate.delivery' || audioUrl.hostname.endsWith('.replicate.delivery')
    )) {
      throw new Error('Unexpected voice audio URL');
    }
    const audioResponse = await fetch(audioUrl, {
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
    });
    if (!audioResponse.ok || Number(audioResponse.headers.get('content-length')) > maxAudioBytes) {
      throw new Error('Voice audio unavailable');
    }
    const audio = await audioResponse.arrayBuffer();
    if (!audio.byteLength || audio.byteLength > maxAudioBytes) throw new Error('Invalid voice audio');
    stage = 'audio_decode';
    return new Response(browserCompatibleWav(audio), { headers: {
      'content-type': 'audio/wav', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    } });
  } catch (error) {
    if (request.signal.aborted) {
      if (predictionId && predictionRunning) {
        const cancellation = predictionRequest(`https://api.replicate.com/v1/predictions/${predictionId}/cancel`, { method: 'POST' })
          .catch((cancelError) => { console.error('[Chatterbox] cancellation failed:', cancelError?.message); });
        await cancellation;
      }
      return new Response(null, { status: 204 });
    }
    if (error instanceof VoiceProviderRateLimit) {
      if (stage === 'prediction_create') {
        try { await releaseStoredVoice(sessionId, reservationId); }
        catch (releaseError) { console.error('[Chatterbox] voice reservation release failed:', releaseError?.message); }
      }
      console.warn('[Chatterbox]', stage, 'provider rate limited request', error.retryAfterSeconds);
      return json({ error: `Voice is temporarily busy. Please try again in about ${error.retryAfterSeconds} seconds.` },
        503, { 'retry-after': String(error.retryAfterSeconds) });
    }
    console.error('[Chatterbox]', stage, error?.message);
    return json({ error: 'Chatterbox could not speak this reply. Please try again.' }, 502);
  } finally {
    finishBackground();
  }
}
