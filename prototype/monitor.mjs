const routeNames = [
  [/^\/api\/crew$/, 'crew'],
  [/^\/api\/reminders$/, 'reminders'],
  [/^\/api\/session(?:\/end)?$/, 'session'],
  [/^\/api\/chat$/, 'chat'],
  [/^\/api\/speak$/, 'speak'],
  [/^\/api\/transcribe$/, 'transcribe'],
  [/^\/api\/stop$/, 'stop'],
  [/^\/api\/weather$/, 'weather'],
  [/^\/api\/email\//, 'email'],
  [/^\/knowledge\//, 'knowledge'],
  [/^\/healthz$/, 'health'],
];

export function safeRoute(pathname) {
  return routeNames.find(([pattern]) => pattern.test(pathname))?.[1] || 'static';
}

export function logEvent(event, fields = {}) {
  // Never include prompts, transcripts, email addresses, cookies, or API keys.
  const safe = Object.fromEntries(Object.entries(fields).filter(([key, value]) =>
    ['route', 'status', 'durationMs', 'tokens', 'scope', 'kind'].includes(key)
      && (typeof value === 'number' || typeof value === 'string')));
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...safe }));
}
