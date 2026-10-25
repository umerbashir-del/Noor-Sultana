import test from 'node:test';
import assert from 'node:assert/strict';
import { journeys, getJourney, journeyStatusFacts, formatJourneyTime } from './journeys.mjs';
import { executePassengerTool } from './tool-executor.mjs';
import { answerWithTools } from './agent.mjs';
import { cleanSessionMemory, updateSessionMemory } from './session-memory.mjs';
import { getJourneyWeather, weatherReply } from './weather.mjs';
import { createSessionStore } from './sessions.mjs';
import { createArrivalEmailDraft } from './email-draft.mjs';

test('approved journey dates, daylight-saving offsets and overnight durations agree', () => {
 assert.deepEqual(journeys.map(j=>[j.id,j.flightId,j.durationMinutes]),[['tokyo','CL204',850],['paris','CL206',435],['dubai','CL208',750],['rome','CL210',500]]);
 for(const j of journeys){
  assert.equal(Date.parse(j.arrivalAt)-Date.parse(j.departureAt),j.durationMinutes*60000);
  assert.equal(Date.parse(j.departureAt)-Date.parse(j.boardingAt),45*60000);
  assert.match(formatJourneyTime(j.departureAt,j.origin.timeZone),/EST/);
  assert.equal(Object.hasOwn(j,'fare'),false);
  const delay=journeyStatusFacts(j,'delayed');
  assert.equal(Date.parse(delay.arrivalAt)-Date.parse(j.arrivalAt),45*60000);
 }
 assert.match(formatJourneyTime(getJourney('paris').arrivalAt,'Europe/Paris'),/7:45 AM/);
 assert.equal(getJourney('PARIS'),null); assert.equal(getJourney('__proto__'),null);
});

test('each journey grounds status, baggage, meals and airport guidance in its own record', async () => {
 for(const j of journeys){
  const ctx={journeyId:j.id,sessionMemory:{journeyId:j.id},originalMessage:'What is our flight status?'};
  let calls=0;
  const answer=await answerWithTools({apiKey:'offline',model:'test',system:'scope',messages:[{role:'user',content:ctx.originalMessage}],context:ctx,callModel:async request=>{
   assert.match(request.system,new RegExp('"flightId":"'+j.flightId+'"'));
   return {content:++calls===1?[{type:'tool_use',id:'status',name:'flight_status',input:{flightId:j.flightId}}]:[{type:'text',text:'{"reply":"We are on time."}'}]};
  }});
  assert.equal(answer.evidenceStatus,'grounded'); assert.match(answer.reply,new RegExp(j.airport)); assert.match(answer.reply,new RegExp(j.date.split(',')[0])); assert.doesNotMatch(answer.reply,/October|Oct 12|Oct 13/);
  for(const [name,input] of [['baggage_allowance',{flightId:j.flightId,bagType:'all'}],['meals_and_services',{flightId:j.flightId,category:'menu'}],['airport_guide',{airport:j.airport,destination:'baggage_claim'}]]){
   const result=await executePassengerTool(name,input,ctx);assert.equal(result.status,'ok');
   if(name!=='airport_guide')assert.equal(result.facts.flightId,j.flightId);
   if(j.id!=='tokyo')assert.doesNotMatch(result.reply,/CL ?204|Haneda|Tokyo/);
  }
  if(j.id==='tokyo'){
   const connection=await executePassengerTool('connection_assistant',{inboundFlight:j.flightId,onwardFlight:j.connection.flightId},ctx);
   assert.equal(connection.status,'ok');assert.match(connection.reply,/Nov 13, 2026/);assert.doesNotMatch(connection.reply,/October|Oct 13/);
  }
  if(j.id!=='tokyo'){
   assert.equal((await executePassengerTool('flight_status',{flightId:'CL204'},ctx)).status,'unsupported');
   assert.equal((await executePassengerTool('airport_guide',{airport:'HND',destination:'toilets'},ctx)).status,'unsupported');
   const connection=await executePassengerTool('connection_assistant',{inboundFlight:j.flightId,onwardFlight:'CL310'},ctx);assert.equal(connection.status,'unsupported'); assert.doesNotMatch(connection.reply,/Haneda|CL ?204/);
  }
  assert.match(createArrivalEmailDraft(j).body,new RegExp(j.airport));
 }
});

test('journey binding survives memory cleanup and is not changed by asking about another flight', () => {
 const store=createSessionStore(),a=store.create('visitor','paris');
 assert.equal(cleanSessionMemory(a.memory).flightId,'CL206');
 const updated=updateSessionMemory(a.memory,'What is CL204 status?');
 assert.equal(updated.journeyId,'paris');
 const b=store.create('visitor','rome');
 assert.notEqual(a.id,b.id);assert.equal(b.messages.length,0);assert.equal(b.memory.journeyId,'rome');
 store.end(a.id);assert.equal(store.get(a.id),null);assert.equal(store.get(b.id),b);
});

test('arrival forecasts use selected arrival and refuse unavailable times before calling a provider', async () => {
 for(const j of journeys){
  let calls=0;
  for(const now of [Date.parse(j.arrivalAt)+1,Date.parse(j.arrivalAt)-8*86400000]){
   await assert.rejects(getJourneyWeather(j.id,'arrival',{now,fetchImpl:async()=>{calls++;throw Error('must not call');}}),/past or outside/);
  }
  assert.equal(calls,0);
 }
});

test('in-window arrival forecasts name the selected airport and use its arrival instant', async () => {
 for(const j of journeys){
  const seconds=Date.parse(j.arrivalAt)/1000;
  const weather=await getJourneyWeather(j.id,'arrival',{now:Date.parse(j.arrivalAt)-86400000,fetchImpl:async url=>{
   assert.equal(url.searchParams.get('timezone'),j.timeZone);
   assert.equal(Number(url.searchParams.get('latitude')),j.latitude);
   return Response.json({timezone:j.timeZone,hourly:{time:[seconds],temperature_2m:[21],weather_code:[0],precipitation_probability:[15]}});
  }});
  assert.equal(weather.sampleArrivalAt,new Date(j.arrivalAt).toISOString());
  assert.match(weatherReply(weather),new RegExp(j.airportName));
  if(j.id!=='tokyo')assert.doesNotMatch(weatherReply(weather),/Haneda|Tokyo/);
 }
});
