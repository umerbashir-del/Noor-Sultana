import { getJourney } from './journeys.mjs';
const locations = Object.freeze({
  hnd: { name: 'Tokyo Haneda area', latitude: 35.55, longitude: 139.78, timeZone: 'Asia/Tokyo' },
  jfk: { name: 'New York JFK area', latitude: 40.64, longitude: -73.78, timeZone: 'America/New_York' },
});

const sampleArrival = Date.parse('2026-10-13T05:40:00Z'); // 2:40 PM JST; fictional flight.
const source = { name: 'Open-Meteo', url: 'https://open-meteo.com/' };

class WeatherUnavailable extends Error {
  constructor(message, code = 'unavailable') {
    super(message);
    this.name = 'WeatherUnavailable';
    this.code = code;
  }
}

function conditionFor(code) {
  if (code === 0) return 'Clear sky';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code >= 95 && code <= 99) return 'Thunderstorms';
  throw new WeatherUnavailable('Weather conditions are unavailable.');
}

function checkedTemperature(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -100 || value > 70) {
    throw new WeatherUnavailable('Weather temperature is unavailable.');
  }
  return Math.round(value);
}

function checkedTime(value) {
  if (!Number.isInteger(value) || value < 1_600_000_000 || value > 4_000_000_000) {
    throw new WeatherUnavailable('Weather time is unavailable.');
  }
  return new Date(value * 1000).toISOString();
}

function checkedProbability(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new WeatherUnavailable('Weather precipitation forecast is unavailable.');
  }
  return Math.round(value);
}

export function weatherAvailabilityIntent(message) {
  return /\b(?:what|which)\s+(?:kinds?\s+of\s+)?weather(?:\s+information)?\s+(?:can you|do you)\s+(?:check|provide|have)\b/i.test(message);
}

export function weatherIntent(message) {
  if (!/\b(weather|forecast|temperature|temp|rain(?:ing|y)?|snow(?:ing|y)?|wind(?:y)?|sunny|cloudy|conditions)\b/i.test(message)) return null;
  if (/\b(departure|takeoff|taking off)\b/i.test(message)) return { unsupported: 'departure' };
  if (/\b(tomorrow|tonight|weekend|next week|next month|later|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i.test(message)) return { unsupported: 'time' };
  const match = message.match(/\b(?:in|near|around|for|at)\s+([\p{L}\p{M}][\p{L}\p{M}\s,.'-]{1,69})/iu)
    || message.match(/^\s*(?:weather|forecast|temperature)\s+([\p{L}\p{M}][\p{L}\p{M}\s,.'-]{1,69})/iu)
    || message.match(/^\s*([\p{L}\p{M}][\p{L}\p{M}\s,.'-]{1,69}?)\s+(?:weather|forecast)\b/iu);
  const place = match?.[1].replace(/\b(?:right now|now|today|currently|at the moment|please)\b.*$/iu, '').trim().replace(/[,.]$/, '').trim();
  const namedJfk = place && /\bJFK\b/i.test(place);
  const namedHnd = place && (/\b(?:HND|Haneda|destination)\b/i.test(place)
    || (/^Tokyo\b/i.test(place) && /\barriv\w*\b/i.test(message)));
  const mentionsJfk = namedJfk || (!place && /\b(JFK|New York)\b/i.test(message));
  const mentionsHnd = namedHnd || (!place && /\b(HND|Haneda|Tokyo|destination|arrival)\b/i.test(message));
  const arrival = /\b(arriv\w*|land\w*|when we get there)\b/i.test(message);
  if (place && !namedJfk && !namedHnd) {
    if (arrival) return { unsupported: 'time' };
    if (place.length < 2 || /\b(?:and|or|versus|vs)\b/i.test(place)
      || !/^[\p{L}\p{M}][\p{L}\p{M}\s,.'-]*$/u.test(place)) return { unsupported: 'location' };
    return { place, when: 'now' };
  }
  if (mentionsJfk && /\b(arriv\w*|land\w*)\b/i.test(message)) return { unsupported: 'time' };
  const location = mentionsJfk ? 'jfk' : 'hnd';
  const when = arrival && location === 'hnd' ? 'arrival' : 'now';
  return { location, when };
}

export async function getWeather(locationCode, when, { fetchImpl = fetch, now = Date.now() } = {}) {
  const location = locations[locationCode];
  if (!location || !['now', 'arrival'].includes(when) || (when === 'arrival' && locationCode !== 'hnd')) {
    throw new TypeError('Unsupported weather lookup.');
  }
  return forecastAt(location, when, { fetchImpl, now });
}

function safePlacePart(value) {
  return typeof value === 'string' && value.length <= 80 && /^[\p{L}\p{M}][\p{L}\p{M}\s.'-]*$/u.test(value);
}

export async function getWeatherForPlace(place, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (typeof place !== 'string' || place.length < 2 || place.length > 70
    || !/^[\p{L}\p{M}][\p{L}\p{M}\s,.'-]*$/u.test(place)) {
    throw new TypeError('Invalid place name.');
  }
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', place);
  url.searchParams.set('count', '5');
  url.searchParams.set('language', 'en');
  let response;
  try { response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) }); }
  catch { throw new WeatherUnavailable('Place search is unreachable.'); }
  if (!response.ok) throw new WeatherUnavailable('Place search is unavailable.');
  let payload;
  try { payload = await response.json(); }
  catch { throw new WeatherUnavailable('Place search returned unreadable data.'); }
  const city = place.split(',')[0].trim().toLocaleLowerCase('en');
  const choices = (Array.isArray(payload?.results) ? payload.results : []).filter((item) =>
    safePlacePart(item?.name) && safePlacePart(item?.country)
    && item.name.toLocaleLowerCase('en') === city
    && Number.isFinite(item.latitude) && Math.abs(item.latitude) <= 90
    && Number.isFinite(item.longitude) && Math.abs(item.longitude) <= 180
    && typeof item.timezone === 'string' && item.timezone.length <= 60
    && (() => { try { new Intl.DateTimeFormat('en', { timeZone: item.timezone }); return true; } catch { return false; } })());
  if (!choices.length) throw new WeatherUnavailable('I could not identify that place.', 'place');
  if (!place.includes(',') && choices.length > 1
    && !(Number.isFinite(choices[0].population) && Number.isFinite(choices[1].population)
      && choices[0].population >= 2 * choices[1].population)) {
    throw new WeatherUnavailable('More than one place matches. Include a state or country.', 'ambiguous');
  }
  const selected = choices[0];
  const area = safePlacePart(selected.admin1) && selected.admin1 !== selected.name ? `${selected.admin1}, ` : '';
  return forecastAt({
    name: `${selected.name}, ${area}${selected.country}`,
    city: selected.name,
    latitude: selected.latitude, longitude: selected.longitude, timeZone: selected.timezone,
  }, 'now', { fetchImpl, now });
}

export async function getJourneyWeather(journeyId, when = 'now', { origin = false, fetchImpl = fetch, now = Date.now() } = {}) {
  const journey = getJourney(journeyId);
  if (!journey || !['now', 'arrival'].includes(when) || (origin && when === 'arrival')) throw new TypeError('Unsupported weather lookup.');
  const airport = origin ? journey.origin : journey;
  return forecastAt({ name: (origin ? journey.origin.name : journey.airportName) + ' area', latitude: airport.latitude, longitude: airport.longitude, timeZone: airport.timeZone }, when, { fetchImpl, now, arrivalAt: Date.parse(journey.arrivalAt) });
}

async function forecastAt(location, when, { fetchImpl, now, arrivalAt = sampleArrival }) {
  if (when === 'arrival' && (arrivalAt <= now || arrivalAt - now > 7 * 86_400_000)) {
    throw new WeatherUnavailable('The sample arrival is in the past or outside the forecast window.');
  }

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(location.latitude));
  url.searchParams.set('longitude', String(location.longitude));
  url.searchParams.set('timezone', location.timeZone);
  url.searchParams.set('timeformat', 'unixtime');
  url.searchParams.set('forecast_days', when === 'now' ? '1' : '7');
  if (when === 'now') url.searchParams.set('current', 'temperature_2m,weather_code');
  else url.searchParams.set('hourly', 'temperature_2m,weather_code,precipitation_probability');

  let response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
  } catch {
    throw new WeatherUnavailable('Weather service is unreachable.');
  }
  if (!response.ok) throw new WeatherUnavailable('Weather service is unavailable.');

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new WeatherUnavailable('Weather service returned unreadable data.');
  }
  if (!payload || payload.error || payload.timezone !== location.timeZone) {
    throw new WeatherUnavailable('Weather service returned unexpected data.');
  }

  let time;
  let temperatureC;
  let condition;
  let precipitationProbability;
  if (when === 'now') {
    time = checkedTime(payload.current?.time);
    if (Math.abs(Date.parse(time) - now) > 2 * 60 * 60 * 1000) {
      throw new WeatherUnavailable('Current weather data is stale.');
    }
    temperatureC = checkedTemperature(payload.current?.temperature_2m);
    condition = conditionFor(payload.current?.weather_code);
  } else {
    const hourly = payload.hourly;
    if (!Array.isArray(hourly?.time) || !Array.isArray(hourly.temperature_2m)
      || !Array.isArray(hourly.weather_code) || !Array.isArray(hourly.precipitation_probability)) {
      throw new WeatherUnavailable('Arrival forecast is incomplete.');
    }
    const index = hourly.time.findIndex((hour) => hour * 1000 >= arrivalAt);
    const candidates = [index - 1, index].filter((i) => i >= 0 && i < hourly.time.length);
    const closest = candidates.sort((a, b) => Math.abs(hourly.time[a] * 1000 - arrivalAt)
      - Math.abs(hourly.time[b] * 1000 - arrivalAt))[0];
    if (closest === undefined || Math.abs(hourly.time[closest] * 1000 - arrivalAt) > 45 * 60 * 1000) {
      throw new WeatherUnavailable('No forecast covers the sample arrival time.');
    }
    time = checkedTime(hourly.time[closest]);
    temperatureC = checkedTemperature(hourly.temperature_2m[closest]);
    condition = conditionFor(hourly.weather_code[closest]);
    precipitationProbability = checkedProbability(hourly.precipitation_probability[closest]);
  }

  return {
    location: location.name,
    ...(location.city ? { city: location.city } : {}),
    timeZone: location.timeZone,
    kind: when,
    validAt: time,
    fetchedAt: new Date(now).toISOString(),
    temperatureC,
    condition,
    ...(when === 'arrival' ? { precipitationProbability, sampleArrivalAt: new Date(arrivalAt).toISOString() } : {}),
    source,
  };
}

export function weatherReply(weather) {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: weather.timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(weather.validAt));
  if (weather.kind === 'arrival') {
    return `Near ${weather.location} around the sample arrival, the forecast for ${hour} is ${weather.condition.toLowerCase()} and ${weather.temperatureC}°C, with a ${weather.precipitationProbability}% chance of precipitation. The flight time is fictional; this is a real weather forecast, not live flight information.`;
  }
  return `Near ${weather.location}, current model conditions for ${hour} are ${weather.condition.toLowerCase()} and ${weather.temperatureC}°C. This is weather information, not live flight information.`;
}

export { WeatherUnavailable };
