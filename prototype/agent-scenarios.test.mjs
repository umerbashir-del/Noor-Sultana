import { fixtureInput } from './test-tool-inputs.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { answerWithTools } from './agent.mjs';
import { createTraceStore } from './trace-store.mjs';
import { passengerTools } from './agent.mjs';
// Scripted model responses test orchestration, not real-model tool selection.
// Adapter variants and grounding failures have focused tests in this directory.
test('multi-tool turns preserve history and context and finish a successful trace', async () => {
 const store=createTraceStore({dbPath:':memory:',toolNames:passengerTools.map(t=>t.name)});
 const history=[{role:'user',content:'Hello'},{role:'assistant',content:'Welcome aboard.'}];
 const message='What bags are included and is vegetarian food available?';
 const context={local:true,originalMessage:message,demoFare:'business',demoMealStock:'limited'};
 const original=structuredClone(context);
 let rounds=0;
 try {
  const result=await answerWithTools({apiKey:'offline-only',model:'claude-test',system:'Passenger demo',messages:[...history,{role:'user',content:message}],context,traceFactory:()=>store.start(),
   callModel:async(args)=>{
    if(++rounds===1){
     assert.deepEqual(args.messages.slice(0,history.length),history);
     assert.deepEqual(args.messages.at(-1),{role:'user',content:message});
     return {content:[
      {type:'tool_use',id:'bags',name:'baggage_allowance',input:{flightId:'CL204',bagType:'all'}},
      {type:'tool_use',id:'meals',name:'meals_and_services',input:{flightId:'CL204',category:'all'}},
     ]};
    }
    const outputs=args.messages.at(-1).content;
    assert.equal(outputs.length,2);
    for(const output of outputs){assert.equal(output.type,'tool_result');assert.ok(!output.is_error);}
    assert.equal(JSON.parse(outputs[0].content).facts.checkedKgEach,32);
    return {content:[{type:'text',text:'{"reply":"Please check the returned baggage and meal facts."}'}]};
   }});
  assert.equal(rounds,2);
  assert.deepEqual(result.toolsUsed,['baggage_allowance','meals_and_services']);
  assert.equal(result.evidenceStatus,'grounded');
  assert.match(result.reply,/2 checked bags/);
  assert.match(result.reply,/Stock is limited/);
  assert.deepEqual(context,original);
  const end=store.read().at(-1);
  assert.equal(end.event,'run_end');
  assert.equal(end.metadata.status,'success');
  assert.equal(end.metadata.toolCalls,2);
 } finally {store.close();}
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

test('unknown provider usage is omitted from run totals rather than recorded as zero',async()=>{
 const store=createTraceStore({dbPath:':memory:'});
 const args={apiKey:'offline',model:'claude-test',system:'scope',messages:[{role:'user',content:'Hello'}],traceFactory:()=>store.start()};
 try{
  await answerWithTools({...args,callModel:async()=>({content:[{type:'text',text:'{"reply":"Welcome aboard."}'}],usageTokens:10,usage:{input_tokens:8,output_tokens:2}})});
  let end=store.read().at(-1).metadata;
  assert.equal(end.uncachedInputTokens,8);
  assert.equal(end.outputTokens,2);
  assert.equal(end.cacheReadInputTokens,undefined);
  assert.equal(end.cacheCreationInputTokens,undefined);
  await assert.rejects(()=>answerWithTools({...args,callModel:async()=>{throw Error('private provider error');}}));
  end=store.read().at(-1).metadata;
  assert.equal(end.tokens,undefined);
  assert.equal(end.uncachedInputTokens,undefined);
  assert.equal(end.outputTokens,undefined);
  assert.ok(!JSON.stringify(store.read()).includes('private provider error'));
 }finally{store.close();}
});
