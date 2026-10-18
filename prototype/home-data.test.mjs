import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findTrips } from './home-data.mjs';

test('search filters sample trips by destination and travel month', () => {
  assert.equal(findTrips().length, 4);
  assert.deepEqual(findTrips({ destination: 'paris' }).map((trip) => trip.city), ['Paris']);
  assert.deepEqual(findTrips({ month: '2026-12' }).map((trip) => trip.city), ['Dubai', 'Rome']);
  assert.deepEqual(findTrips({ destination: 'paris', month: '2026-12' }), []);
});
