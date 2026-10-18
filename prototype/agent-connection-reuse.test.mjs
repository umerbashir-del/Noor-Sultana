import { fixtureInput, fixtureReply } from './test-tool-inputs.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { answerWithTools,executePassengerTool,passengerTools } from './agent.mjs';
import { connectionReply } from './connection.mjs';
import { createTraceStore } from './trace-store.mjs';
const call=(id,query='Will I make my connection?')=>({type:'tool_use',id,name:'connection_assistant',input:fixtureInput('connection_assistant',query)});
const final={content:[{type:'text',text:'{"reply":"Please check the simulated connection details."}'}]};
test('one connection result contains timing, feasibility and directions in every scenario',()=>{
 for(const scenario of ['on-time','delayed','landed']){
  const result=connectionReply('Where do I go?',scenario);
  assert.ok(result.connectionFacts);
  assert.equal(result.connectionFacts.gate,'D12');
  assert.equal(result.connectionFacts.assumedTransferMinutes,60);
  assert.equal(result.connectionFacts.simulated,true);
  assert.equal(result.connectionFacts.guaranteesConnection,false);
  assert.match(result.reply,/minutes from.*gate closure/);
  assert.match(result.reply,/arrival corridor → transfer desk/);
 }
 assert.equal(connectionReply('Connection to NH110').connectionFacts,undefined);
});
test('repeated connection-only calls finish in two model rounds with one tool execution',async()=>{
 const store=createTraceStore({dbPath:':memory:',toolNames:passengerTools.map(t=>t.name)});
 let rounds=0,executions=0;
 try{
  const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[],context:{demoScenario:'delayed'},traceFactory:()=>store.start(),
   callModel:async()=>{
    rounds++;
    if(rounds===1)return{content:[call('one')]};
    if(rounds===2)return{content:[call('two','Where is the gate for CL 310?')]};
    throw new Error('An unnecessary third model round was requested');
   },
   execute:async(...args)=>{executions++;return executePassengerTool(...args);}
  });
  assert.equal(rounds,2);
  assert.equal(executions,1);
  assert.deepEqual(result.toolsUsed,['connection_assistant']);
  assert.match(result.reply,/30 minutes/);
  assert.match(result.reply,/Gate D12/);
  assert.match(result.reply,/not live airport guidance/);
  const rows=store.read();
  assert.ok(rows.some(e=>e.event==='tool_reuse'));
  assert.equal(rows.at(-1).metadata.modelCalls,2);
  assert.equal(rows.at(-1).metadata.toolCalls,1);
  assert.equal(rows.at(-1).metadata.reusedTools,1);
 }finally{store.close();}
});
test('duplicate calls in one batch share facts but each gets its own protocol result',async()=>{
 let round=0,executions=0;
 await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[],
 callModel:async(args)=>{
  if(++round===1)return{content:[call('one'),call('two','Transfer directions for CL204')]};
  const results=args.messages.at(-1).content;
  assert.deepEqual(results.map(r=>r.tool_use_id),['one','two']);
  assert.deepEqual(JSON.parse(results[0].content),JSON.parse(results[1].content));
  return final;
 },execute:async(...args)=>{executions++;return executePassengerTool(...args);}});
 assert.equal(executions,1);
});
test('a cached connection does not prevent a genuinely additional baggage lookup',async()=>{
 let round=0,executions=[];
 const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[],
 callModel:async(args)=>{
  if(++round===1)return{content:[call('one')]};
  if(round===2)return{content:[call('repeat','Connection directions'),{type:'tool_use',id:'bag',name: 'baggage_allowance', input: fixtureInput('baggage_allowance', "Baggage allowance")}]};
  assert.equal(args.messages.at(-1).content.length,2);
  return final;
 },execute:async(...args)=>{executions.push(args[0]);return executePassengerTool(...args);}});
 assert.deepEqual(executions,['connection_assistant','baggage_allowance']);
 assert.deepEqual(result.toolsUsed,executions);
});
test('different unsupported flights and invalid arguments never reuse valid itinerary facts',async()=>{
 for(const request of [call('other','Connection to NH110'),{...call('bad'),input:{inboundFlight:'CL204',onwardFlight:'CL310',scenario:'on-time'}}]){
  let round=0,executions=0;
  await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[],
   callModel:async(args)=>{
    if(++round===1)return{content:[call('first')]};
    if(round===2)return{content:[request]};
    const output=args.messages.at(-1).content[0];
    if(request.id==='other')assert.match(fixtureReply(JSON.parse(output.content)),/cannot verify another itinerary/);
    else assert.equal(output.is_error,true);
    return final;
   },execute:async(...args)=>{executions++;return executePassengerTool(...args);}
  });
  assert.equal(executions,request.id==='other'?2:1);
 }
});
test('failed connection calls can be retried and are not cached',async()=>{
 let round=0,executions=0;
 await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[],
 callModel:async()=>++round<3?{content:[call(String(round))]}:final,
 execute:async(...args)=>{if(++executions===1)throw new Error('Temporary failure');return executePassengerTool(...args);}});
 assert.equal(executions,2);
});
test('cache is per turn, so a later scenario change gets fresh connection facts',async()=>{
 const replies=[];
 for(const scenario of ['on-time','delayed']){
  let round=0;
  const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[],context:{demoScenario:scenario},
   callModel:async()=>({content:[call(String(++round))]})});
  replies.push(result.reply);
 }
 assert.match(replies[0],/75 minutes/);
 assert.match(replies[1],/30 minutes/);
});

test('replays observed connection-status-connection sequence with one fewer model round',async()=>{
 let rounds=0;
 const executions=[];
 const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[],context:{demoScenario:'delayed'},
 callModel:async()=>{
  rounds++;
  if(rounds===1)return{content:[call('connection'),{type:'tool_use',id:'status',name: 'flight_status', input: fixtureInput('flight_status', "Flight status")}]};
  if(rounds===2)return{content:[call('again','Can I make CL310 after CL204 lands?')]};
  throw new Error('Observed redundant third model call must be avoided');
 },execute:async(...args)=>{executions.push(args[0]);return executePassengerTool(...args);}});
 assert.equal(rounds,2);
 assert.deepEqual(executions,['connection_assistant','flight_status']);
 assert.match(result.reply,/30 minutes/);
 assert.match(result.reply,/Gate D12/);
 assert.match(result.reply,/cannot guarantee the connection/);
});

test('connection fallback does not discard an already fetched unrelated result',async()=>{
 let rounds=0;
 const executions=[];
 const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[],
 callModel:async(args)=>{
  if(++rounds===1)return{content:[call('connection'),{type:'tool_use',id:'baggage',name: 'baggage_allowance', input: fixtureInput('baggage_allowance', "Baggage allowance")}]};
  if(rounds===2)return{content:[call('again')]};
  assert.equal(args.messages.at(-1).content[0].tool_use_id,'again');
  return{content:[{type:'text',text:'{"reply":"Here are the connection and baggage details."}'}]};
 },execute:async(...args)=>{executions.push(args[0]);return executePassengerTool(...args);}});
 assert.equal(rounds,3);
 assert.equal(executions.length,2);
 assert.match(result.reply,/connection and baggage/);
});
