export const trips = Object.freeze([
  { id: 'tokyo', city: 'Tokyo', country: 'Japan', airport: 'HND', month: '2026-11', date: 'Nov 12, 2026', fare: 890, image: '/assets/destinations/tokyo.png', line: 'A city where quiet gardens meet electric streets.', highlight: 'Culture · City discovery' },
  { id: 'paris', city: 'Paris', country: 'France', airport: 'CDG', month: '2026-11', date: 'Nov 24, 2026', fare: 620, image: '/assets/destinations/paris.png', line: 'Take the long way through a city made for wandering.', highlight: 'Art · Food · Romance' },
  { id: 'dubai', city: 'Dubai', country: 'United Arab Emirates', airport: 'DXB', month: '2026-12', date: 'Dec 4, 2026', fare: 760, image: '/assets/destinations/dubai.png', line: 'Bright horizons, warm evenings, and new perspectives.', highlight: 'Sun · Architecture' },
  { id: 'rome', city: 'Rome', country: 'Italy', airport: 'FCO', month: '2026-12', date: 'Dec 18, 2026', fare: 670, image: '/assets/destinations/rome.png', line: 'Find a new story around every corner.', highlight: 'History · Food' }
]);

export function findTrips({ destination = 'all', month = 'all' } = {}) {
  return trips.filter((trip) => (destination === 'all' || trip.id === destination) && (month === 'all' || trip.month === month));
}
