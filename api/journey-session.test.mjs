import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createHostedTestBackend } from '../lib/test-hosted-backend.mjs';
import { journeys } from '../prototype/journeys.mjs';
import { POST as start } from './session.mjs';
import { POST as chat } from './chat.mjs';
const req=(path,cookie,body)=>new Request('https://noor.example'+path,{method:'POST',headers:{origin:'https://noor.example','content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
const cookies=r=>r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
test('hosted journey sessions persist the server selection, reject spoofing and revoke old context on switch', async () => {
 process.env.NOOR_SESSION_SECRET=randomBytes(32).toString('hex');process.env.ANTHROPIC_API_KEY='offline';process.env.SUPABASE_URL='https://demo.supabase.co';process.env.SUPABASE_SECRET_KEY='sb_secret_test_only';
 const original=globalThis.fetch;let round=0;
 const backend=createHostedTestBackend(async(url,options)=>{
  const body=JSON.parse(options.body),id=body.system.match(/"journeyId":"(tokyo|paris|dubai|rome)"/)?.[1];
  const journey=journeys.find(j=>j.id===id);assert.ok(journey);
  return Response.json({content:++round%2?[{type:'tool_use',id:'status',name:'flight_status',input:{flightId:journey.flightId}}]:[{type:'text',text:'{"reply":"On time."}'}],usage:{input_tokens:20,output_tokens:10}});
 });globalThis.fetch=backend.fetch;
 try{
  let prior;
  for(const j of journeys){
   const r=await start(req('/api/session?journey='+j.id,prior));assert.equal(r.status,200);const cookie=cookies(r);
   if(prior)assert.equal((await chat(req('/api/chat',prior,{message:'Hello'}))).status,401);
   const result=await chat(req('/api/chat',cookie,{message:'What is our flight status?',journeyId:j.id==='tokyo'?'rome':'tokyo',flightId:'NH110',sessionMemory:{journeyId:'tokyo'}}));
   assert.equal(result.status,200);const data=await result.json();assert.equal(data.evidenceStatus,'grounded');assert.match(data.reply,new RegExp(j.airport));assert.doesNotMatch(data.reply,/Oct 12|Oct 13/);
   const row=[...backend.sessions.values()][0];assert.equal(row.memory.journeyId,j.id);assert.equal(row.messages.length,2);
   prior=cookie;
  }
  assert.equal((await start(req('/api/session?journey=unknown',prior))).status,400);
  assert.equal(backend.sessions.size,1);
  const current=[...backend.sessions.values()][0], previousCalls=current.calls;
  const stale=await chat(req('/api/chat',prior,{message:'What is our flight status?',expectedJourneyId:'paris'}));
  assert.equal(stale.status,401);assert.equal(current.calls,previousCalls);
 }finally{globalThis.fetch=original;}
});
