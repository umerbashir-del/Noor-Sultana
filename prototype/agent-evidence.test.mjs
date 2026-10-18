import test from 'node:test';
import assert from 'node:assert/strict';
import { answerWithTools,executePassengerTool,passengerTools } from './agent.mjs';
import { matchingEvidence } from './evidence.mjs';
import { createTraceStore } from './trace-store.mjs';
const modelText=reply=>({content:[{type:'text',text:JSON.stringify({reply,expression:'thoughtful'})}]});
const tool=(name,input)=>({type:'tool_use',id:'tool-'+name,name,input});
async function toolThenAnswer(message,name,input,reply,context={}){
 let calls=0;
 const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[{role:'user',content:message}],context:{...context,originalMessage:message},
  callModel:async()=>++calls===1?{content:[tool(name,input)]}:modelText(reply)});
 return{result,calls};
}
test('a contradictory flight-status answer is replaced with scenario-matched facts',async()=>{
 const {result,calls}=await toolThenAnswer('Are we delayed?','flight_status',{flightId:'CL204'},'We are on time and depart at 11:30 AM.',{demoScenario:'delayed'});
 assert.equal(calls,2);assert.equal(result.evidenceStatus,'grounded');
 assert.match(result.reply,/Delayed by 45 minutes/);
 assert.match(result.reply,/12:15 PM EDT/);
 assert.ok(!result.reply.includes('We are on time'));
 assert.equal(result.evidenceIds.length,1);
});
test('baggage answers use the selected fare, not model claims',async()=>{
 const {result}=await toolThenAnswer('Does my ticket include a checked bag?','baggage_allowance',{flightId:'CL204',bagType:'checked'},'Two checked bags are included.',{demoFare:'basic'});
 assert.equal(result.evidenceStatus,'grounded');
 assert.match(result.reply,/No checked bag is included/);
 assert.ok(!result.reply.includes('Two checked'));
});
test('availability answers cannot turn unavailable stock into available stock',async()=>{
 const {result}=await toolThenAnswer('Are vegetarian meals available?','meals_and_services',{flightId:'CL204',category:'menu'},'There are 12 portions available.',{demoMealStock:'unavailable'});
 assert.equal(result.evidenceStatus,'grounded');
 assert.match(result.reply,/pasta: 0 portions/);
 assert.match(result.reply,/unavailable/);
 assert.ok(!result.reply.includes('12 portions'));
});
test('missing evidence gets one correction then an honest limitation',async()=>{
 const store=createTraceStore({dbPath:':memory:',toolNames:passengerTools.map(t=>t.name)});
 let calls=0;
 try{
  const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[{role:'user',content:'Are we delayed?'}],traceFactory:()=>store.start(),
   callModel:async()=>{calls++;return modelText('We are on time.');}});
  assert.equal(calls,2);assert.equal(result.evidenceStatus,'limited');
  assert.match(result.reply,/cannot verify/);
  assert.ok(!result.reply.includes('We are on time'));
  assert.equal(store.read().filter(e=>e.event==='evidence_repair').length,1);
 }finally{store.close();}
});
test('the correction can obtain evidence without forcing ordinary greetings to use tools',async()=>{
 let calls=0;
 const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[{role:'user',content:'What is my baggage allowance?'}],
 callModel:async(args)=>{
  if(++calls===1)return modelText('One checked bag is included.');
  if(calls===2){assert.match(args.messages.at(-1).content,/Harness verification/);return{content:[tool('baggage_allowance',{flightId:'CL204',bagType:'all'})]};}
  return modelText('One checked bag is included.');
 }});
 assert.equal(calls,3);assert.equal(result.evidenceStatus,'grounded');
 let greetings=0;
 const greeting=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[{role:'user',content:'Hello'}],callModel:async()=>{greetings++;return modelText('Welcome aboard.');}});
 assert.equal(greetings,1);assert.equal(greeting.evidenceStatus,'not_required');
});
test('wrong flight, fare, scenario, stale timestamp, and failed tool statuses are not evidence',async()=>{
 const record=await executePassengerTool('baggage_allowance',{flightId:'CL204',bagType:'all'},{demoFare:'standard'});
 for(const patch of [
  {scope:{...record.scope,flightId:'NH110'}},{scope:{...record.scope,fare:'business'}},
  {scope:{...record.scope,scenario:'delayed'}},{observedAt:new Date(Date.now()-180000).toISOString()},
  {status:'unavailable'},{status:'unsupported'},
 ]){
  assert.equal(matchingEvidence('baggage_allowance',[{...record,...patch}],{},'What is my baggage allowance?'),undefined);
 }
 assert.ok(matchingEvidence('baggage_allowance',[record],{},'What is my baggage allowance?'));
 assert.equal(matchingEvidence('baggage_allowance',[record],{},'NH110 baggage allowance?'),undefined);
});
test('an invalid argument receives field-specific repair feedback and only one retry',async()=>{
 let calls=0;
 const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[{role:'user',content:'What is my baggage allowance?'}],
 callModel:async(args)=>{
  calls++;
  if(calls===2){
   const feedback=JSON.parse(args.messages.at(-1).content[0].content);
   assert.equal(feedback.code,'invalid_arguments');
   assert.ok(feedback.fields.some(f=>f.field==='flightId'));
  }
  return{content:[tool('baggage_allowance',{flightId:2,bagType:'all'})]};
 }});
 assert.equal(calls,2);assert.equal(result.evidenceStatus,'limited');
 assert.match(result.reply,/cannot verify/);
});
test('a partial multi-topic answer cannot hide missing evidence for the other topic',async()=>{
 let calls=0;
 const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[{role:'user',content:'What is my baggage allowance and are vegetarian meals available?'}],
 callModel:async()=>++calls===1?{content:[tool('baggage_allowance',{flightId:'CL204',bagType:'all'})]}:modelText('One bag is included and vegetarian meals are available.')});
 assert.equal(result.evidenceStatus,'limited');
 assert.match(result.reply,/1 checked bag/);
 assert.match(result.reply,/cannot verify the requested meal/);
 assert.ok(!result.reply.includes('vegetarian meals are available'));
});
test('an unsolicited protected factual claim is checked even when the user only greeted Noor',async()=>{
 let calls=0;
 const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[{role:'user',content:'Hello'}],callModel:async()=>{calls++;return modelText('Hello, we are on time.');}});
 assert.equal(calls,2);assert.equal(result.evidenceStatus,'limited');assert.ok(!result.reply.includes('we are on time'));
});
test('follow-up questions require fresh evidence for the current selected fare',async()=>{
 let calls=0;
 const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',context:{demoFare:'business'},messages:[{role:'user',content:'What is my baggage allowance?'},{role:'assistant',content:'The previous fare included one bag.'},{role:'user',content:'And how many?'}],
 callModel:async()=>++calls===1?{content:[tool('baggage_allowance',{flightId:'CL204',bagType:'all'})]}:modelText('One checked bag is included.')});
 assert.equal(result.evidenceStatus,'grounded');assert.match(result.reply,/2 checked bags/);
});


test('protected facts remain checked in a mixed reminder-and-status request',async()=>{
 let calls=0;
 const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[{role:'user',content:'What is our flight status, and remind me to check boarding?'}],
 callModel:async()=>++calls===1?{content:[tool('prepare_reminder',{kind:'boarding'})]}:modelText('We are on time and your reminder is saved.')});
 assert.equal(result.evidenceStatus,'limited');
 assert.match(result.reply,/cannot verify/);
 assert.match(result.reply,/Nothing has been submitted/);
 assert.ok(!result.reply.includes('your reminder is saved'));
});
test('preparation replies never claim an action succeeded before confirmation',async()=>{
 const {result}=await toolThenAnswer('Please remind me before boarding','prepare_reminder',{kind:'boarding'},'Your reminder is saved.');
 assert.equal(result.passengerReminders,true);
 assert.ok(!result.reply.includes('Your reminder is saved'));
 assert.match(result.reply,/Nothing has been submitted/);
});
test('weather questions do not require unrelated flight-status evidence',async()=>{
 let calls=0;
 const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[{role:'user',content:'What is the weather at departure?'}],callModel:async()=>{calls++;return modelText('I cannot verify a departure forecast in this demo.');}});
 assert.equal(calls,1);
 assert.equal(result.evidenceStatus,'not_required');
});
test('meal timing is rendered from structured service-plan facts',async()=>{
 const {result}=await toolThenAnswer('When is the meal service?','meals_and_services',{flightId:'CL204',category:'service_times'},'The meal starts in ten minutes.');
 assert.equal(result.evidenceStatus,'grounded');
 assert.match(result.reply,/60 minutes after takeoff/);
 assert.ok(!result.reply.includes('ten minutes'));
});

test('demo button wording and common status paraphrases require evidence',async()=>{
 for(const message of ['What is the status of our demo flight?','What time do we land?','Are we late?','Have we arrived?']){
  let calls=0;
  const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[{role:'user',content:message}],callModel:async()=>{calls++;return modelText('CL 204 is on time.');}});
  assert.equal(calls,2,message);
  assert.equal(result.evidenceStatus,'limited',message);
  assert.ok(!result.reply.includes('CL 204 is on time'),message);
 }
});
