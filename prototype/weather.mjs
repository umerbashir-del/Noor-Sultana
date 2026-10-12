const locations = Object.freeze({
  hnd: { name: 'Tokyo Haneda area', latitude: 35.55, longitude: 139.78, timeZone: 'Asia/Tokyo' },
  jfk: { name: 'New York JFK area', latitude: 40.64, longitude: -73.78, timeZone: 'America/New_York' },
});

const sampleArrival = Date.parse('2026-10-13T05:40:00Z'); // 2:40 PM JST; fictional flight.
const source = { name: 'Open-Meteo', url: 'https://open-meteo.com/' };

class WeatherUnavailable extends Error {
  constructor(message) {
    super(message);
    this.name = 'WeatherUnavailable';
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

export function weatherIntent(message) {
  if (!/\b(weather|forecast|temperature|temp|rain(?:ing|y)?|snow(?:ing|y)?|wind(?:y)?|sunny|cloudy|conditions)\b/i.test(message)) return null;
  const mentionsJfk = /\b(JFK|New York|departure)\b/i.test(message);
  const mentionsHnd = /\b(HND|Haneda|Tokyo|destination|arrival)\b/i.test(message);
  if (!mentionsJfk && !mentionsHnd && /\b(?:in|at|near)\s+[a-z]+/i.test(message)) return { unsupported: 'location' };
  if (/\b(departure|takeoff|taking off)\b/i.test(message)) return { unsupported: 'departure' };
  if (/\b(tomorrow|next week|next month)\b/i.test(message)) return { unsupported: 'time' };
  if (mentionsJfk && /\b(arriv\w*|land\w*)\b/i.test(message)) return { unsupported: 'time' };
  const location = mentionsJfk ? 'jfk' : 'hnd';
  const when = /\b(arriv\w*|land\w*|when we get there)\b/i.test(message) && location === 'hnd' ? 'arrival' : 'now';
  return { location, when };
}

export async function getWeather(locationCode, when, { fetchImpl = fetch, now = Date.now() } = {}) {
  const location = locations[locationCode];
  if (!location || !['now', 'arrival'].includes(when) || (when === 'arrival' && locationCode !== 'hnd')) {
    throw new TypeError('Unsupported weather lookup.');
  }
  if (when === 'arrival' && (sampleArrival <= now || sampleArrival - now > 7 * 86_400_000)) {
    throw new WeatherUnavailable('The sample arrival is in the past or outside the forecast window.');
  }

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(location.latitude));
  url.searchParams.set('longitude', String(location.longitude));
  url.searchParams.set('timezone', location.timeZone);
  url.searchParams.set('timeformat', 'unixtime');
  url.searchParams.set('forecast_days', '7');
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
    const index = hourly.time.findIndex((hour) => hour * 1000 >= sampleArrival);
    const candidates = [index - 1, index].filter((i) => i >= 0 && i < hourly.time.length);
    const closest = candidates.sort((a, b) => Math.abs(hourly.time[a] * 1000 - sampleArrival)
      - Math.abs(hourly.time[b] * 1000 - sampleArrival))[0];
    if (closest === undefined || Math.abs(hourly.time[closest] * 1000 - sampleArrival) > 45 * 60 * 1000) {
      throw new WeatherUnavailable('No forecast covers the sample arrival time.');
    }
    time = checkedTime(hourly.time[closest]);
    temperatureC = checkedTemperature(hourly.temperature_2m[closest]);
    condition = conditionFor(hourly.weather_code[closest]);
    precipitationProbability = checkedProbability(hourly.precipitation_probability[closest]);
  }

  return {
    location: location.name,
    timeZone: location.timeZone,
    kind: when,
    validAt: time,
    fetchedAt: new Date(now).toISOString(),
    temperatureC,
    condition,
    ...(when === 'arrival' ? { precipitationProbability, sampleArrivalAt: new Date(sampleArrival).toISOString() } : {}),
    source,
  };
}

export function weatherReply(weather) {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: weather.timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(weather.validAt));
  if (weather.kind === 'arrival') {
    return `Near Tokyo Haneda around the sample arrival, the forecast for ${hour} is ${weather.condition.toLowerCase()} and ${weather.temperatureC}°C, with a ${weather.precipitationProbability}% chance of precipitation. The flight time is fictional; this is a real weather forecast, not live flight information.`;
  }
  return `Near ${weather.location}, current model conditions for ${hour} are ${weather.condition.toLowerCase()} and ${weather.temperatureC}°C. This is weather information, not live flight information.`;
}

export { WeatherUnavailable };
