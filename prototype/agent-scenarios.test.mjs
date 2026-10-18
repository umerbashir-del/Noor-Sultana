import { fixtureInput, fixtureReply } from './test-tool-inputs.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { answerWithTools } from './agent.mjs';
import { createTraceStore } from './trace-store.mjs';
import { passengerTools } from './agent.mjs';
const scenarios = JSON.parse(await readFile(new URL('./agent-scenarios.json',import.meta.url),'utf8'));
// These are deterministic harness contract tests, not measurements of real-model tool selection.
for (const scenario of scenarios) test('offline scenario: '+scenario.id, async () => {
 const store=createTraceStore({dbPath:':memory:',toolNames:passengerTools.map(t=>t.name)});
 const context={ local:true,originalMessage:scenario.message,...scenario.context };
 const original=structuredClone(context);
 let rounds=0;
 try {
  const result=await answerWithTools({apiKey:'offline-only',model:'claude-test',system:'Passenger demo',messages:[...(scenario.history||[]),{role:'user',content:scenario.message}],context,traceFactory:()=>store.start(),
   callModel:async(args)=>{
    rounds++;
    if(rounds===1 && scenario.tools.length) {
     assert.deepEqual(args.messages.at(-1),{role:'user',content:scenario.message});
     if(scenario.history) assert.deepEqual(args.messages.slice(0,scenario.history.length),scenario.history);
     return {usageTokens:10,content:scenario.tools.map((t,i)=>({type:'tool_use',id:'tool-'+i,name:t.name,input:t.input}))};
    }
    const outputs=rounds===1 ? [] : args.messages.at(-1).content.map(t=>{assert.equal(t.type,'tool_result');assert.ok(!t.is_error);return JSON.parse(t.content);});
    return {usageTokens:10,content:[{type:'text',text:JSON.stringify({reply:scenario.reply||outputs.map(fixtureReply).join(' '),expression:'thoughtful'})}]};
   }});
  assert.deepEqual(result.toolsUsed,scenario.tools.map(t=>t.name));
  assert.ok(result.reply.includes(scenario.contains));
  if(scenario.flag) assert.ok(result[scenario.flag]);
  assert.deepEqual(context,original,'lookup/preparation must not mutate passenger state');
  const events=store.read();
  assert.equal(events.at(-1).event,'run_end');
  assert.equal(events.at(-1).metadata.status,'success');
  assert.equal(events.at(-1).metadata.toolCalls,scenario.tools.length);
 } finally{store.close();}
});
test('invalid tool arguments produce safe feedback and allow a corrected call',async()=>{
 let round=0;
 const store=createTraceStore({dbPath:':memory:',toolNames:passengerTools.map(t=>t.name)});
 try{
 const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[],traceFactory:()=>store.start(),
 callModel:async(args)=>{
  round++;
  if(round===1)return{content:[{type:'tool_use',id:'bad',name: 'baggage_allowance', input: { ...fixtureInput('baggage_allowance', "bags"), fare: 'business' }}]};
  if(round===2){assert.equal(args.messages.at(-1).content[0].is_error,true);return{content:[{type:'tool_use',id:'good',name: 'baggage_allowance', input: fixtureInput('baggage_allowance', "Baggage allowance")}]};}
  return{content:[{type:'text',text:'{"reply":"The demo allowance includes one checked bag."}'}]};
 }});
 assert.deepEqual(result.toolsUsed,['baggage_allowance']);
 assert.ok(store.read().some(e=>e.metadata.errorKind==='invalid_arguments'));
 }finally{store.close();}
});
test('provider failures, call limits, malformed responses, and trace failures stay bounded',async()=>{
 const store=createTraceStore({dbPath:':memory:',toolNames:passengerTools.map(t=>t.name)});
 try{
  await assert.rejects(()=>answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[],traceFactory:()=>store.start(),callModel:async()=>{throw new Error('SECRET private provider response');}}));
  const serialized=JSON.stringify(store.read());
  assert.ok(!serialized.includes('SECRET'));
  assert.equal(store.read().at(-1).metadata.status,'error');
  await assert.rejects(()=>answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[],traceFactory:()=>store.start(),callModel:async()=>({content:null})}));
  const answer=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[],traceFactory:()=>({event(){throw new Error('Disk full');}}),callModel:async()=>({content:[{type:'text',text:'{"reply":"Hello."}'}]})});
  assert.equal(answer.reply,'Hello.');
 }finally{store.close();}
});
test('unavailable tool result returns an error to the model without leaking raw failures',async()=>{
 let round=0;
 const answer=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[],
 execute:async()=>{throw new Error('PRIVATE upstream URL with credentials');},
 callModel:async(args)=>{
  if(++round===1)return{content:[{type:'tool_use',id:'weather',name: 'weather', input: fixtureInput('weather', "Tokyo")}]};
  assert.equal(args.messages.at(-1).content[0].is_error,true);
  assert.ok(!JSON.stringify(args.messages.at(-1)).includes('PRIVATE'));
  return{content:[{type:'text',text:'{"reply":"Weather is unavailable."}'}]};
 }});
 assert.equal(answer.reply,'Weather is unavailable.');
 assert.deepEqual(answer.toolsUsed,[]);
});
