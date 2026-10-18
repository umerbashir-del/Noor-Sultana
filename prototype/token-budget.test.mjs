import test from 'node:test';
import assert from 'node:assert/strict';
import { planClaudeReservation,runBudgetedClaude } from './token-budget.mjs';
import { createUsageStore,usageLimitsFromEnv,UsageLimitError } from './usage-store.mjs';
const visitor='a'.repeat(64),other='b'.repeat(64);
test('counts exact input including tools and reserves full output plus margin',async()=>{
 const args={apiKey:'private-test-key',model:'claude-test',system:'scope',messages:[{role:'user',content:'hello'}],tools:[{name:'test',input_schema:{type:'object'}}]};
 const plan=await planClaudeReservation({...args,fetchImpl:async(url,options)=>{
  assert.equal(url,'https://api.anthropic.com/v1/messages/count_tokens');
  assert.equal(options.headers['x-api-key'],'private-test-key');
  const body=JSON.parse(options.body);
  assert.deepEqual(body.tools,args.tools);
  assert.deepEqual(body.messages,args.messages);
  assert.equal(body.max_tokens,undefined);
  return Response.json({input_tokens:4000});
 }});
 assert.deepEqual(plan,{inputTokens:4000,reservedTokens:4780,reservationMethod:'counted'});
 assert.ok(!JSON.stringify(plan).includes('private'));
});
test('count failures retain a conservative fallback including tool schema and max output',async()=>{
 const args={apiKey:'test',model:'claude-test',system:'s',messages:[],tools:[{description:'x'.repeat(5000)}],maxOutputTokens:700};
 for(const fetchImpl of [async()=>{throw new Error('private');},async()=>new Response('',{status:500}),async()=>Response.json({input_tokens:-1}),async()=>Response.json({input_tokens:'4000'})]){
  const plan=await planClaudeReservation({...args,fetchImpl});
  assert.equal(plan.reservationMethod,'fallback');
  assert.ok(plan.reservedTokens>=5700);
 }
});
test('counted reservations allow a request that byte estimates wrongly block, without changing caps',async()=>{
 const store=createUsageStore({limits:usageLimitsFromEnv({NOOR_DAILY_CLAUDE_VISITOR_TOKENS:'10000'})});
 try{
  store.settleClaude(store.reserveClaude(visitor,6000),6000);
  assert.throws(()=>store.reserveClaude(visitor,15000),UsageLimitError);
  let called=false;
  const result=await runBudgetedClaude({}, {store,visitorId:visitor,count:async()=>({inputTokens:1500,reservedTokens:2264,reservationMethod:'counted'}),requestModel:async()=>{called=true;return{usageTokens:1700};}});
  assert.equal(called,true);
  assert.equal(result.reservation.reservationMethod,'counted');
  assert.equal(store.totals(visitor).visitor.tokens,7700);
  await assert.rejects(()=>runBudgetedClaude({}, {store,visitorId:visitor,count:async()=>({reservedTokens:3000}),requestModel:async()=>{throw new Error('Must not send');}}),UsageLimitError);
 }finally{store.close();}
});
test('atomic reservations still protect concurrent and global spending, and retain uncertain requests',async()=>{
 const store=createUsageStore({limits:usageLimitsFromEnv({NOOR_DAILY_CLAUDE_GLOBAL_TOKENS:'5000'})});
 try{
  const count=async()=>({reservedTokens:3000,reservationMethod:'counted'});
  let release;
  const hold=new Promise(resolve=>{release=resolve;});
  const first=runBudgetedClaude({}, {store,visitorId:visitor,count,requestModel:async()=>{await hold;return{usageTokens:1000};}});
  await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(()=>runBudgetedClaude({}, {store,visitorId:other,count,requestModel:async()=>({usageTokens:1000})}),UsageLimitError);
  release();await first;
  await assert.rejects(()=>runBudgetedClaude({}, {store,visitorId:visitor,count,requestModel:async()=>{throw new Error('Unknown provider outcome');}}));
  assert.equal(store.totals(visitor).global.tokens,4000);
 }finally{store.close();}
});
test('missing provider usage retains the reserved amount, and request limits remain enforced',async()=>{
 const store=createUsageStore({limits:usageLimitsFromEnv({NOOR_DAILY_CLAUDE_VISITOR_REQUESTS:'1'})});
 try{
  const options={store,visitorId:visitor,count:async()=>({reservedTokens:2000,reservationMethod:'counted'}),requestModel:async()=>({usageTokens:null})};
  await runBudgetedClaude({},options);
  assert.equal(store.totals(visitor).visitor.tokens,2000);
  await assert.rejects(()=>runBudgetedClaude({},options),UsageLimitError);
 }finally{store.close();}
});
