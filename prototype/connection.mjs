import { normalizeScenario } from './flight-status.mjs';

export function connectionIntent(message) {
  if (/\b(weather|forecast|temperature|email|e-mail|fr24|flightradar24)\b/i.test(message)) return false;
  return /\b(connect(?:ion|ions|ing)|next flight|onward flight|transfer(?:s|ring)?|layover)\b/i.test(message);
}

export function connectionReply(message, scenario) {
  const selected = normalizeScenario(scenario);
  const base = { expression: 'thoughtful', sourceLabel: 'Demo connection assistant · Fictional itinerary and directions · Not live' };
  const flights = [...message.toUpperCase().matchAll(/\b([A-Z]{2,3})\s?(\d{1,4})\b/g)];
  if (flights.some(([, airline, number]) => airline !== 'CL' || !['204', '310'].includes(number))) {
    return { ...base, reply: 'This connection demo covers only fictional CL 204 to Haneda and CL 310 onward to Seoul Incheon. I cannot verify another itinerary or change a booking.' };
  }
  const arrival = { 'on-time': '2:40 PM', delayed: '3:25 PM', landed: '2:35 PM' }[selected];
  const minutes = { 'on-time': 75, delayed: 30, landed: 80 }[selected];
  const assessment = selected === 'delayed'
    ? 'That leaves 30 minutes from estimated landing to gate closure, less than the demo’s assumed 60-minute transfer allowance; ask the demo transfer desk about options. I cannot guarantee the connection or rebook you.'
    : `That leaves ${minutes} minutes from landing to gate closure against a demo-only 60-minute transfer allowance; this does not guarantee you can make it.`;
  const route = 'Fictional route: arrival corridor → transfer desk → transfer screening → Gate D12, about 25 minutes walking; queues, disembarkation, and border checks can add time. These labels and directions are invented for the demo, not a real Haneda map.';
  const itinerary = `Demo itinerary: CL 204 arrives at Haneda October 13, 2026 at ${arrival} JST (${selected === 'landed' ? 'simulated landing' : 'estimated landing'}). Fictional CL 310 to Seoul Incheon departs at 4:10 PM JST from demo Gate D12, boarding 3:30 PM and gate closure 3:55 PM.`;
  return { ...base, reply: `${itinerary} ${assessment} ${route} ${selected === 'landed' ? 'Landing does not confirm arrival at the gate; wait for crew instructions. ' : ''}All details are simulated, not live airport guidance.`,
    connectionFacts: {
      scenario: selected, inboundFlight: 'CL 204', arrivalAirport: 'HND',
      arrivalDate: '2026-10-13', arrivalTime: arrival, timeZone: 'Asia/Tokyo',
      arrivalBasis: selected === 'landed' ? 'simulated landing' : 'estimated landing',
      onwardFlight: 'CL 310', destination: 'ICN', gate: 'D12',
      boardingTime: '3:30 PM', gateClosure: '3:55 PM', departureTime: '4:10 PM',
      minutesFromLandingToClosure: minutes, assumedTransferMinutes: 60,
      assessment: selected === 'delayed' ? 'less than assumed transfer allowance' : 'above assumed allowance; not a guarantee',
      route: ['arrival corridor', 'transfer desk', 'transfer screening', 'Gate D12'],
      walkingMinutes: 25, excludes: ['disembarkation', 'queues', 'border checks'],
      simulated: true, guaranteesConnection: false, changesBooking: false,
    },
  };
}
