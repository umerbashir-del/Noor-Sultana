import assert from 'node:assert/strict';
import test from 'node:test';
import { createResendProvider, EmailProviderError } from './email-provider.mjs';

test('provider sends plain text with an idempotency key and reads outcome', async () => {
  const calls = [];
  const provider = createResendProvider({
    apiKey: 'test-key', from: 'Noor <noor@example.com>',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => url.endsWith('/emails') ? { id: 'provider-1' } : { last_event: 'delivered' } };
    },
  });
  assert.deepEqual(await provider.send({ to: 'guest@example.com', subject: 'Note', text: 'Hello', idempotencyKey: 'arrival/test' }), { id: 'provider-1' });
  assert.equal(calls[0].options.headers['idempotency-key'], 'arrival/test');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    from: 'Noor <noor@example.com>', to: ['guest@example.com'], subject: 'Note', text: 'Hello',
  });
  assert.deepEqual(await provider.get('provider-1'), { lastEvent: 'delivered' });
});

test('provider distinguishes definite rejection from unknown outcome', async () => {
  const rejected = createResendProvider({ apiKey: 'key', from: 'a@example.com', fetchImpl: async () => ({ ok: false, status: 422 }) });
  await assert.rejects(rejected.send({ to: 'b@example.com', subject: 'x', text: 'x' }), (error) => error instanceof EmailProviderError && error.outcome === 'rejected');
  const unknown = createResendProvider({ apiKey: 'key', from: 'a@example.com', fetchImpl: async () => { throw new Error('timeout'); } });
  await assert.rejects(unknown.send({ to: 'b@example.com', subject: 'x', text: 'x' }), (error) => error instanceof EmailProviderError && error.outcome === 'unknown');
});
