import test from 'node:test';
import assert from 'node:assert/strict';
import {answerWithTools,executePassengerTool} from './agent.mjs';
const text=reply=>({content:[{type:'text',text:JSON.stringify({reply,expression:'thoughtful'})}]});
const request=(id,name,input)=>({type:'tool_use',id,name,input});
const bags=bagType=>({flightId:'CL204',bagType});
test('acknowledgments preserve context without model calls or tool executions',async()=>{
 for(const message of ['Okay','Thanks!','Got it.','Great']){
  const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[{role:'user',content:message}],context:{sessionMemory:{topics:['baggage_allowance'],preferences:{language:'spanish'}}},callModel:async()=>assert.fail('No model call expected'),execute:async()=>assert.fail('No execution expected')});
  assert.deepEqual(result.toolsUsed,[]);assert.equal(result.evidenceStatus,'not_required');assert.match(result.reply,/De nada/);
 }
});
test('an acknowledgment is not action authorization and mixed messages still perform the requested lookup',async()=>{
 let calls=0;
 const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[{role:'user',content:'Okay, what is our flight status?'}],callModel:async()=>++calls===1?{content:[request('status','flight_status',{flightId:'CL204'})]}:text('We are on time.')});
 assert.equal(calls,2);assert.equal(result.evidenceStatus,'grounded');assert.deepEqual(result.toolsUsed,['flight_status']);
 const acknowledgment=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[{role:'user',content:'Okay'}],context:{sessionMemory:{topics:['prepare_reminder'],confirmed:true}},callModel:async()=>assert.fail('Acknowledgment is not confirmation')});
 assert.equal(acknowledgment.passengerReminders,undefined);assert.ok(!/saved|submitted|scheduled/i.test(acknowledgment.reply));
});
test('a repeated allowance lookup finishes in two model rounds using the complete first result',async()=>{
 let calls=0,executions=0,reuses=0;
 const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[{role:'user',content:'And now?'}],context:{sessionMemory:{topics:['baggage_allowance']},demoFare:'basic'},callModel:async args=>{
  assert.ok(!args.tools.some(t=>t.name==='passenger_guidance'));
  return {content:[request('bags'+ ++calls,'baggage_allowance',bags(calls===1?'checked':'cabin'))]};
 },execute:async(...args)=>{executions++;return executePassengerTool(...args);},traceFactory:()=>({event:(event)=>{if(event==='tool_reuse')reuses++;}})});
 assert.equal(calls,2);assert.equal(executions,1);assert.equal(reuses,1);assert.equal(result.evidenceStatus,'grounded');assert.match(result.reply,/No checked bag/);assert.match(result.reply,/Cabin allowance/);
});
test('duplicates in a batch share the result and separate turns always get fresh allowance facts',async()=>{
 for(const fare of ['basic','business']){
  let calls=0,executions=0;
  const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[{role:'user',content:'What is my baggage allowance?'}],context:{demoFare:fare},callModel:async()=>++calls===1?{content:[request('checked','baggage_allowance',bags('checked')),request('cabin','baggage_allowance',bags('cabin'))]}:text('Bags included.'),execute:async(...args)=>{executions++;return executePassengerTool(...args);}});
  assert.equal(executions,1);assert.equal(result.evidenceStatus,'grounded');assert.match(result.reply,fare==='basic'?/No checked bag/:/2 checked bags/);
 }
});
test('unsupported flights cannot reuse the supported baggage policy',async()=>{
 let calls=0,executions=0;
 await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[{role:'user',content:'What is my baggage allowance?'}],callModel:async()=>++calls===1?{content:[request('one','baggage_allowance',bags('all'))]}:calls===2?{content:[request('two','baggage_allowance',{flightId:'NH110',bagType:'all'})]}:text('Other itinerary unsupported.'),execute:async(...args)=>{executions++;return executePassengerTool(...args);}});
 assert.equal(executions,2);
});
test('guidance remains available for an additional question beyond the allowance',async()=>{
 let calls=0;
 const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[{role:'user',content:'What bags are included, and where can I find guidance on travelling with medication?'}],callModel:async args=>{
  assert.ok(args.tools.some(t=>t.name==='passenger_guidance'));
  return ++calls===1?{content:[request('bags','baggage_allowance',bags('all')),request('guide','passenger_guidance',{question:'travelling with medication'})]}:text('Here is the information.');
 }});
 assert.ok(result.toolsUsed.includes('passenger_guidance'));assert.equal(result.evidenceStatus,'grounded');
});

test('baggage reuse does not bypass validation for malformed subsequent arguments',async()=>{
 let calls=0,executions=0;
 const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[{role:'user',content:'What is my baggage allowance?'}],callModel:async args=>{
  if(++calls===1)return {content:[request('valid','baggage_allowance',bags('all'))]};
  if(calls===2)return {content:[request('invalid','baggage_allowance',{flightId:'CL204',bagType:'not-valid'})]};
  const feedback=JSON.parse(args.messages.at(-1).content[0].content);
  assert.equal(feedback.code,'invalid_arguments');assert.ok(feedback.fields.some(f=>f.field==='bagType'));
  return text('One checked bag is included.');
 },execute:async(...args)=>{executions++;return executePassengerTool(...args);}});
 assert.equal(calls,3);assert.equal(executions,1);assert.equal(result.evidenceStatus,'grounded');
});

test('discarded model claims do not trigger extra evidence lookups after required facts are complete',async()=>{
 let calls=0;
 const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[{role:'user',content:'Is it still available?'}],context:{demoScenario:'landed',sessionMemory:{topics:['meals_and_services']}},callModel:async()=>++calls===1?{content:[request('meal','meals_and_services',{flightId:'CL204',category:'menu'})]}:text('We are landed. Two checked bags are included. Your meal is available.')});
 assert.equal(calls,2);assert.deepEqual(result.toolsUsed,['meals_and_services']);assert.equal(result.evidenceStatus,'grounded');assert.match(result.reply,/service has ended/);assert.ok(!result.reply.includes('Two checked'));
});
