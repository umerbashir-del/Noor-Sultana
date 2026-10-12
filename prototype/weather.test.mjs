import assert from 'node:assert/strict';
import test from 'node:test';
import { getWeather, getWeatherForPlace, weatherAvailabilityIntent, weatherIntent, weatherReply, WeatherUnavailable } from './weather.mjs';

const now = Date.parse('2026-10-11T16:00:00Z');
const provider = (payload) => async (url) => {
  assert.equal(url.hostname, 'api.open-meteo.com');
  assert.equal(url.searchParams.get('timeformat'), 'unixtime');
  return { ok: true, json: async () => payload };
};

test('looks up checked current conditions for a fixed location', async () => {
  const weather = await getWeather('hnd', 'now', {
    now,
    fetchImpl: provider({
      timezone: 'Asia/Tokyo',
      current: { time: now / 1000, temperature_2m: 21.6, weather_code: 2 },
    }),
  });
  assert.equal(weather.location, 'Tokyo Haneda area');
  assert.equal(weather.temperatureC, 22);
  assert.equal(weather.condition, 'Partly cloudy');
  assert.equal(weather.validAt, new Date(now).toISOString());
  assert.match(weatherReply(weather), /current model conditions/i);
});

test('selects the hour nearest the fictional arrival and labels it as a forecast', async () => {
  const weather = await getWeather('hnd', 'arrival', {
    now,
    fetchImpl: provider({
      timezone: 'Asia/Tokyo',
      hourly: {
        time: [Date.parse('2026-10-13T05:00:00Z') / 1000, Date.parse('2026-10-13T06:00:00Z') / 1000],
        temperature_2m: [18, 20],
        weather_code: [3, 61],
        precipitation_probability: [20, 70],
      },
    }),
  });
  assert.equal(weather.validAt, '2026-10-13T06:00:00.000Z');
  assert.equal(weather.precipitationProbability, 70);
  assert.match(weatherReply(weather), /flight time is fictional/i);
});

test('rejects stale, implausible, and unsupported weather', async () => {
  await assert.rejects(getWeather('hnd', 'now', {
    now,
    fetchImpl: provider({ timezone: 'Asia/Tokyo', current: {
      time: (now - 3 * 60 * 60 * 1000) / 1000, temperature_2m: 21, weather_code: 0,
    } }),
  }), WeatherUnavailable);
  await assert.rejects(getWeather('hnd', 'now', {
    now,
    fetchImpl: provider({ timezone: 'Asia/Tokyo', current: {
      time: now / 1000, temperature_2m: 999, weather_code: 0,
    } }),
  }), WeatherUnavailable);
  await assert.rejects(getWeather('hnd', 'arrival', { now: Date.parse('2026-10-14T00:00:00Z') }), WeatherUnavailable);
  await assert.rejects(getWeather('invalid', 'now', { now }), TypeError);
});

test('resolves a named city through geocoding and checks its current weather', async () => {
  const hosts = [];
  const weather = await getWeatherForPlace('London', {
    now,
    fetchImpl: async (url) => {
      hosts.push(url.hostname);
      if (url.hostname === 'geocoding-api.open-meteo.com') {
        assert.equal(url.searchParams.get('name'), 'London');
        return { ok: true, json: async () => ({ results: [
          { name: 'London', country: 'United Kingdom', latitude: 51.5, longitude: -0.12, timezone: 'Europe/London', population: 9_000_000 },
          { name: 'London', country: 'Canada', latitude: 42.98, longitude: -81.25, timezone: 'America/Toronto', population: 400_000 },
        ] }) };
      }
      assert.equal(url.searchParams.get('latitude'), '51.5');
      return { ok: true, json: async () => ({ timezone: 'Europe/London', current: {
        time: now / 1000, temperature_2m: 16.4, weather_code: 3,
      } }) };
    },
  });
  assert.deepEqual(hosts, ['geocoding-api.open-meteo.com', 'api.open-meteo.com']);
  assert.equal(weather.location, 'London, United Kingdom');
  assert.equal(weather.city, 'London');
  assert.match(weatherReply(weather), /London, United Kingdom/);
});

test('asks for clarification when a named place is ambiguous', async () => {
  await assert.rejects(getWeatherForPlace('Springfield', { now, fetchImpl: async () => ({ ok: true, json: async () => ({ results: [
    { name: 'Springfield', country: 'United States', latitude: 39.8, longitude: -89.6, timezone: 'America/Chicago', population: 115_000 },
    { name: 'Springfield', country: 'United States', latitude: 37.2, longitude: -93.3, timezone: 'America/Chicago', population: 170_000 },
  ] }) }) }), (error) => error instanceof WeatherUnavailable && error.code === 'ambiguous');
  await assert.rejects(getWeatherForPlace('https://other.example'), TypeError);
});

test('routes only supported weather questions to the lookup', () => {
  assert.equal(weatherAvailabilityIntent('What weather information can you check?'), true);
  assert.equal(weatherAvailabilityIntent('Can you check weather in Paris?'), false);
  assert.deepEqual(weatherIntent('What is the weather in Tokyo on arrival?'), { location: 'hnd', when: 'arrival' });
  assert.deepEqual(weatherIntent('Is it raining at JFK?'), { location: 'jfk', when: 'now' });
  assert.deepEqual(weatherIntent('What is the weather at departure?'), { unsupported: 'departure' });
  assert.deepEqual(weatherIntent('What is the weather in Paris?'), { place: 'Paris', when: 'now' });
  assert.deepEqual(weatherIntent('weather Paris'), { place: 'Paris', when: 'now' });
  assert.deepEqual(weatherIntent('Paris weather'), { place: 'Paris', when: 'now' });
  assert.deepEqual(weatherIntent('Is it raining in Paris, France?'), { place: 'Paris, France', when: 'now' });
  assert.deepEqual(weatherIntent('What is the weather in New York?'), { place: 'New York', when: 'now' });
  assert.deepEqual(weatherIntent('What is the weather in Paris and London?'), { unsupported: 'location' });
  assert.deepEqual(weatherIntent('What is the weather tomorrow?'), { unsupported: 'time' });
  assert.deepEqual(weatherIntent('What is the weather at JFK on arrival?'), { unsupported: 'time' });
  assert.equal(weatherIntent('What is the boarding gate?'), null);
});
