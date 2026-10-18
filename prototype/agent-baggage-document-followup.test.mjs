import test from 'node:test';
import assert from 'node:assert/strict';
import {answerWithTools,executePassengerTool,passengerTools} from './agent.mjs';
import {createTraceStore} from './trace-store.mjs';
const memory={topics:['baggage_allowance','passenger_guidance'],flightId:'CL204',documents:[{id:'baggage',section:'Can I bring this item?'}]};
test('direct baggage follow-up answer has both fresh results before the first model call and needs no repair',async()=>{
 const store=createTraceStore({dbPath:':memory:',toolNames:passengerTools.map(t=>t.name)});let models=0;const executed=[];
 try{
 const result=await answerWithTools({apiKey:'offline',model:'test',system:'scope',messages:[{role:'user',content:'And now?'}],context:{sessionMemory:memory,demoFare:'basic'},traceFactory:()=>store.start(),execute:async(...args)=>{executed.push(args[0]);return executePassengerTool(...args);},callModel:async args=>{models++;assert.deepEqual(executed,['passenger_guidance','baggage_allowance']);assert.match(args.system,/REQUIRED BAGGAGE FOLLOW-UP EVIDENCE/);return {content:[{type:'text',text:'{"reply":"Please check the guidance."}'}]};}});
 assert.equal(models,1);assert.equal(result.evidenceStatus,'grounded');assert.match(result.reply,/No checked bag is included/);assert.match(result.reply,/\[baggage:2\]/);assert.deepEqual(result.toolsUsed,executed);const rows=store.read();assert.ok(!rows.some(e=>e.event==='evidence_repair'));assert.equal(rows.at(-1).metadata.toolCalls,2);assert.equal(rows.at(-1).metadata.modelCalls,1);
 }finally{store.close();}
});
test('unsupported remembered flights cannot acquire default-flight baggage evidence',async()=>{
 const result=await answerWithTools({apiKey:'offline',model:'test',system:'scope',messages:[{role:'user',content:'And now?'}],context:{sessionMemory:{...memory,flightId:'NH110'},demoFare:'basic'},callModel:async()=>{throw Error('No model call needed for unsupported baggage');}});
 assert.equal(result.evidenceStatus,'limited');assert.doesNotMatch(result.reply,/No checked bag is included/);
});
test('failed baggage fetch returns a limitation instead of a repair or guessed allowance',async()=>{
 const result=await answerWithTools({apiKey:'offline',model:'test',system:'scope',messages:[{role:'user',content:'And now?'}],context:{sessionMemory:memory},execute:async(name,...args)=>{if(name==='baggage_allowance')throw Error('Unavailable');return executePassengerTool(name,...args);},callModel:async()=>{throw Error('Must not call model');}});
 assert.equal(result.evidenceStatus,'limited');assert.match(result.reply,/cannot verify/);
});
