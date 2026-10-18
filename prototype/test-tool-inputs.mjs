// Test fixtures only: old human-readable examples are converted to the new public tool contracts.
import { renderEvidence } from './evidence.mjs';
export function fixtureInput(name,query='') {
 const ids=[...query.toUpperCase().matchAll(/\b([A-Z]{2,3})\s?(\d{1,4})\b/g)].map(m=>m[1]+m[2]);
 switch(name){
 case 'flight_status':return{flightId:ids[0]||'CL204'};
 case 'flight_tracking':return{};
 case 'connection_assistant':return{inboundFlight:ids.find(id=>id!=='CL310')||'CL204',onwardFlight:ids.find(id=>id==='CL310')||'CL310'};
 case 'baggage_allowance':return{flightId:ids[0]||'CL204',bagType:'all'};
 case 'meals_and_services':return{flightId:ids[0]||'CL204',category:'all'};
 case 'airport_guide':return{airport:'HND',destination:'baggage_claim'};
 case 'prepare_crew_request':return{category:'seat',details:query||'Seat assistance'};
 case 'prepare_reminder':return{kind:'boarding'};
 case 'translate_travel_phrase':return{phrase:'Where is baggage claim?',language:'japanese'};
 case 'weather':return{location:query||'Tokyo',when:'current'};
 case 'passenger_guidance':return{question:query};
 case 'arrival_note':case 'prepare_arrival_email':return{};
 default:return{query};
 }
}
export function fixtureReply(record){
 if(record.status!=='ok')return record.confirmationRequired?'Nothing has been submitted':record.limitations.join(' ');
 if(['flight_status','baggage_allowance','meals_and_services'].includes(record.tool))return renderEvidence(record,'');
 if(record.tool==='connection_assistant')return record.facts.minutesFromLandingToClosure+' minutes from landing to closure at '+record.facts.gate;
 if(record.tool==='airport_guide')return record.facts.route;
 if(record.tool==='translate_travel_phrase')return record.facts.text;
 return record.facts.note||record.facts.excerpt||'Tool result received.';
}

