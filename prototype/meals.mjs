import { urgentCrew } from './crew.mjs';
import { normalizeScenario } from './flight-status.mjs';
export const mealStocks = Object.freeze({
 available: { vegetarian: 12, chicken: 18, snack: 20, blanket: 8, pillow: 6 },
 limited: { vegetarian: 1, chicken: 3, snack: 4, blanket: 1, pillow: 0 },
 unavailable: { vegetarian: 0, chicken: 0, snack: 0, blanket: 0, pillow: 0 },
});
export function mealServiceIntent(message) {
 if (urgentCrew(message) || /\b(weather|forecast|email|e-mail|fr24|flightradar24|airport|terminal|lounge)\b/i.test(message)) return false;
 if (/\b(blanket|pillow)\b/i.test(message) && /\b(bring|send|request|need|want|get me|have a|could i have|can i have)\b/i.test(message)) return false;
 return /\b(meals?|menu|vegetarian|vegan|halal|kosher|gluten|allerg\w*|food|drinks?|snacks?|coffee|tea|water|juice|wi[ -]?fi|internet|entertainment|movies?|charging|power outlets?)\b/i.test(message)
  || (/\b(blankets?|pillows?|cabin service|onboard service)\b/i.test(message) && /\b(available|availability|left|offer|have|lookup|look up|what)\b/i.test(message));
}
export function mealServiceReply(message, availability = 'available', scenario) {
 const base = { expression: 'thoughtful', sourceLabel: 'Demo meal and service lookup · Fictional CL 204 inventory · Read-only' };
 const flights = [...message.toUpperCase().matchAll(/\b([A-Z]{2,3})\s?(\d{1,4})\b/g)];
 if (flights.some(([, airline, number]) => airline !== 'CL' || number !== '204') || /\b(connection|connecting|onward|other airline)\b/i.test(message)) {
  return { ...base, reply: 'This menu and service demo covers fictional CL 204 only. I cannot verify meals or services on another flight or your connection.' };
 }
 if (!Object.hasOwn(mealStocks, availability)) return { ...base, reply: 'Select Available, Limited, or Unavailable in the demo stock selector, then ask again. This is a fictional inventory lookup.' };
 const stock = mealStocks[availability];
 const label = 'Fictional CL 204 demo: ';
 const tail = ' Inventory is simulated and unchanged by this lookup; nothing is reserved, ordered, or sent to crew.';
 if (normalizeScenario(scenario) === 'landed') return { ...base, reply: label + 'the selected flight-status scenario is Landed, so onboard meal and cabin service has ended. This is simulated; follow crew instructions before leaving the aircraft.' + tail };
 if (/\b(allerg\w*|gluten|halal|kosher|vegan|ingredients?|nuts?|dairy)\b/i.test(message)) return { ...base, reply: label + 'the sample menu has a vegetarian pasta option, but ingredient lists, allergen handling, vegan suitability, and halal or kosher certification are not verified. I cannot confirm dietary safety or a special-meal booking; ask cabin crew about the actual meal.' + tail };
 if (/\b(wi[ -]?fi|internet|entertainment|movies?|charging|power outlets?)\b/i.test(message)) return { ...base, reply: label + 'sample services include seatback movies and USB charging; Wi-Fi is shown as unavailable. These are invented amenities, not a connection to an onboard network or a real aircraft configuration.' + tail };
 if (/\b(blankets?|pillows?)\b/i.test(message)) return { ...base, reply: label + `sample comfort stock: ${stock.blanket} blankets and ${stock.pillow} pillows available. To prepare a separate demo crew request, ask for seat or comfort assistance and confirm that request.` + tail };
 if (/\b(drinks?|coffee|tea|water|juice)\b/i.test(message)) return { ...base, reply: label + (availability === 'unavailable' ? 'sample drinks service is unavailable.' : 'sample drinks service offers water, tea, coffee, and apple juice; quantities are not modeled.') + tail };
 if (/\b(when|time|schedule)\b/i.test(message)) return { ...base, reply: label + 'the fictional service plan offers a main meal about one hour after takeoff and a snack about two hours before arrival. These are demo timing assumptions, not a current crew announcement.' + tail };
 return { ...base, reply: label + `sample menu — vegetarian tomato pasta: ${stock.vegetarian} portions; chicken with rice: ${stock.chicken} portions; fruit snack: ${stock.snack} portions available. ${availability === 'unavailable' ? 'All modeled meal stock is unavailable.' : availability === 'limited' ? 'Stock is limited.' : 'Sample stock is available.'}` + tail };
}
