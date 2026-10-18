import { fixtureInput, fixtureReply } from './test-tool-inputs.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('local HTTP agent turns persist redacted correlated traces without real API calls', async()=>{
 const dir=await mkdtemp(join(tmpdir(),'noor-agent-http-'));
 const originalFetch=globalThis.fetch;
 let server,db;
 try{
  process.env.PORT='0';
  process.env.NOOR_HOST='127.0.0.1';
  process.env.NOOR_SKIP_VOICE_WARMUP='1';
  process.env.NOOR_EMAIL_DB=':memory:';
  process.env.NOOR_USAGE_DB=':memory:';
  process.env.NOOR_DATA_DIR=dir;
  process.env.ANTHROPIC_API_KEY='private-test-key';
  process.env.ANTHROPIC_MODEL='claude-test';
  let calls=0;
  globalThis.fetch=async(url,options)=>{
   if(String(url)==='https://api.anthropic.com/v1/messages/count_tokens')return Response.json({input_tokens:100});
   if(String(url)!=='https://api.anthropic.com/v1/messages')return originalFetch(url,options);
   calls++;
   if(calls%2===1)return Response.json({content:[{type:'tool_use',id:'private-tool-id',name: 'flight_status', input: fixtureInput('flight_status', "Flight status")}],usage:{input_tokens:4,output_tokens:2}});
   const body=JSON.parse(options.body);
   assert.equal(body.messages.at(-1).content[0].type,'tool_result');
   return Response.json({content:[{type:'text',text:'{"reply":"Private answer: demo flight on time.","expression":"thoughtful"}'}],usage:{input_tokens:5,output_tokens:3}});
  };
  ({server}=await import('./server.mjs'));
  if(!server.listening)await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  const start=await originalFetch(base+'/api/session',{method:'POST'});
  const cookies=start.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
  const response=await originalFetch(base+'/api/chat',{method:'POST',headers:{cookie:cookies,'content-type':'application/json'},body:JSON.stringify({useTools:true,message:'PRIVATE passenger@example.com, what is my flight status?'})});
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(calls,2);
  assert.match(result.traceId,/^[a-f0-9-]{36}$/);
  db=new DatabaseSync(join(dir,'agent-traces.sqlite'),{readOnly:true});
  const rows=db.prepare('SELECT trace_id,event,metadata FROM agent_events ORDER BY seq').all();
  assert.ok(rows.length>=8);
  assert.ok(rows.every(row=>row.trace_id===result.traceId));
  assert.equal(rows.at(-1).event,'run_end');
  assert.equal(JSON.parse(rows.at(-1).metadata).tokens,14);
  for(const secret of ['private-test-key','PRIVATE','passenger@example.com','private-tool-id','Private answer',cookies])assert.ok(!JSON.stringify(rows).includes(secret));
  for(const flag of [undefined,false,null,'false']){
   const start=await originalFetch(base+'/api/session',{method:'POST'});const cookie=start.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
   const response=await originalFetch(base+'/api/chat',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({message:'Are we delayed?',demoScenario:'delayed',...(flag!==undefined?{useTools:flag}:{})})});assert.equal(response.status,200);const answer=await response.json();assert.equal(answer.evidenceStatus,'grounded');assert.match(answer.reply,/Delayed by 45 minutes/);assert.deepEqual(answer.toolsUsed,['flight_status']);assert.ok(answer.traceId);
  }
  globalThis.fetch=async(url,options)=>{if(String(url)==='https://api.anthropic.com/v1/messages/count_tokens')return Response.json({input_tokens:100});if(String(url)==='https://api.anthropic.com/v1/messages')return Response.json({content:[{type:'text',text:'{"reply":"I submitted your crew request."}'}],usage:{input_tokens:100,output_tokens:20}});if(new URL(url).hostname!=='127.0.0.1')throw Error('External network disabled');return originalFetch(url,options);};
  const unsafe=await originalFetch(base+'/api/chat',{method:'POST',headers:{cookie:cookies,'content-type':'application/json'},body:JSON.stringify({message:'Hello',useTools:false})});assert.equal(unsafe.status,200);const guarded=await unsafe.json();assert.equal(guarded.evidenceStatus,'limited');assert.match(guarded.reply,/cannot confirm/);assert.ok(db.prepare('SELECT event FROM agent_events WHERE trace_id=?').all(guarded.traceId).some(row=>row.event==='action_claim_blocked'));
 }finally{
  globalThis.fetch=originalFetch;
  db?.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  await rm(dir,{recursive:true,force:true});
 }
});
