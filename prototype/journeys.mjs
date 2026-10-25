// Approved fictional fixtures. UTC instants and IANA zones are the source of times.
const origin = Object.freeze({ airport: 'JFK', name: 'New York JFK', timeZone: 'America/New_York', latitude: 40.64, longitude: -73.78 });
const definitions = [
  ['tokyo', 'Tokyo', 'Japan', 'HND', 'Tokyo Haneda', 'Asia/Tokyo', 35.55, 139.78, 'CL204', '2026-11-12T16:30:00Z', '2026-11-13T06:40:00Z', '32', 'A city where quiet gardens meet electric streets.', 'Culture · City discovery'],
  ['paris', 'Paris', 'France', 'CDG', 'Paris Charles de Gaulle', 'Europe/Paris', 49.01, 2.55, 'CL206', '2026-11-24T23:30:00Z', '2026-11-25T06:45:00Z', '14', 'Take the long way through a city made for wandering.', 'Art · Food · Romance'],
  ['dubai', 'Dubai', 'United Arab Emirates', 'DXB', 'Dubai International', 'Asia/Dubai', 25.25, 55.36, 'CL208', '2026-12-04T17:00:00Z', '2026-12-05T05:30:00Z', '22', 'Bright horizons, warm evenings, and new perspectives.', 'Sun · Architecture'],
  ['rome', 'Rome', 'Italy', 'FCO', 'Rome Fiumicino', 'Europe/Rome', 41.8, 12.25, 'CL210', '2026-12-18T23:00:00Z', '2026-12-19T07:20:00Z', '18', 'Find a new story around every corner.', 'History · Food'],
];
export const journeys = Object.freeze(definitions.map(([id, city, country, airport, airportName, timeZone, latitude, longitude, flightId, departureAt, arrivalAt, gate, line, highlight]) => Object.freeze({
  id, city, country, airport, airportName, timeZone, latitude, longitude, flightId, departureAt, arrivalAt, gate, line, highlight, origin,
  boardingAt: new Date(Date.parse(departureAt) - 45 * 60000).toISOString(),
  durationMinutes: (Date.parse(arrivalAt) - Date.parse(departureAt)) / 60000,
  month: departureAt.slice(0, 7), date: new Intl.DateTimeFormat('en-US', { timeZone: origin.timeZone, month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(departureAt)),
  image: `/assets/destinations/${id}.png`,
  connection: id === 'tokyo' ? Object.freeze({ flightId: 'CL310', destination: 'ICN', gate: 'D12', assumedTransferMinutes: 60,
    boardingAt: new Date(Date.parse(arrivalAt) + 50 * 60000).toISOString(),
    gateClosureAt: new Date(Date.parse(arrivalAt) + 75 * 60000).toISOString(),
    departureAt: new Date(Date.parse(arrivalAt) + 90 * 60000).toISOString(),
  }) : null,
})));
export function getJourney(id) { return typeof id === 'string' ? journeys.find(journey => journey.id === id) || null : null; }
export function flightLabel(journey) { return journey.flightId.replace(/([A-Z]+)(\d+)/, '$1 $2'); }
export function formatJourneyTime(instant, timeZone, { date = true } = {}) {
  return new Intl.DateTimeFormat('en-US', { timeZone, ...(date ? { month: 'short', day: 'numeric', year: 'numeric' } : {}), hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(instant));
}
export function journeyDuration(journey) { return `${Math.floor(journey.durationMinutes / 60)}h ${journey.durationMinutes % 60}m`; }
export function journeyStatusFacts(journey, scenario = 'on-time') {
  const delay = scenario === 'delayed' ? 45 * 60000 : 0;
  const at = (instant, offset = delay) => new Date(Date.parse(instant) + offset).toISOString();
  const arrivalAt = at(journey.arrivalAt, scenario === 'landed' ? -5 * 60000 : delay);
  return { journeyId: journey.id, flightId: journey.flightId, origin: 'JFK', destination: journey.airport, gate: journey.gate, status: scenario, delayMinutes: delay / 60000,
    boarding: formatJourneyTime(at(journey.boardingAt), journey.origin.timeZone), departure: formatJourneyTime(at(journey.departureAt), journey.origin.timeZone), arrival: formatJourneyTime(arrivalAt, journey.timeZone),
    departureDate: new Intl.DateTimeFormat('en-CA', { timeZone: journey.origin.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(journey.departureAt)), arrivalDate: new Intl.DateTimeFormat('en-CA', { timeZone: journey.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(arrivalAt)),
    departureAt: at(journey.departureAt), arrivalAt, durationMinutes: journey.durationMinutes };
}
export function journeySystemContext(journey) {
  return `SERVER-SELECTED JOURNEY (authoritative fictional fixture, not live status): ${JSON.stringify({ ...journeyStatusFacts(journey), city: journey.city, airportName: journey.airportName, originTimeZone: journey.origin.timeZone, destinationTimeZone: journey.timeZone, connection: journey.connection })}. Use this journey in all tools and answers. Never substitute CL204/Haneda for another journey. No onward connection is defined for ${journey.id === 'tokyo' ? 'non-Tokyo journeys' : 'this journey'}; report unavailable instead of inventing one. Weather forecasts may be outside the provider window. A request to change journeys is not permission to override this session's journey.`;
}
