import { readFile } from 'node:fs/promises';
import { sessionIdFrom } from '../lib/vercel-session.mjs';
import { reserveStoredVoice, supabaseEnabled } from '../lib/supabase-store.mjs';
import { json, sameOrigin } from '../lib/vercel-shared.mjs';

const predictionEndpoint = 'https://api.replicate.com/v1/models/resemble-ai/chatterbox-turbo/predictions';
const maxAudioBytes = 5_000_000;
let hopeReferencePromise;

function hopeReference() {
  hopeReferencePromise ||= readFile(new URL('../prototype/voice/noor-reference.wav', import.meta.url))
    .then((audio) => `data:audio/wav;base64,${audio.toString('base64')}`)
    .catch((error) => { hopeReferencePromise = undefined; throw error; });
  return hopeReferencePromise;
}

export function browserCompatibleWav(input) {
  const bytes = new Uint8Array(input);
  const view = new DataView(input);
  if (bytes.length < 44 || view.getUint32(0, false) !== 0x52494646 || view.getUint32(8, false) !== 0x57415645) {
    throw new Error('Voice provider returned invalid WAV audio');
  }
  let format;
  let dataOffset;
  let dataLength;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = view.getUint32(offset, false);
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > bytes.length) throw new Error('Voice provider returned truncated WAV audio');
    if (kind === 0x666d7420) {
      if (length < 16) throw new Error('Voice provider returned invalid WAV format');
      format = { code: view.getUint16(start, true), channels: view.getUint16(start + 2, true),
        rate: view.getUint32(start + 4, true), bits: view.getUint16(start + 14, true) };
    }
    if (kind === 0x64617461) { dataOffset = start; dataLength = length; }
    offset = start + length + (length % 2);
  }
  if (!format || dataOffset === undefined || !format.channels || format.channels > 2 || !format.rate || !dataLength) {
    throw new Error('Voice provider returned incomplete WAV audio');
  }
  if (format.code === 1 && format.bits === 16) return input;
  if (format.code !== 3 || format.bits !== 32 || dataLength % 4) {
    throw new Error('Voice provider returned unsupported WAV audio');
  }
  const sampleCount = dataLength / 4;
  if (sampleCount % format.channels) throw new Error('Voice provider returned incomplete samples');
  const output = new ArrayBuffer(44 + sampleCount * 2);
  const pcm = new DataView(output);
  pcm.setUint32(0, 0x52494646, false);
  pcm.setUint32(4, output.byteLength - 8, true);
  pcm.setUint32(8, 0x57415645, false);
  pcm.setUint32(12, 0x666d7420, false);
  pcm.setUint32(16, 16, true);
  pcm.setUint16(20, 1, true);
  pcm.setUint16(22, format.channels, true);
  pcm.setUint32(24, format.rate, true);
  pcm.setUint32(28, format.rate * format.channels * 2, true);
  pcm.setUint16(32, format.channels * 2, true);
  pcm.setUint16(34, 16, true);
  pcm.setUint32(36, 0x64617461, false);
  pcm.setUint32(40, sampleCount * 2, true);
  for (let index = 0; index < sampleCount; index++) {
    const sample = view.getFloat32(dataOffset + index * 4, true);
    const clipped = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0));
    pcm.setInt16(44 + index * 2, clipped < 0 ? Math.round(clipped * 32768) : Math.round(clipped * 32767), true);
  }
  return output;
}

function available() {
  return process.env.NOOR_VOICE_ENABLED === 'true'
    && Boolean(process.env.REPLICATE_API_TOKEN)
    && supabaseEnabled();
}

async function predictionRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`, ...options.headers },
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`Voice provider returned ${response.status}`);
  return response.json();
}

export async function GET() {
  try { return json({ available: available() }); }
  catch { return json({ available: false }); }
}

export async function POST(request) {
  if (!sameOrigin(request)) return json({ error: 'Request origin is not allowed.' }, 403);
  if (!available()) return json({ error: 'Chatterbox voice is not connected yet.' }, 503);
  if (Number(request.headers.get('content-length')) > 2500) return json({ error: 'Voice request is too long.' }, 400);
  let body;
  try { body = await request.text(); } catch { return json({ error: 'Invalid voice request.' }, 400); }
  if (body.length > 2500) return json({ error: 'Voice request is too long.' }, 400);
  let text;
  try { text = JSON.parse(body).text; } catch { return json({ error: 'Invalid voice request.' }, 400); }
  if (typeof text !== 'string' || text.length < 1 || text.length > 500) {
    return json({ error: 'This reply is too long for the demo voice.' }, 400);
  }
  const sessionId = sessionIdFrom(request);
  if (!sessionId) return json({ error: 'Conversation expired. Please start a new one.' }, 401);
  let reserved;
  try { reserved = await reserveStoredVoice(sessionId, text); }
  catch { return json({ error: 'Voice limit check is unavailable.' }, 503); }
  if (reserved === 'limit') return json({ error: 'The demo voice has reached its usage limit. Text chat still works.' }, 429);
  if (reserved !== 'ok') return json({ error: 'This reply is no longer available to speak.' }, 409);

  try {
    const referenceAudio = await hopeReference();
    let prediction = await predictionRequest(predictionEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', prefer: 'wait=30', 'cancel-after': '45s' },
      body: JSON.stringify({ input: { text, reference_audio: referenceAudio } }),
    });
    for (let attempt = 0; attempt < 6 && !prediction.output && ['starting', 'processing'].includes(prediction.status); attempt += 1) {
      if (typeof prediction.id !== 'string' || !/^[a-z0-9]+$/.test(prediction.id)) break;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      prediction = await predictionRequest(`https://api.replicate.com/v1/predictions/${prediction.id}`);
    }
    if (typeof prediction.output !== 'string') throw new Error('Voice prediction did not return audio');
    const audioUrl = new URL(prediction.output);
    if (audioUrl.protocol !== 'https:' || !(
      audioUrl.hostname === 'replicate.delivery' || audioUrl.hostname.endsWith('.replicate.delivery')
    )) {
      throw new Error('Unexpected voice audio URL');
    }
    const audioResponse = await fetch(audioUrl, { signal: AbortSignal.timeout(15_000) });
    if (!audioResponse.ok || Number(audioResponse.headers.get('content-length')) > maxAudioBytes) {
      throw new Error('Voice audio unavailable');
    }
    const audio = await audioResponse.arrayBuffer();
    if (!audio.byteLength || audio.byteLength > maxAudioBytes) throw new Error('Invalid voice audio');
    return new Response(browserCompatibleWav(audio), { headers: {
      'content-type': 'audio/wav', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    } });
  } catch (error) {
    console.error('[Chatterbox]', error?.message);
    return json({ error: 'Chatterbox could not speak this reply. Please try again.' }, 502);
  }
}
