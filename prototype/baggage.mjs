export const baggagePolicies = Object.freeze({
  basic: { label: 'Economy Basic', checked: 0, checkedKg: 23, cabinKg: 7 },
  standard: { label: 'Economy Standard', checked: 1, checkedKg: 23, cabinKg: 7 },
  business: { label: 'Business', checked: 2, checkedKg: 32, cabinKg: 10 },
});
export function baggageAllowanceIntent(message) {
  if (/\b(weather|forecast|email|e-mail|fr24|flightradar24)\b/i.test(message)) return false;
  // Tracking, collection, and restricted items keep their existing guidance routes.
  if (/\b(missing|lost|damaged|claim|carousel|collect|liquids?|batter(?:y|ies)|prohibited|restricted)\b/i.test(message)) return false;
  return /\b(baggage|luggage|bags?|suitcases?|carry[ -]?on)\b/i.test(message)
    && /\b(allowance|allow(?:ed)?|include[ds]?|ticket|fare|checked|carry[ -]?on|size|weight|weigh|heavy|limit|many|much|cost|fees?|pay|extra|personal item|bring)\b/i.test(message);
}
export function baggageAllowanceReply(message, fare = 'standard') {
  const base = { expression: 'thoughtful', sourceLabel: 'Demo baggage policy v1 · Fictional Cloudline Air · Not real airline policy' };
  const flights = [...message.toUpperCase().matchAll(/\b([A-Z]{2,3})\s?(\d{1,4})\b/g)];
  if (flights.some(([, airline, number]) => airline !== 'CL' || number !== '204')
      || /\b(connection|connecting|transfer|other airline)\b/i.test(message)) {
    return { ...base, reply: 'This fictional allowance applies only to CL 204, JFK to Haneda. It does not verify an onward flight, another airline, or through-checked baggage; check the operating airline’s rules.' };
  }
  if (!Object.hasOwn(baggagePolicies, fare)) return { ...base, reply: 'Select Economy Basic, Economy Standard, or Business in the demo fare selector, then ask again. I cannot verify your real ticket.' };
  const p = baggagePolicies[fare];
  const checked = p.checked === 0 ? 'No checked bag is included' : `${p.checked} checked bag${p.checked > 1 ? 's are' : ' is'} included, up to ${p.checkedKg} kg each and 158 cm total dimensions (length + width + height)`;
  return { ...base, reply: `Fictional CL 204, JFK → Haneda, selected demo fare: ${p.label}. ${checked}. Cabin allowance: one carry-on up to ${p.cabinKg} kg and 55 × 40 × 23 cm, plus one personal item up to 40 × 30 × 15 cm. Extra-bag and overweight fees are not modeled; I cannot quote a fee, purchase baggage, or change your ticket. These invented demo rules are not real airline policy or an item-safety approval.` };
}
