import { journeys } from './journeys.mjs';
export const trips = journeys;
export function findTrips({ destination = 'all', month = 'all' } = {}) {
  return trips.filter(trip => (destination === 'all' || trip.id === destination) && (month === 'all' || trip.month === month));
}
