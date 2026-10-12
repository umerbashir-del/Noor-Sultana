import { getWeather, WeatherUnavailable } from '../prototype/weather.mjs';
import { json } from '../lib/vercel-shared.mjs';

export async function GET(request) {
  const url = new URL(request.url);
  const location = url.searchParams.get('location');
  const when = url.searchParams.get('when');
  if (!['hnd', 'jfk'].includes(location) || !['now', 'arrival'].includes(when)
    || (when === 'arrival' && location !== 'hnd')) {
    return json({ error: 'Choose current JFK or Tokyo weather, or the Tokyo arrival forecast.' }, 400);
  }
  try { return json({ weather: await getWeather(location, when) }); }
  catch (error) {
    return json({ error: error instanceof WeatherUnavailable && /sample arrival/.test(error.message)
      ? 'The sample arrival is in the past or outside the forecast window.'
      : 'Weather is unavailable right now. Please try again later.' }, 503);
  }
}
