export class EmailProviderError extends Error {
  constructor(message, outcome = 'unknown') {
    super(message);
    this.name = 'EmailProviderError';
    this.outcome = outcome;
  }
}

export function createResendProvider({ apiKey, from, fetchImpl = fetch }) {
  if (!apiKey || !from) return null;

  async function request(path, { method = 'GET', payload, idempotencyKey } = {}) {
    let response;
    try {
      response = await fetchImpl(`https://api.resend.com${path}`, {
        method,
        signal: AbortSignal.timeout(15_000),
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
    } catch {
      throw new EmailProviderError('Email provider did not confirm the request.', 'unknown');
    }
    if (!response.ok) {
      // A 4xx rejection is definite except 408/409/429. Other failures may have been accepted upstream.
      const outcome = response.status >= 400 && response.status < 500
        && ![408, 409, 429].includes(response.status) ? 'rejected' : 'unknown';
      throw new EmailProviderError(`Email provider returned ${response.status}.`, outcome);
    }
    try {
      return await response.json();
    } catch {
      throw new EmailProviderError('Email provider returned an unreadable response.', 'unknown');
    }
  }

  return {
    async send({ to, subject, text, idempotencyKey }) {
      const result = await request('/emails', {
        method: 'POST', idempotencyKey,
        payload: { from, to: [to], subject, text },
      });
      if (typeof result.id !== 'string' || !result.id) {
        throw new EmailProviderError('Email provider did not return a message ID.', 'unknown');
      }
      return { id: result.id };
    },
    async get(id) {
      const result = await request(`/emails/${encodeURIComponent(id)}`);
      return { lastEvent: typeof result.last_event === 'string' ? result.last_event : null };
    },
  };
}
