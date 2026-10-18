export const flightScenarios = Object.freeze(['on-time', 'delayed', 'landed']);
export function normalizeScenario(value) {
  return flightScenarios.includes(value) ? value : 'on-time';
}
export function flightStatusIntent(message) {
  if (/\b(weather|forecast|temperature|email|e-mail|arrival note|fr24|flightradar24)\b/i.test(message)) return false;
  return /\b(delay(?:ed)?|on[ -]time|landed|flight status|boarding|departure|arrival time)\b/i.test(message)
    || /\bwhen\b.*\b(board|depart|arriv|land|take off)\w*\b/i.test(message);
}
export function flightStatusReply(message, scenario) {
  const selected = normalizeScenario(scenario);
  const base = { expression: 'thoughtful', sourceLabel: 'Demo flight status · Simulated data · Not live', scenario: selected };
  // Only fictional CL 204 belongs to these fixtures.
  const identifiers = [...message.toUpperCase().matchAll(/\b([A-Z]{2,3})\s?(\d{1,4})\b/g)];
  if (identifiers.some(([, airline, number]) => airline !== 'CL' || number !== '204')) {
    return { ...base, reply: 'This simulated status tool covers only fictional Cloudline Air CL 204, JFK to Haneda. I cannot verify the status of that other flight.' };
  }
  const replies = {
    'on-time': 'Demo scenario: On time. Fictional CL 204 boards October 12, 2026 at 10:45 AM EDT at Gate 32, departs at 11:30 AM EDT, and is estimated to arrive October 13 at 2:40 PM JST. These are simulated times, not live flight status.',
    delayed: 'Demo scenario: Delayed by 45 minutes. Fictional CL 204 now boards October 12, 2026 at 11:30 AM EDT at Gate 32 and is estimated to depart at 12:15 PM EDT instead of 11:30 AM; estimated arrival is October 13 at 3:25 PM JST instead of 2:40 PM. This is simulated, not live flight status.',
    landed: 'Demo scenario: Landed. Fictional CL 204 landed at Haneda October 13, 2026 at 2:35 PM JST, five minutes before its scheduled 2:40 PM arrival. Landing does not confirm arrival at the gate or permission to disembark; follow cabin crew instructions. This is simulated, not live flight status.',
  };
  return { ...base, reply: replies[selected] };
}
