import test from 'node:test';
import assert from 'node:assert/strict';
import { answerWithTools, executePassengerTool } from './agent.mjs';
const call=(id,category='menu',flightId='CL204')=>({type:'tool_use',id,name:'meals_and_services',input:{flightId,category}});
const final={content:[{type:'text',text:'{"reply":"Here are the simulated service details."}'}]};
const args={apiKey:'offline',model:'test',system:'scope',messages:[{role:'user',content:'Is there any meat-free food left?'}],context:{demoScenario:'landed',demoMealStock:'limited'}};
test('repeated meal categories reuse fresh facts and finish after two model rounds',async()=>{
 let rounds=0,executions=0,reused=0;
 const result=await answerWithTools({...args,callModel:async()=>{if(++rounds>2)throw new Error('Unnecessary third model call');return {content:[call(String(rounds),rounds===1?'menu':'service_times')]};},execute:async(...a)=>{executions++;return executePassengerTool(...a);}});
 assert.equal(rounds,2);assert.equal(executions,1);assert.match(result.reply,/service has ended/);assert.equal(result.evidenceStatus,'grounded');
});
test('meal batch duplicates keep distinct protocol results without a second execution',async()=>{
 let rounds=0,executions=0;
 await answerWithTools({...args,callModel:async a=>{if(++rounds===1)return {content:[call('a'),call('b','dietary')]};const results=a.messages.at(-1).content;assert.deepEqual(results.map(r=>r.tool_use_id),['a','b']);assert.deepEqual(JSON.parse(results[0].content),JSON.parse(results[1].content));return final;},execute:async(...a)=>{executions++;return executePassengerTool(...a);}});
 assert.equal(executions,1);
});
test('unsupported flights and invalid meal inputs do not reuse supported facts',async()=>{
 for(const request of [call('other','menu','NH110'),{...call('bad'),input:{flightId:'CL204',category:'invented'}}]){
 let rounds=0,executions=0;
 await answerWithTools({...args,callModel:async a=>{if(++rounds===1)return {content:[call('first')]};if(rounds===2)return {content:[request]};const r=JSON.parse(a.messages.at(-1).content[0].content);assert.equal(r.status,request.id==='other'?'unsupported':'error');return final;},execute:async(...a)=>{executions++;return executePassengerTool(...a);}});
 assert.equal(executions,request.id==='other'?2:1);
 }
});
test('meal cache is not shared across turns or scenario changes',async()=>{
 for(const scenario of ['on-time','landed']){let rounds=0,executions=0;const result=await answerWithTools({...args,context:{demoScenario:scenario,demoMealStock:'limited'},callModel:async()=>++rounds===1?{content:[call('fresh')]}:final,execute:async(...a)=>{executions++;return executePassengerTool(...a);}});assert.equal(executions,1);assert.match(result.reply,scenario==='landed'?/service has ended/:/1 portions/);}
});
