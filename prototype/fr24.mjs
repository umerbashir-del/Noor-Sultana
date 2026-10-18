// FR24 sandbox responses are fixed samples, never tracking for the requested flight.
export function flightTrackingIntent(message) {
  if (/\b(weather|forecast|temperature)\b/i.test(message)) return false;
  return /\b(fr24|flightradar24|flight tracking|track (?:my |the |a |demo )?flight)\b/i.test(message)
    || /\bwhere\b.*\bflight\b/i.test(message)
    || /\bflight\b.*\b(position|altitude|speed|landed)\b/i.test(message)
    || /\bhas\b.*\blanded\b/i.test(message);
}

export async function flightTrackingReply({ apiKey = process.env.FR24_SANDBOX_API_KEY, fetchImpl = fetch } = {}) {
  const base = { expression: 'thoughtful', sourceLabel: 'FR24 sandbox · Simulated data · Not live' };
  if (!apiKey?.trim()) return { ...base, reply: 'The FR24 sandbox is not connected yet. Add FR24_SANDBOX_API_KEY to the server configuration to try the simulated flight-tracking demo.' };
  try {
    const response = await fetchImpl('https://fr24api.flightradar24.com/api/live/flight-positions/full?bounds=50.682,46.218,14.422,22.243', {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Accept-Version': 'v1' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Unavailable');
    const payload = await response.json();
    const flight = payload?.data?.[0];
    const valid = flight && /^[A-Z0-9-]{2,12}$/.test(flight.flight)
      && Number.isFinite(flight.lat) && Math.abs(flight.lat) <= 90
      && Number.isFinite(flight.lon) && Math.abs(flight.lon) <= 180
      && Number.isFinite(flight.alt) && flight.alt >= -2000 && flight.alt <= 100000
      && Number.isFinite(flight.gspeed) && flight.gspeed >= 0 && flight.gspeed <= 2000
      && typeof flight.timestamp === 'string' && Number.isFinite(Date.parse(flight.timestamp));
    if (!valid) throw new Error('Invalid sample');
    return { ...base, tracking: { flightId: flight.flight, latitude: flight.lat, longitude: flight.lon, altitudeFt: flight.alt, groundSpeedKnots: flight.gspeed, timestamp: flight.timestamp }, reply: `FR24 sandbox sample ${flight.flight}: position ${flight.lat.toFixed(2)}°, ${flight.lon.toFixed(2)}°, altitude ${flight.alt.toLocaleString('en-US')} ft, ground speed ${flight.gspeed} knots. Sample timestamp: ${new Date(flight.timestamp).toISOString()}. This is fixed simulated data, not live tracking for your requested flight or fictional CL 204; it does not establish arrival status.` };
  } catch {
    return { ...base, reply: 'The FR24 sandbox sample is unavailable right now. Please try again later; I cannot confirm a real flight position or arrival status.' };
  }
}
