import { randomUUID } from 'node:crypto';
import { validateToolInput,canonicalFlight } from './tool-contracts.mjs';
import { flightStatusReply,normalizeScenario } from './flight-status.mjs';
import { flightTrackingReply } from './fr24.mjs';
import { connectionReply } from './connection.mjs';
import { baggageAllowanceReply,baggagePolicies } from './baggage.mjs';
import { mealServiceReply,mealStocks } from './meals.mjs';
import { airportGuideReply,airportDestinations } from './airport-guide.mjs';
import { crewReply,urgentCrew } from './crew.mjs';
import { reminderReply } from './reminders.mjs';
import { translationReply } from './translator.mjs';
import { getWeather,getWeatherForPlace,weatherReply } from './weather.mjs';
import { findKnowledge, findKnowledgeByReferences } from './knowledge.mjs';
import { createArrivalEmailDraft,fixedArrivalNote } from './email-draft.mjs';

export function demoScope(context={}) {
 return {flightId:'CL204',scenario:normalizeScenario(context.demoScenario),fare:context.demoFare??'standard',inventory:context.demoMealStock??'available'};
}
function packet(tool,{status='ok',facts={},scope={},simulated=true,limitations=[],confirmationRequired=false,source='Noor fictional demo',...ui}) {
 return {id:randomUUID(),tool,status,facts,scope,simulated,limitations,confirmationRequired,source,observedAt:new Date().toISOString(),...ui};
}
function unsupported(tool,reply,scope={}) {
 return packet(tool,{status:'unsupported',facts:null,scope,limitations:[reply],reply,expression:'thoughtful'});
}
function cleanFlight(id){return canonicalFlight(id);}
export async function executePassengerTool(name,input,context={}) {
 validateToolInput(name,input);
 const scope=demoScope(context);
 const result=(data)=>packet(name,{scope,...data});
 const limitFlight=(id)=>cleanFlight(id)!=='CL204';
 switch(name){
 case 'flight_status':{
  if(limitFlight(input.flightId))return unsupported(name,'This demo cannot verify another flight; only fictional CL 204 is supported.',{flightId:cleanFlight(input.flightId)});
  const scenario=scope.scenario;
  const times={
   'on-time':{status:'on-time',boarding:'10:45 AM EDT',departure:'11:30 AM EDT',arrival:'2:40 PM JST',delayMinutes:0},
   delayed:{status:'delayed',boarding:'11:30 AM EDT',departure:'12:15 PM EDT',arrival:'3:25 PM JST',delayMinutes:45},
   landed:{status:'landed',boarding:'10:45 AM EDT',departure:'11:30 AM EDT',arrival:'2:35 PM JST',delayMinutes:0},
  };
  return result({...flightStatusReply('CL204',scenario),facts:{...times[scenario],flightId:'CL204',origin:'JFK',destination:'HND',gate:'32',departureDate:'2026-10-12',arrivalDate:'2026-10-13'},limitations:['Simulated status, not live flight data.']});
 }
 case 'flight_tracking':{
  const data=await flightTrackingReply();
  return result({...data,status:data.tracking?'ok':'unavailable',facts:data.tracking||null,scope:{provider:'FR24-sandbox'},source:'FR24 sandbox',limitations:['Fixed sample, not CL 204 tracking or proof of arrival.']});
 }
 case 'connection_assistant':{
  if(cleanFlight(input.inboundFlight)!=='CL204'||cleanFlight(input.onwardFlight)!=='CL310')return unsupported(name,'This connection demo cannot verify another itinerary; only fictional CL 204 and CL 310 are supported.',{flightId:cleanFlight(input.inboundFlight),onwardFlight:cleanFlight(input.onwardFlight)});
  const data=connectionReply('Will I make my connection?',scope.scenario);
  return result({...data,scope:{...scope,onwardFlight:'CL310'},facts:data.connectionFacts,limitations:['Invented route and transfer allowance. No connection guarantee or rebooking.']});
 }
 case 'baggage_allowance':{
  if(limitFlight(input.flightId))return unsupported(name,'The demo cannot verify baggage on another flight or an onward connection.',{flightId:cleanFlight(input.flightId)});
  const policy=baggagePolicies[scope.fare];
  if(!Object.hasOwn(baggagePolicies,scope.fare))return unsupported(name,'The selected demo fare is unsupported; no allowance can be verified.',scope);
  return result({...baggageAllowanceReply('Baggage allowance',scope.fare),facts:{flightId:'CL204',fare:scope.fare,fareLabel:policy.label,checkedBags:policy.checked,checkedKgEach:policy.checkedKg,checkedDimensionsTotalCm:158,cabinBags:1,cabinKg:policy.cabinKg,cabinDimensionsCm:[55,40,23],personalItems:1,personalDimensionsCm:[40,30,15],feesVerified:false},limitations:['Fictional policy only. No real ticket verification, extra-fee quote or purchase.']});
 }
 case 'meals_and_services':{
  if(limitFlight(input.flightId))return unsupported(name,'The demo cannot verify meals on another flight or connection.',{flightId:cleanFlight(input.flightId)});
  if(!Object.hasOwn(mealStocks,scope.inventory))return unsupported(name,'The selected demo inventory is unsupported.',scope);
  const stock=mealStocks[scope.inventory],ended=scope.scenario==='landed';
  const questions={all:'menu',menu:'menu',drinks:'drinks',comfort:'blankets available',amenities:'Wi-Fi',dietary:'dietary allergies',service_times:'When is the meal?'};
  const data=mealServiceReply(questions[input.category],scope.inventory,scope.scenario);
  const reply=input.category==='all'&&!ended ? data.reply+' '+mealServiceReply('Wi-Fi',scope.inventory,scope.scenario).reply : data.reply;
  return result({...data,reply,facts:{flightId:'CL204',serviceStatus:ended?'ended':scope.inventory==='unavailable'?'unavailable':'available',stock:ended?{vegetarian:0,chicken:0,snack:0,blanket:0,pillow:0}:stock,drinksAvailable:!ended&&scope.inventory!=='unavailable',drinks:['water','tea','coffee','apple juice'],wifiAvailable:false,seatbackMovies:true,usbCharging:true,dietarySafetyVerified:false,specialMealBookingVerified:false,servicePlan:{mainMealMinutesAfterTakeoff:60,snackMinutesBeforeArrival:120}},limitations:['Simulated inventory. Nothing reserved or ordered. Dietary safety/certification unverified.']});
 }
 case 'airport_guide':{
  if(!['HND','RJTT'].includes(input.airport))return unsupported(name,'This guide covers only an invented Haneda layout, not that airport.',{airport:input.airport});
  const ids={baggage_claim:'baggage',toilets:'toilets',accessibility:'accessibility',ground_transport:'transport',information:'information'};
  const item=airportDestinations.find(d=>d.id===ids[input.destination]);
  return result({...airportGuideReply(item.name),scope:{airport:'HND',destination:input.destination},facts:{destination:item.name,route:item.route,walkingMinutes:item.minutes},limitations:['Not a real airport map or actual carousel assignment.']});
 }
 case 'prepare_crew_request':{
  const original=context.originalMessage||input.details;
  const data=crewReply(original,context.local!==false||context.hostedActions===true);
  const enabled=Boolean(data.crewAssistance);
  return result({...data,status:enabled?'needs_confirmation':urgentCrew(original)?'unsupported':'unavailable',facts:{seat:'12A',category:input.category,details:input.details,submitted:false},confirmationRequired:enabled,...(enabled?{crewProposal:{seat:'12A',category:input.category,details:input.details}}:{}),limitations:['No real crew contacted. Passenger must review and confirm.']});
 }
 case 'prepare_reminder':{
  const data=reminderReply(context.local!==false||context.hostedActions===true),enabled=Boolean(data.passengerReminders);
  return result({...data,status:enabled?'needs_confirmation':'unavailable',facts:{kind:input.kind,delayMinutes:input.delayMinutes??null,saved:false},confirmationRequired:enabled,...(enabled?{reminderProposal:{kind:input.kind,delayMinutes:input.delayMinutes??null}}:{}),limitations:['Manual in-app reminder only; page/session must remain active.']});
 }
 case 'translate_travel_phrase':{
  const data=translationReply('Translate '+input.phrase+' into '+input.language,input.language);
  return result({...data,status:data.translation?'ok':'unsupported',facts:data.translation||null,scope:{language:input.language},simulated:false,source:'Fixed demo travel phrasebook',limitations:['Fixed phrases only; pronunciation approximate.']});
 }
 case 'weather':{
  try{
   const airport=/^(JFK|HND|Haneda)$/i.test(input.location);
   if(input.when==='arrival'&&!/^(HND|Haneda)$/i.test(input.location))return unsupported(name,'Arrival forecast is supported only for the fictional Haneda arrival.',{location:input.location,when:input.when});
   const weather=airport?await getWeather(/^JFK$/i.test(input.location)?'jfk':'hnd',input.when==='arrival'?'arrival':'now'):await getWeatherForPlace(input.location);
   return result({reply:weatherReply(weather),weather,facts:weather,scope:{location:weather.location,when:input.when},simulated:false,source:'Open-Meteo',limitations:['Model weather, not aviation safety guidance.']});
  }catch{return result({status:'unavailable',facts:null,reply:'Checked weather is unavailable right now; I cannot verify these conditions.',simulated:false,source:'Open-Meteo',limitations:['Provider unavailable or unsupported place/time.']});}
 }
 case 'passenger_guidance':{
  const knowledge=context.guidanceReferences?.length?await findKnowledgeByReferences(context.guidanceReferences):await findKnowledge(context.guidanceQuestion||input.question);
  return result({status:knowledge?'ok':'unsupported',facts:knowledge?{passages:knowledge.passages.map(p=>({citationId:p.source.citationId,section:p.question,excerpt:p.excerpt,source:p.source})),retrieval:knowledge.retrieval}:null,reply:knowledge?'Draft general guidance, not approved airline policy: '+knowledge.passages.map(p=>'['+p.source.citationId+'] '+p.question+' '+p.excerpt).join(' '):'No matching draft passenger guidance was found; I cannot verify this from the available documents.',...(knowledge?{knowledgeSources:knowledge.sources}:{}),source:'Draft passenger guidance',limitations:['Not approved airline policy or evidence of a ticket allowance, live flight status, current availability, dietary safety, or permission to act.','No verified effective dates or official policy links are available in these drafts.']});
 }
 case 'arrival_note':return result({reply:fixedArrivalNote,facts:{note:fixedArrivalNote},limitations:['General demo note, not live airport guidance.']});
 case 'prepare_arrival_email':{
  const enabled=context.local!==false;
  return result({status:enabled?'needs_confirmation':'unavailable',reply:enabled?'Review the fixed arrival email. Nothing has been sent or scheduled.':'Email scheduling is unavailable in this hosted preview.',facts:{sent:false,scheduled:false},confirmationRequired:enabled,...(enabled?{emailDraft:createArrivalEmailDraft()}:{}),limitations:['Passenger must verify address, review, and confirm.']});
 }
 }
}

