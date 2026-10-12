import assert from 'node:assert/strict';
import test from 'node:test';
import { getWeather, weatherIntent, weatherReply, WeatherUnavailable } from './weather.mjs';

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

test('routes only supported weather questions to the lookup', () => {
  assert.deepEqual(weatherIntent('What is the weather in Tokyo on arrival?'), { location: 'hnd', when: 'arrival' });
  assert.deepEqual(weatherIntent('Is it raining at JFK?'), { location: 'jfk', when: 'now' });
  assert.deepEqual(weatherIntent('What is the weather at departure?'), { unsupported: 'departure' });
  assert.deepEqual(weatherIntent('What is the weather in Paris?'), { unsupported: 'location' });
  assert.deepEqual(weatherIntent('What is the weather tomorrow?'), { unsupported: 'time' });
  assert.deepEqual(weatherIntent('What is the weather at JFK on arrival?'), { unsupported: 'time' });
  assert.equal(weatherIntent('What is the boarding gate?'), null);
});
