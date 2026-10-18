import { fixtureInput, fixtureReply } from './test-tool-inputs.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { answerWithTools, passengerTools, executePassengerTool } from './agent.mjs';
test('Claude chooses tools, receives tool results and can combine lookups', async () => {
 const seen=[];
 const answer=await answerWithTools({apiKey:'test',model:'test',system:'passenger scope',messages:[{role:'user',content:'Status and baggage?'}],
 callModel:async (args)=>{
  seen.push(structuredClone(args));
  if(seen.length===1) return {content:[{type:'tool_use',id:'one',name: 'flight_status', input: fixtureInput('flight_status', "Flight status")},{type:'tool_use',id:'two',name: 'baggage_allowance', input: fixtureInput('baggage_allowance', "Baggage allowance")}]};
  return {content:[{type:'text',text:'{"reply":"Demo flight is on time with one checked bag.","expression":"thoughtful"}'}]};
 },context:{demoFare:'standard'}});
 assert.deepEqual(answer.toolsUsed,['flight_status','baggage_allowance']);
 assert.equal(seen[0].tools.length,passengerTools.length);
 assert.equal(seen[1].messages.at(-1).content[0].type,'tool_result');
 assert.equal(JSON.parse(seen[1].messages.at(-1).content[1].content).facts.checkedKgEach,23);
});
test('write preparation never saves state and final answer retains confirmation notice',async()=>{
 const context={local:true};
 const answer=await answerWithTools({apiKey:'test',model:'test',system:'scope',messages:[],context,
 callModel:async(args)=>args.messages.length ? {content:[{type:'text',text:'{"reply":"Please review the reminder."}'}]} : {content:[{type:'tool_use',id:'r',name: 'prepare_reminder', input: fixtureInput('prepare_reminder', "Remind me before boarding")}]}});
 assert.equal(answer.passengerReminders,true);
 assert.match(answer.reply,/Nothing has been submitted or scheduled/);
 assert.deepEqual(context,{local:true});
 await assert.rejects(()=>executePassengerTool('submit_crew_request',{query:'submit'}));
 await assert.rejects(()=>executePassengerTool('baggage_allowance',{query:'bags',fare:'business'}));
});
test('bounds tool loops and returns tool failures without leaking errors',async()=>{
 let count=0;
 await assert.rejects(()=>answerWithTools({apiKey:'test',model:'test',system:'scope',messages:[],
 callModel:async()=>({content:[{type:'tool_use',id:String(++count),name: 'unknown', input: fixtureInput('unknown', "test")}]})}),/too many tool calls/);
 assert.equal(count,4);
});
