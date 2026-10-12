import { sessionIdFrom } from '../lib/vercel-session.mjs';
import { reserveStoredVoice, supabaseEnabled } from '../lib/supabase-store.mjs';
import { json, sameOrigin } from '../lib/vercel-shared.mjs';

const predictionEndpoint = 'https://api.replicate.com/v1/models/resemble-ai/chatterbox-turbo/predictions';
const maxAudioBytes = 5_000_000;

function available() {
  return Boolean(process.env.REPLICATE_API_TOKEN) && supabaseEnabled();
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
    let prediction = await predictionRequest(predictionEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', prefer: 'wait=30', 'cancel-after': '45s' },
      body: JSON.stringify({ input: { text, voice: 'Abigail' } }),
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
    return new Response(audio, { headers: {
      'content-type': 'audio/wav', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    } });
  } catch (error) {
    console.error('[Chatterbox]', error?.message);
    return json({ error: 'Chatterbox could not speak this reply. Please try again.' }, 502);
  }
}
