import { cleanGuidanceReferences, guidanceReferencesForQuestion, planGuidanceQuery } from './knowledge.mjs';
import { requiredEvidence } from './evidence.mjs';
import { sessionFlightId, isFollowUp } from './conversation-context.mjs';
import { reminderIntent } from './reminders.mjs';
const topics=new Set(['flight_status','baggage_allowance','meals_and_services','connection_assistant','airport_guide','prepare_reminder','prepare_crew_request','translate_travel_phrase','weather','arrival_note','prepare_arrival_email','passenger_guidance']);
export function cleanSessionMemory(value) {
 const preferences={};
 if(['english','japanese','spanish'].includes(value?.preferences?.language))preferences.language=value.preferences.language;
 if(['brief','detailed'].includes(value?.preferences?.responseLength))preferences.responseLength=value.preferences.responseLength;
 if(['vegetarian','vegan'].includes(value?.preferences?.dietary))preferences.dietary=value.preferences.dietary;
 const flight=value?.flightId;
 const documents=cleanGuidanceReferences(value?.documents);
 return {...(documents.length?{documents}:{}),version:1,topics:Array.isArray(value?.topics)?[...new Set(value.topics.filter(t=>topics.has(t)))].slice(0,3):[],flightId:typeof flight==='string'&&/^[A-Z]{2,3}[0-9]{1,4}$/.test(flight)&&flight!=='FR24'?flight:'CL204',preferences};
}
export function updateSessionMemory(previous,message,sources=[]) {
 const memory=cleanSessionMemory(previous);
 const direct=requiredEvidence(message,[]);
 const documentReferences=guidanceReferencesForQuestion(planGuidanceQuery(message,direct));
 const documentFollowUp=isFollowUp(message)&&memory.documents?.length&&/\b(document|guidance|source|reference)\b/i.test(message);
 if(documentReferences.length){memory.documents=documentReferences;direct.push('passenger_guidance');}
 else if(documentFollowUp){memory.topics=['passenger_guidance'];}
 if(/\b(connection|connecting|onward|layover|next flight)\b/i.test(message))direct.push('connection_assistant');
 if(/\b(baggage claim|carousel|collect my bags|toilets|ground transport|airport guide)\b/i.test(message))direct.push('airport_guide');
 if(reminderIntent(message))direct.push('prepare_reminder');
 if(/\b(help|assistance)\b.*\bseat\b|\bseat\b.*\b(help|assistance)\b/i.test(message))direct.push('prepare_crew_request');
 if(/\b(weather|forecast|temperature)\b/i.test(message))direct.push('weather');
 if(/\btranslate\b|\bhow do I (?:ask|say)\b/i.test(message))direct.push('translate_travel_phrase');
 const language=message.match(/\b(?:please\s+)?(?:answer|reply|speak|respond)(?:\s+to me)?\s+in\s+(English|Japanese|Spanish)\b/i);
 if(language){
  const value=language[1].toLowerCase();
  if(/\b(?:don't|do not|never|not)\s*$/i.test(message.slice(0,language.index))){if(memory.preferences.language===value)delete memory.preferences.language;}
  else memory.preferences.language=value;
 }
 const brief=/\b(?:keep (?:your |the )?(?:answers|replies) (?:short|brief)|(?:use|give me) brief answers)\b/i.test(message);
 const detailed=/\b(?:give me|use|prefer) detailed (?:answers|replies)\b/i.test(message);
 if(brief||detailed)memory.preferences.responseLength=brief?'brief':'detailed';
 const diet=message.match(/\bI (?:am|prefer|eat)\s+(?:a\s+)?(vegetarian|vegan)\b/i);
 if(diet)memory.preferences.dietary=diet[1].toLowerCase();
 const revokedDiet=message.match(/\bI am (?:not|no longer) (vegetarian|vegan)\b/i);
 if(revokedDiet&&memory.preferences.dietary===revokedDiet[1].toLowerCase())delete memory.preferences.dietary;
 const explicitFlight=sessionFlightId(message);if(explicitFlight)memory.flightId=explicitFlight;
 if(direct.length){memory.topics=[...new Set(direct)].slice(0,3);if(!documentReferences.length)delete memory.documents;}
 else if(!isFollowUp(message)&&!language&&!brief&&!detailed&&!diet&&!/^(?:thanks|thank you|ok|okay|hello|hi|great|got it)[.!\s]*$/i.test(message.trim())){memory.topics=[];delete memory.documents;}
 const retrieved=cleanGuidanceReferences((Array.isArray(sources)?sources:[]).map(source=>({id:source?.id,section:source?.section})));
 if(retrieved.length){memory.documents=retrieved;if(!memory.topics.includes('passenger_guidance'))memory.topics=[...memory.topics,'passenger_guidance'].slice(0,3);}
 return cleanSessionMemory(memory);
}
export function memoryForTurn(previous,message,history=[]) {
 let memory=cleanSessionMemory(previous);
 // Bootstrap older sessions from passenger messages only; assistant prose is never memory evidence.
 if(!previous)for(const turn of history)if(turn.role==='user'&&typeof turn.content==='string'&&turn.content!==message)memory=updateSessionMemory(memory,turn.content);
 return updateSessionMemory(memory,message);
}
