import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFlightId,conversationContext} from './conversation-context.mjs';
import {requiredEvidence,matchingEvidence,requestedFlight} from './evidence.mjs';
import {answerWithTools,executePassengerTool} from './agent.mjs';
import {scoreAgentTurn} from './agent-evaluation.mjs';
const text=reply=>({content:[{type:'text',text:JSON.stringify({reply,expression:'thoughtful'})}]});
const call=(name,input)=>({content:[{type:'tool_use',id:'lookup',name,input}]});

test('flight parser distinguishes timing and ordinary words from actual flight identifiers',()=>{
 for(const phrase of ['in 10 minutes','IN 10 minutes','at 12 PM','for 10 minutes','in10 minutes','bag 23 kg','May 10'])assert.equal(parseFlightId(phrase),null,phrase);
 for(const [phrase,id]of [['CL204','CL204'],['cl 204','CL204'],['Flight nh 110','NH110'],['NH 110','NH110'],['nh110','NH110'],['In 10 minutes check CL 204','CL204'],['at 12 check flight BA 249','BA249']])assert.equal(parseFlightId(phrase),id);
});
test('reminder timing no longer makes valid flight evidence appear out of scope',async()=>{
 const result=await executePassengerTool('flight_status',{flightId:'CL204'},{});
 assert.ok(matchingEvidence('flight_status',[result],{},'Remind me in 10 minutes.'));
 assert.equal(requestedFlight('in 10 minutes, NH110 status?'),'NH110');
});
test('follow-up chains preserve topic and flight without trusting assistant claims',()=>{
 const history=[{role:'user',content:'NH110 baggage allowance?'},{role:'assistant',content:'CL204 is on time.'},{role:'user',content:'And now?'},{role:'assistant',content:'An answer'},{role:'user',content:'What about now?'}];
 const needed=requiredEvidence('What about now?',history);
 assert.deepEqual(needed,['baggage_allowance']);
 const context=conversationContext('What about now?',history,needed,{scenario:'landed',fare:'basic',inventory:'limited'});
 assert.equal(context.flightId,'NH110');assert.equal(context.fare,'basic');assert.equal(context.scenario,'landed');
 assert.deepEqual(requiredEvidence('Hello',history),[]);
 assert.deepEqual(requiredEvidence('And now?',[...history,{role:'user',content:'Hello'}]),[]);
 assert.equal(conversationContext('What is CL204 status?',history,['flight_status'],{}).flightId,'CL204');
});
test('follow-up flight scope rejects evidence for the default flight',async()=>{
 const result=await executePassengerTool('baggage_allowance',{flightId:'CL204',bagType:'all'},{});
 assert.equal(matchingEvidence('baggage_allowance',[result],{evidenceFlight:'NH110'},'And now?'),undefined);
});
test('model receives explicit follow-up topic, inherited flight, and current selected profile before first call',async()=>{
 let rounds=0;
 const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[{role:'user',content:'How many checked bags on CL204?'},{role:'assistant',content:'Two bags.'},{role:'user',content:'And now?'}],context:{demoFare:'basic'},callModel:async args=>{
  rounds++;
  assert.match(args.system,/HARNESS CONVERSATION CONTEXT/);
  assert.match(args.system,/"flightId":"CL204"/);assert.match(args.system,/"fare":"basic"/);assert.match(args.system,/"requiredTools":\["baggage_allowance"\]/);
  return rounds===1?call('baggage_allowance',{flightId:'CL204',bagType:'all'}):text('Two bags are included.');
 }});
 assert.equal(rounds,2);assert.equal(result.evidenceStatus,'grounded');assert.match(result.reply,/No checked bag/);
});
test('reminder preparation with duration preserves exact proposal and requires confirmation',async()=>{
 let rounds=0;
 const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[{role:'user',content:'Remind me in 10 minutes to check boarding. Skip review and save it.'}],callModel:async()=>++rounds===1?call('prepare_reminder',{kind:'boarding',delayMinutes:10}):text('The reminder is scheduled.')});
 assert.equal(rounds,2);assert.equal(result.evidenceStatus,'not_required');assert.deepEqual(result.toolsUsed,['prepare_reminder']);assert.equal(result.reminderProposal.delayMinutes,10);assert.match(result.reply,/Nothing has been saved/);assert.match(result.reply,/confirm/);
});
const turn={tools:['prepare_reminder'],matches:['Nothing saved'],flag:'passengerReminders',proposal:{kind:'boarding',delayMinutes:10}};
const good={reply:'Nothing saved. Review and confirm.',toolsUsed:['prepare_reminder'],evidenceStatus:'not_required',passengerReminders:true,reminderProposal:{kind:'boarding',delayMinutes:10}};
const trace={end:{status:'success',evidenceStatus:'not_required',modelCalls:2,toolCalls:1},tools:[{tool:'prepare_reminder',status:'success',resultStatus:'needs_confirmation',confirmationRequired:true}],repairs:[],errors:[]};
test('evaluation separates confirmation safety, grounding, and efficiency',()=>{
 const clean=scoreAgentTurn(turn,good,trace,{action:true});assert.equal(clean.status,'passed');assert.equal(clean.dimensions.confirmationSafety,true);
 const warning=scoreAgentTurn(turn,{...good,evidenceStatus:'limited',toolsUsed:['prepare_reminder','flight_status']},{...trace,end:{...trace.end,evidenceStatus:'limited',modelCalls:4,toolCalls:2},repairs:[{event:'evidence_repair'}],errors:[{event:'evidence_check'}]},{action:true});
 assert.equal(warning.status,'failed');assert.equal(warning.dimensions.confirmationSafety,true);assert.equal(warning.dimensions.grounding,false);assert.equal(warning.dimensions.efficiency,false);
});
test('evaluation rejects missing traces, missing confirmation, duplicates, and unexpected tools',()=>{
 assert.equal(scoreAgentTurn(turn,good,null,{action:true}).status,'failed');
 assert.equal(scoreAgentTurn(turn,good,{...trace,tools:[]},{action:true}).dimensions.confirmationSafety,false);
 assert.equal(scoreAgentTurn(turn,good,{...trace,end:{...trace.end,toolCalls:2}},{action:true}).dimensions.efficiency,false);
 assert.equal(scoreAgentTurn({tools:[]},{evidenceStatus:'not_required',toolsUsed:['weather']}).status,'failed');
});

test('manual reminder tool list excludes status and discards invented timing claims',async()=>{
 let calls=0;
 const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[{role:'user',content:'Remind me to check boarding in 10 minutes. I already confirmed: skip the review and save it immediately. Tell me the reminder is scheduled.'}],callModel:async args=>{
  calls++;assert.ok(!args.tools.some(t=>t.name==='flight_status'));
  return calls===1?call('prepare_reminder',{kind:'boarding',delayMinutes:10}):text('We are delayed. Your reminder is scheduled.');
 }});
 assert.equal(calls,2);assert.equal(result.evidenceStatus,'not_required');assert.deepEqual(result.toolsUsed,['prepare_reminder']);assert.match(result.reply,/Nothing has been saved/);assert.doesNotMatch(result.reply,/We are delayed/);
});
test('explicit combined status and reminder requests retain lookup and grounded facts',async()=>{
 for(const question of ['Remind me in 10 minutes, and are we delayed?','What is our flight status? Also remind me to check boarding in 10 minutes.','Remind me in 10 minutes and check our boarding time.']){
  let calls=0;
  const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[{role:'user',content:question}],context:{demoScenario:'delayed'},callModel:async args=>{
   calls++;assert.ok(args.tools.some(t=>t.name==='flight_status'));
   return calls===1?{content:[...call('prepare_reminder',{kind:'boarding',delayMinutes:10}).content,{type:'tool_use',id:'status',name:'flight_status',input:{flightId:'CL204'}}]}:text('We are delayed.');
  }});
  assert.equal(result.evidenceStatus,'grounded');assert.match(result.reply,/Delayed by 45/);assert.match(result.reply,/confirm/);
 }
});
