export const airportDestinations = [
  { id: 'baggage', pattern: /\b(baggage claim|baggage reclaim|carousel|collect.*(?:bag|luggage)|pick up.*(?:bag|luggage))\b/i, name: 'Baggage claim', route: 'Arrival corridor → arrivals processing → Baggage Hall B → demo Carousel B2', minutes: 12 },
  { id: 'toilets', pattern: /\b(toilets?|restrooms?|bathrooms?|washrooms?)\b/i, name: 'Toilets', route: 'Arrival corridor → Junction A → toilets beside the information desk', minutes: 4 },
  { id: 'accessibility', pattern: /\b(accessib\w*|wheelchair|mobility|assistance desk|step[ -]free)\b/i, name: 'Accessibility assistance desk', route: 'Arrival corridor → Junction A → assistance desk beside the lift; this demo route uses no stairs', minutes: 5 },
  { id: 'transport', pattern: /\b(ground transport|taxi|taxis|train|trains|bus|buses|transport|station)\b/i, name: 'Ground transport', route: 'After required arrivals processing → Baggage Hall B → arrivals exit → Transport Hall C; taxi, train, and bus signs are grouped here in the demo', minutes: 18 },
  { id: 'information', pattern: /\b(information desk|help desk|lost property|lost and found)\b/i, name: 'Information desk', route: 'Arrival corridor → Junction A → information desk; ask here about the demo lost-property process', minutes: 4 },
];
export function airportGuideIntent(message) {
  if (/\b(weather|forecast|temperature|email|e-mail|fr24|flightradar24|connection|connecting|next flight|onward flight|transfer|layover)\b/i.test(message)) return false;
  return airportDestinations.some((d) => d.pattern.test(message))
    || /\b(airport guide|airport map|terminal map|airport directions|airport facilities)\b/i.test(message);
}
export function airportGuideReply(message) {
  const base = { expression: 'thoughtful', sourceLabel: 'Demo airport guide · Invented Haneda layout · Not live directions' };
  if (/\b(JFK|New York|KIX|Kansai|ICN|Incheon|Heathrow|LHR|Narita|NRT)\b/i.test(message)) {
    return { ...base, reply: 'This guide only covers an invented Haneda arrival layout for the CL 204 demo. I do not have directions for that other airport; check its official signs or ask airport staff.' };
  }
  const destination = airportDestinations.find((d) => d.pattern.test(message));
  if (!destination) return { ...base, reply: 'The invented Haneda demo guide covers baggage claim, toilets, accessibility assistance, ground transport, and the information desk. Which would you like? It is not a real airport map.' };
  const extra = destination.id === 'accessibility'
    ? ' This only shows directions; no assistance request has been submitted.'
    : destination.id === 'baggage'
      ? ' Carousel B2 is a fixed sample, not an actual baggage assignment.'
      : destination.id === 'transport'
        ? ' No real fares, timetables, tickets, or bookings are available.'
        : '';
  return { ...base, reply: `Invented Haneda demo — ${destination.name}: ${destination.route}. About ${destination.minutes} minutes walking from the demo arrival corridor, excluding disembarkation, queues, and border checks.${extra} This layout is fictional, not a real Haneda map; for actual travel, follow current airport signs and staff instructions.` };
}
