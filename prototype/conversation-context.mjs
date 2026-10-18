import { reminderIntent } from './reminders.mjs';
// Parse identifiers without treating ordinary timing phrases as airline codes.
const ordinaryWords = new Set(['IN','AT','FOR','THE','AND','TO','ON','BY','OF','IS','ARE','HAS','CAN','NOT']);
export function parseFlightId(message='') {
 for (const match of message.matchAll(/\b([a-z]{2,3})( ?)([0-9]{1,4})\b/gi)) {
  const code=match[1].toUpperCase();
  if(ordinaryWords.has(code))continue;
  const explicit=/\bflight\s*$/i.test(message.slice(0,match.index));
  if(match[2] && match[1]!==code && code!=='CL' && !explicit)continue;
  return code+match[3];
 }
 return null;
}
export const isFollowUp = message => /^(?:and\b|what about\b|how many\b|is it still\b|does that\b|same\b|what if\b)/i.test(message.trim());
export function priorUserTurns(message,history=[]) {
 const turns=history.filter(t=>t.role==='user'&&typeof t.content==='string');
 if(turns.at(-1)?.content===message)turns.pop();
 return turns;
}
export function conversationContext(message,history,requiredTools,scope) {
 let flightId=parseFlightId(message);
 if(!flightId&&isFollowUp(message)){
  const previous=priorUserTurns(message,history);
  for(let i=previous.length-1;i>=0;i--){
   flightId=parseFlightId(previous[i].content);
   if(flightId||!isFollowUp(previous[i].content))break;
  }
 }
 return {flightId:flightId||'CL204',requiredTools,scenario:['on-time','delayed','landed'].includes(scope.scenario)?scope.scenario:'unsupported',fare:['basic','standard','business'].includes(scope.fare)?scope.fare:'unsupported',inventory:['available','limited','unavailable'].includes(scope.inventory)?scope.inventory:'unsupported',followUp:isFollowUp(message)};
}

export function reminderNeedsNoStatus(message) {
 if(!reminderIntent(message))return false;
 // A reminder to check boarding later is not a request to look up boarding now.
 const clauses=message.split(/[.!?;]|\b(?:and|also|plus|but|then)\b/i);
 return !clauses.some(clause=>! /\b(remind|reminder|notify|alert)\b/i.test(clause)&&
  /\b(status|delayed?|late|landed|arrival|departure|boarding|on[ -]time|schedule|timetable)\b/i.test(clause)&&
  /\b(check|tell|what|when|whether|are|is|have|has|lookup|look up)\b/i.test(clause));
}
