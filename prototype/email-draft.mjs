export const fixedArrivalNote = `When you arrive, please check that you have your belongings. Follow the airport’s current signs and displays for arrivals, baggage claim, or connections. If you need help, ask airline or airport staff.`;

export function arrivalEmailIntent(message) {
  return /\b(?:e-?mail)\b/i.test(message);
}

export function arrivalNoteIntent(message) {
  return /\barrival note\b/i.test(message) && !arrivalEmailIntent(message);
}

export function createArrivalEmailDraft(journey) {
  return {
    subject: 'Your arrival note — Noor demo',
    body: `Arrival note for the fictional Noor International Airlines ${journey ? journey.flightId.replace(/([A-Z]+)(\d+)/, '$1 $2') + ' JFK → ' + journey.airport : 'CL 204'} flight\n\n${fixedArrivalNote}\n\nThis is a demo message. It does not include live flight or airport information.`,
  };
}
