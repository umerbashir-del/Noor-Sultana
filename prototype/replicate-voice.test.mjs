import test from 'node:test';
import assert from 'node:assert/strict';
import { createReplicateVoice } from './replicate-voice.mjs';

function wav() {
  const b = Buffer.alloc(46);
  b.write('RIFF'); b.writeUInt32LE(38, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(2, 40);
  return b;
}

test('cloud voice conditions the fixed reference, polls, validates WAV and never sends its token to audio storage', async () => {
  const calls = [];
  const voice = createReplicateVoice({ token: 'private-test-token', pollMs: 0, reference: async () => wav(),
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('replicate.delivery')) return new Response(wav());
      return Response.json(calls.length === 1 ? { id: 'abc123', status: 'processing' }
        : { id: 'abc123', status: 'succeeded', output: 'https://replicate.delivery/test.wav' });
    },
  });
  assert.equal(voice.available, true);
  assert.deepEqual(await voice.speak('Hello aboard.'), wav());
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.input.text, 'Hello aboard.');
  assert.match(payload.input.reference_audio, /^data:audio\/wav;base64,/);
  assert.match(calls[0].url, /models\/resemble-ai\/chatterbox-turbo\/predictions$/);
  assert.equal(calls[0].options.headers.authorization, 'Bearer private-test-token');
  assert.equal(calls[2].options.headers, undefined);
  assert.equal(calls[2].options.redirect, 'error');
});

test('Whisper receives the actual recording and returns a bounded transcript; failures never leak provider bodies', async () => {
  let sent;
  const voice = createReplicateVoice({ token: 'test', fetchImpl: async (_, options) => {
    sent = JSON.parse(options.body);
    return Response.json({ status: 'succeeded', output: { transcription: 'Where is our gate?' } });
  } });
  assert.equal(await voice.transcribe(Buffer.alloc(2000), 'audio/ogg'), 'Where is our gate?');
  assert.equal(sent.version.length, 64);
  assert.match(sent.input.audio, /^data:audio\/ogg;base64,/);
  const failed = createReplicateVoice({ token: 'test', fetchImpl: async () => new Response('private provider text', { status: 401 }) });
  await assert.rejects(failed.transcribe(Buffer.alloc(2000), 'audio/ogg'), error => /HTTP 401/.test(error.message) && !/private/.test(error.message));
});

test('Stop during prediction creation still obtains the ID and cancels it; it never polls or downloads afterward', async () => {
  const controller = new AbortController(), urls = [];
  const voice = createReplicateVoice({ token: 'test', fetchImpl: async (url) => {
    urls.push(String(url));
    if (urls.length === 1) {
      controller.abort();
      return Response.json({ id: 'pending123', status: 'processing' });
    }
    return Response.json({ status: 'canceled' });
  } });
  await assert.rejects(voice.transcribe(Buffer.alloc(2000), 'audio/wav', controller.signal), { name: 'AbortError' });
  assert.deepEqual(urls, ['https://api.replicate.com/v1/predictions', 'https://api.replicate.com/v1/predictions/pending123/cancel']);
});

test('voice rejects external URLs, oversize audio and malformed WAV; missing token makes no requests', async () => {
  for (const [output, body, headers] of [
    ['https://example.com/secret', wav(), {}],
    ['https://replicate.delivery/voice', wav(), { 'content-length': '5000001' }],
    ['https://replicate.delivery/voice', Buffer.from('bad audio'), {}],
  ]) {
    let downloads = 0;
    const voice = createReplicateVoice({ token: 'test', reference: async () => wav(), fetchImpl: async (url) => {
      if (String(url).startsWith('https://api.replicate.com/')) return Response.json({ status: 'succeeded', output });
      downloads++;
      return new Response(body, { headers });
    } });
    await assert.rejects(voice.speak('Hello.'));
    if (output.includes('example.com')) assert.equal(downloads, 0);
  }
  const disconnected = createReplicateVoice({ fetchImpl: () => assert.fail('No provider call allowed') });
  assert.equal(disconnected.available, false);
  await assert.rejects(disconnected.transcribe(Buffer.alloc(2000), 'audio/wav'), /not configured/);
});
