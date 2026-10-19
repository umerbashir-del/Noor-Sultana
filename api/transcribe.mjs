import { setTimeout as delay } from 'node:timers/promises';
import { sessionIdFrom } from '../lib/vercel-session.mjs';
import { supabaseEnabled, reserveStoredModelCall, settleStoredModelCall } from '../lib/supabase-store.mjs';
import { hostedClaudeLimits } from '../lib/hosted-budget.mjs';
import { json, sameOrigin } from '../lib/vercel-shared.mjs';

// Pinned Replicate Whisper API schema: https://replicate.com/openai/whisper/api
const version = '8099696689d249cf8b122d833c36ac3f75505c666a395ca40ef26f68e7d3d16e';
const endpoint = 'https://api.replicate.com/v1/predictions';
const maxBytes = 900000;
export function hostedTranscriptionLimits(env = process.env) {
  // Read configured limits outside the temporary presentation-day override.
  // New paid ASR calls keep their reviewed ceiling even when chat is unlimited.
  const configured = hostedClaudeLimits(env, 0);
  const caps = { visitorRequests: 30, globalRequests: 500, visitorTokens: 30000, globalTokens: 300000 };
  return Object.fromEntries(Object.entries(caps).map(([key, cap]) => [key, Math.min(cap, configured[key])]));
}
function available() {
  try { return Boolean(process.env.REPLICATE_API_TOKEN && supabaseEnabled()); }
  catch { return false; }
}
export function GET() { return json({ available: available(), provider: 'Replicate', maxRecordingSeconds: 30, maxBytes }); }

async function readAudio(request) {
  if (Number(request.headers.get('content-length')) > maxBytes) throw new Error('size');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('size');
  const inputSignal = AbortSignal.any([request.signal, AbortSignal.timeout(10000)]);
  const cancel = () => { void reader.cancel().catch(() => {}); };
  inputSignal.addEventListener('abort', cancel, { once: true });
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      inputSignal.throwIfAborted();
      const { value, done } = await reader.read();
      inputSignal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('size'); }
      chunks.push(Buffer.from(value));
    }
  } finally { inputSignal.removeEventListener('abort', cancel); reader.releaseLock(); }
  if (size < 1000) throw new Error('size');
  return Buffer.concat(chunks);
}

export async function POST(request) {
  if (!sameOrigin(request)) return json({ error: 'Request origin is not allowed.' }, 403);
  const startedAt = Date.now();
  const deadline = AbortSignal.timeout(40000);
  const signal = AbortSignal.any([request.signal, deadline]);
  const id = sessionIdFrom(request);
  if (!id) return json({ error: 'Your conversation has ended. Please start a new one.' }, 401);
  if (!available()) return json({ error: 'Microphone transcription is unavailable. Please type your question.' }, 503);
  const mime = request.headers.get('content-type')?.split(';')[0].toLowerCase();
  if (!['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav'].includes(mime)) return json({ error: 'Unsupported recording format.' }, 415);
  let audio;
  try { audio = await readAudio(request); }
  catch { return json({ error: 'Record a shorter question (up to 30 seconds and 900 KB).' }, 413); }
  if (request.signal.aborted) return json({ error: 'Transcription cancelled.' }, 499);
  let reservation;
  try {
    // Shared paid-model ceiling, charged conservatively at 3000 accounting units.
    // No separate uncapped ASR endpoint or refund after a possible provider call.
    reservation = await reserveStoredModelCall(id, 3000, hostedTranscriptionLimits());
    if (reservation?.status === 'missing') return json({ error: 'Your conversation has ended. Please start a new one.' }, 401);
    if (reservation?.status === 'limit') return json({ error: 'Noor has reached today’s usage limit. Please try tomorrow.' }, 429);
    if (reservation?.status !== 'ok' || !/^[a-f0-9-]{36}$/i.test(reservation.id || '')) throw new Error('reservation');
  } catch { return json({ error: 'Spending checks are unavailable. Please try again later.' }, 503); }
  let predictionId;
  let complete = false;
  async function provider(url, options = {}, activeSignal = signal) {
    const response = await fetch(url, {
      ...options, signal: activeSignal,
      headers: { authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`, 'content-type': 'application/json', ...options.headers },
    });
    if (!response.ok) throw new Error('provider');
    return response.json();
  }
  try {
    // Keep creation bounded independently: if Stop arrives during creation, obtain
    // the prediction ID before cancelling, rather than orphaning upstream work.
    signal.throwIfAborted();
    let prediction = await provider(endpoint, {
      method: 'POST', headers: { 'cancel-after': '45s' }, body: JSON.stringify({ version, input: {
        audio: `data:${mime};base64,${audio.toString('base64')}`, transcription: 'plain text', translate: false,
      } }),
    }, AbortSignal.timeout(Math.max(1, Math.min(10000, 40000 - (Date.now() - startedAt)))));
    predictionId = prediction.id;
    if (!/^[a-z0-9]+$/i.test(predictionId || '')) throw new Error('prediction');
    signal.throwIfAborted();
    while (!['succeeded', 'failed', 'canceled'].includes(prediction.status)) {
      await delay(750, undefined, { signal });
      prediction = await provider(`${endpoint}/${predictionId}`);
    }
    if (prediction.status !== 'succeeded') throw new Error('provider');
    const text = prediction.output?.transcription;
    if (typeof text !== 'string' || text.length > 10000) throw new Error('transcript');
    signal.throwIfAborted();
    if (await settleStoredModelCall(id, reservation.id, null, 'done') !== true) throw new Error('settlement');
    complete = true;
    return json({ text: text.trim() });
  } catch {
    return json({ error: signal.aborted ? 'Transcription stopped or timed out. Please try again.' : 'Could not transcribe the recording. Please try again or type your question.' }, signal.aborted ? 504 : 503);
  } finally {
    if (!complete) {
      if (predictionId) {
        try { await provider(`${endpoint}/${predictionId}/cancel`, { method: 'POST' }, AbortSignal.timeout(2000)); } catch { /* Provider expires canceled jobs; keep spending charged. */ }
      }
      try { await settleStoredModelCall(id, reservation.id, null, 'uncertain'); } catch { /* Reservation remains charged. */ }
    }
  }
}
