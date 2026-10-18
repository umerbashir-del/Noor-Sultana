import { parseFlightId, isFollowUp, priorUserTurns } from './conversation-context.mjs';
import { translationIntent } from './translator.mjs';
import { urgentCrew } from './crew.mjs';
import { demoScope } from './tool-executor.mjs';
export const protectedTools = ['flight_status','baggage_allowance','meals_and_services'];
export function requiredEvidence(message,history=[]) {
 if(urgentCrew(message))return [];
 const mixed=/\b(?:and|also|plus)\b.*\b(?:what|when|how|is|are|check|remind|email)\b/i.test(message);
 if(!mixed&&(translationIntent(message)||/\b(remind me|reminder|email|e-mail)\b/i.test(message)))return [];
 const needed=[];
 const connection=/\b(connection|connecting|next flight|onward|transfer|layover)\b/i.test(message);
 const statusParaphrase=/\bstatus\b.*\bflight\b|\bflight\b.*\bstatus\b|\bwhat time\b.*\b(board|depart|arriv|land)\w*\b|\b(?:we|flight)\b.*\blate\b|\b(?:have|has)\b.*\barrived\b/i.test(message);
 const weatherOnly=/\b(weather|forecast|temperature)\b/i.test(message)&&!/\bflight status\b/i.test(message);
 if(statusParaphrase&&!connection&&!weatherOnly)needed.push('flight_status');
 if(!weatherOnly&&(!connection||/\bflight status\b/i.test(message))&&/\b(flight status|delay(?:ed)?|on[ -]time|on schedule|landed|touched down|boarding|departure|arrival time)\b|\bwhen\b.*\b(board|depart|arriv|land)\w*\b|\b(leaving|leave)\b.*\b(schedule|time)\b/i.test(message))needed.push('flight_status');
 const baggageQuestion=message.split(/\b(?:and|also|plus)\b|[?;]/i).filter(clause=>!/\b(chargers?|power[ -]?banks?|batter(?:y|ies)|liquids?|restricted items?)\b/i.test(clause)).join(' and ');
 if(/\b(baggage|luggage|bags?|suitcases?|carry[ -]?on)\b/i.test(baggageQuestion)&&/\b(allowance|include[ds]?|ticket|fare|checked|carry[ -]?on|size|weight|weigh|heavy|limit|many|much|fee|bring|take)\b/i.test(baggageQuestion)&&!/\b(claim|carousel|missing|lost|damaged|collect)\b/i.test(baggageQuestion))needed.push('baggage_allowance');
 if(/\b(meals?|menu|vegetarian|vegan|halal|kosher|allerg\w*|drinks?|snacks?|wi[ -]?fi|internet|food|coffee|tea|water|blankets?|pillows?)\b/i.test(message)&&!/\b(bring|request|get me|could i have|can i have)\b/i.test(message))needed.push('meals_and_services');
 if(!needed.length&&isFollowUp(message)){
  const previous=priorUserTurns(message,history);
  const last=previous.pop();
  if(last)return requiredEvidence(last.content,previous);
 }
 return [...new Set(needed)];
}
export function claimedEvidence(reply) {
 const needed=[];
 if(/\b(?:flight|we|CL ?204) (?:is|are|has|have) (?:on time|delayed|landed)|\b(?:boarding|departure|arrival) (?:is|at) \d/i.test(reply))needed.push('flight_status');
 if(/\b(?:\d+|one|two|no) checked bags?\b|\b(?:baggage|carry-on).{0,30}\d+\s*kg/i.test(reply))needed.push('baggage_allowance');
 if(/\b(?:vegetarian|meal|drinks?|wi-fi).{0,30}(?:available|unavailable|\d+ portions)|\b(?:we (?:have|offer)).{0,30}(?:vegetarian|meals?)/i.test(reply))needed.push('meals_and_services');
 return needed;
}
export function requestedFlight(message,context={}) {
 return parseFlightId(message)||context.evidenceFlight||'CL204';
}
export function matchingEvidence(tool,records,context,message,now=Date.now()) {
 const expected=demoScope(context),flight=requestedFlight(message,context);
 return [...records].reverse().find(record=>{
  if(record.tool!==tool||record.status!=='ok'||record.simulated!==true||record.scope?.flightId!==flight||record.scope?.scenario!==expected.scenario)return false;
  const age=now-Date.parse(record.observedAt);
  if(!Number.isFinite(age)||age<0||age>120000||!record.facts||typeof record.facts!=='object')return false;
  const f=record.facts;
  if(tool==='flight_status')return f.flightId===flight&&f.status===expected.scenario&&['boarding','departure','arrival'].every(k=>typeof f[k]==='string');
  if(tool==='baggage_allowance')return typeof f.fareLabel==='string'&&Number.isSafeInteger(f.checkedDimensionsTotalCm)&&[f.cabinDimensionsCm,f.personalDimensionsCm].every(a=>Array.isArray(a)&&a.length===3&&a.every(n=>Number.isSafeInteger(n)&&n>0))&&record.scope.fare===expected.fare&&f.fare===expected.fare&&f.flightId===flight&&['checkedBags','checkedKgEach','cabinKg'].every(k=>Number.isSafeInteger(f[k])&&f[k]>=0);
  if(tool==='meals_and_services')return f.servicePlan&&Number.isSafeInteger(f.servicePlan.mainMealMinutesAfterTakeoff)&&Number.isSafeInteger(f.servicePlan.snackMinutesBeforeArrival)&&['wifiAvailable','seatbackMovies','usbCharging','drinksAvailable'].every(k=>typeof f[k]==='boolean')&&record.scope.inventory===expected.inventory&&f.flightId===flight&&f.stock&&['vegetarian','chicken','snack','blanket','pillow'].every(k=>Number.isSafeInteger(f.stock[k])&&f.stock[k]>=0)&&f.serviceStatus===(expected.scenario==='landed'?'ended':expected.inventory==='unavailable'?'unavailable':'available');
  return false;
 });
}
export function renderEvidence(record,message) {
 const f=record.facts;
 if(record.tool==='flight_status')return `Fictional CL 204 demo: ${f.status==='on-time'?'On time':f.status==='delayed'?'Delayed by '+f.delayMinutes+' minutes':'Landed'}. Boarding: October 12, 2026 at ${f.boarding}, Gate ${f.gate}; departure: ${f.departure}; ${f.status==='landed'?'landed':'estimated arrival'}: October 13 at ${f.arrival}. This is simulated, not live flight status.${f.status==='landed'?' Landing does not confirm arrival at the gate; follow crew instructions.':''}`;
 if(record.tool==='baggage_allowance')return `Fictional CL 204 demo, ${f.fareLabel}: ${f.checkedBags===0?'No checked bag is included':f.checkedBags+' checked bag'+(f.checkedBags>1?'s are':' is')+' included, up to '+f.checkedKgEach+' kg each and '+f.checkedDimensionsTotalCm+' cm total dimensions'}. Cabin allowance: one carry-on up to ${f.cabinKg} kg (${f.cabinDimensionsCm.join(' × ')} cm) and one personal item (${f.personalDimensionsCm.join(' × ')} cm). This is fictional policy, not real ticket verification; extra fees are unverified and nothing is purchased.`;
 if(f.serviceStatus==='ended')return 'Fictional CL 204 demo: onboard meal and cabin service has ended in the Landed scenario. Nothing is ordered or reserved.';
 const parts=[];
 if(/\b(when|time|schedule)\b/i.test(message))parts.push('The demo plan offers the main meal '+f.servicePlan.mainMealMinutesAfterTakeoff+' minutes after takeoff and a snack '+f.servicePlan.snackMinutesBeforeArrival+' minutes before arrival; these are timing assumptions, not a current crew announcement.');
 const dietary=/\b(allerg\w*|vegan|halal|kosher|gluten|ingredients?|nuts?|dairy)\b/i.test(message);
 if(dietary)parts.push('Dietary safety, ingredients, and vegan/halal/kosher suitability are unverified; ask actual cabin crew before relying on a meal.');
 if(!/\b(wi[ -]?fi|internet|drinks?|coffee|tea|water|blankets?|pillows?)\b/i.test(message)||/\b(meal|food|vegetarian|menu|snack)\b/i.test(message))parts.push(`Vegetarian tomato pasta: ${f.stock.vegetarian} portions; chicken with rice: ${f.stock.chicken}; fruit snacks: ${f.stock.snack}. ${f.serviceStatus==='unavailable'?'All modeled meal stock is unavailable.':f.stock.vegetarian===1?'Stock is limited.':'Sample stock shown.'}`);
 if(/\b(wi[ -]?fi|internet|movies?|charging|amenities)\b/i.test(message))parts.push('Wi-Fi is '+(f.wifiAvailable?'available':'unavailable')+'; sample amenities include '+[f.seatbackMovies?'seatback movies':null,f.usbCharging?'USB charging':null].filter(Boolean).join(' and ')+'.');
 if(/\b(drinks?|coffee|tea|water|juice)\b/i.test(message))parts.push(f.drinksAvailable?'Sample drinks: water, tea, coffee and apple juice.':'Sample drinks service is unavailable.');
 if(/\b(blankets?|pillows?)\b/i.test(message))parts.push(`${f.stock.blanket} blankets and ${f.stock.pillow} pillows available in the sample stock.`);
 return 'Fictional CL 204 demo: '+parts.join(' ')+' Inventory is simulated; nothing is ordered or reserved.';
}
export function verifiedAnswer(needed,records,context,message) {
 const missing=[],parts=[],ids=[];
 for(const tool of needed){
  const record=matchingEvidence(tool,records,context,message);
  if(record){parts.push(renderEvidence(record,message));ids.push(record.id);}
  else missing.push(tool);
 }
 if(missing.length)parts.push('I cannot verify '+missing.map(tool=>({flight_status:'the requested flight status',baggage_allowance:'the requested baggage allowance',meals_and_services:'the requested meal or service availability'})[tool]).join(' and ')+' from matching tool evidence. Please ask cabin crew or the airline for actual travel information.');
 // Preserve other completed parts of a multi-tool request, without trusting model-written protected claims.
 for(const record of records)if(!protectedTools.includes(record.tool)&&!['unsupported','unavailable'].includes(record.status)&&record.reply&&!parts.includes(record.reply))parts.push(record.reply);
 return {reply:parts.join(' '),missing,evidenceIds:ids};
}

