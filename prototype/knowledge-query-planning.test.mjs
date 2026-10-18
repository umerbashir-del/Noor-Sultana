import test from 'node:test';import assert from 'node:assert/strict';
import {answerWithTools,executePassengerTool} from './agent.mjs';
import {planGuidanceQuery,findKnowledge} from './knowledge.mjs';
const request=(id,question)=>({type:'tool_use',id,name:'passenger_guidance',input:{question}});
const text=reply=>({content:[{type:'text',text:JSON.stringify({reply,expression:'thoughtful'})}]});
test('query planning preserves charger details and excludes dedicated flight status from document search',async()=>{
 const query=planGuidanceQuery('Are we delayed, and what general guidance applies to packing a portable charger?',['flight_status']);
 assert.match(query,/portable charger/);assert.ok(!query.includes('delayed'));
 assert.equal((await findKnowledge(query)).source.citationId,'baggage:2');
 assert.equal(planGuidanceQuery('And now?',['baggage_allowance']),null);
});
test('separate multi-topic tool requests share one complete document retrieval',async()=>{
 let calls=0,executions=0;
 const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'passenger only',messages:[{role:'user',content:'My suitcase is damaged and I need to travel with medication. What general guidance do your documents have for both?'}],callModel:async()=>++calls===1?{content:[request('bag','damaged suitcase'),request('medication','medication guidance')]}:text('Contact the airline for guidance.'),execute:async(...args)=>{executions++;return executePassengerTool(...args);}});
 assert.equal(calls,2);assert.equal(executions,1);
 for(const id of ['baggage:4','passenger-needs:3'])assert.ok(result.knowledgeSources.some(s=>s.citationId===id));
});
test('a generic model query cannot lose the portable charger from a mixed status request',async()=>{
 let calls=0;
 const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'passenger only',messages:[{role:'user',content:'Are we delayed, and what general guidance applies to packing a portable charger?'}],context:{demoScenario:'delayed'},callModel:async()=>++calls===1?{content:[{type:'tool_use',id:'status',name:'flight_status',input:{flightId:'CL204'}},request('guide','What bags can I bring?')]}:text('Here is the guidance.')});
 assert.equal(result.evidenceStatus,'grounded');assert.match(result.reply,/Delayed by 45/);assert.ok(result.knowledgeSources.some(s=>s.citationId==='baggage:2'));assert.match(result.reply,/not approved airline policy/);
});
test('a repeat retrieval request finishes from checked passages without a third model round',async()=>{
 let calls=0,executions=0;
 const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'passenger only',messages:[{role:'user',content:'My suitcase is damaged and I need to travel with medication.'}],callModel:async()=>({content:[request('retrieval'+ ++calls,calls===1?'damaged suitcase':'medication')]}),execute:async(...args)=>{executions++;return executePassengerTool(...args);}});
 assert.equal(calls,2);assert.equal(executions,1);assert.ok(result.knowledgeSources.some(s=>s.citationId==='baggage:4'));assert.ok(result.knowledgeSources.some(s=>s.citationId==='passenger-needs:3'));
});
test('retrieval results are never reused across turns or unrelated fallback queries',async()=>{
 let executions=0;
 for(let run=0;run<2;run++){
  let calls=0;
  await answerWithTools({apiKey:'offline',model:'claude-test',system:'passenger only',messages:[{role:'user',content:'What about now?'}],callModel:async()=>++calls===1?{content:[request('bag','damaged baggage'),request('medication','medication')]}:text('Ask the airline.'),execute:async(...args)=>{executions++;return executePassengerTool(...args);}});
 }
 assert.equal(executions,4);
});

test('protected status/document requests do not offer an unrequested connection lookup',async()=>{
 let calls=0;
 const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'passenger only',messages:[{role:'user',content:'Are we delayed, and what general guidance applies to packing a portable charger?'}],context:{demoScenario:'delayed'},callModel:async args=>{
  assert.ok(!args.tools.some(t=>t.name==='connection_assistant'));
  return ++calls===1?{content:[{type:'tool_use',id:'status',name:'flight_status',input:{flightId:'CL204'}},request('guide','portable charger')]}:text('Here is the status and guidance.');
 }});
 assert.equal(calls,2);assert.equal(result.evidenceStatus,'grounded');
});
test('explicit connection questions still offer the connection tool',async()=>{
 let calls=0;
 await answerWithTools({apiKey:'offline',model:'claude-test',system:'passenger only',messages:[{role:'user',content:'What is our flight status and will I make my connection?'}],callModel:async args=>{
  calls++;assert.ok(args.tools.some(t=>t.name==='connection_assistant'));
  return calls===1?{content:[{type:'tool_use',id:'status',name:'flight_status',input:{flightId:'CL204'}},{type:'tool_use',id:'connection',name:'connection_assistant',input:{inboundFlight:'CL204',onwardFlight:'CL310'}}]}:text('Check the transfer details.');
 }});
 assert.equal(calls,2);
});


test('charger and unwell retrieval covers both topics without allowance or carousel filler',async()=>{
 const message='Can I put my portable charger in my checked bag, and what should I do if I feel unwell on the flight?';
 const {requiredEvidence}=await import('./evidence.mjs');
 const {updateSessionMemory}=await import('./session-memory.mjs');
 assert.deepEqual(requiredEvidence(message),[]);
 assert.deepEqual(requiredEvidence(message+' Also how many checked bags are included?'),['baggage_allowance']);
 const knowledge=await findKnowledge(planGuidanceQuery(message,requiredEvidence(message)));
 assert.deepEqual(knowledge.sources.map(s=>s.citationId),['baggage:2','on-board:4']);
 const memory=updateSessionMemory(null,message,knowledge.sources);
 assert.deepEqual(memory.documents.map(s=>s.id),['baggage','on-board']);
 let executions=0,rounds=0;
 const result=await answerWithTools({apiKey:'offline',model:'test',system:'scope',messages:[{role:'user',content:message}],execute:async(...args)=>{executions++;assert.equal(args[0],'passenger_guidance');return executePassengerTool(...args);},callModel:async()=>++rounds===1?{content:[request('both','charger guidance')]}:text('Check airline restrictions and alert cabin crew promptly.')});
 assert.equal(executions,1);assert.deepEqual(result.knowledgeSources.map(s=>s.citationId),['baggage:2','on-board:4']);assert.match(result.reply,/cabin crew/);
});
