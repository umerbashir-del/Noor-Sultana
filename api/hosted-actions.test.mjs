import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {POST as crew} from './crew.mjs';
import {POST as reminders} from './reminders.mjs';
import {createHostedTestBackend} from '../lib/test-hosted-backend.mjs';
import {createStoredSession} from '../lib/supabase-store.mjs';
import {sessionIdCookie} from '../lib/vercel-session.mjs';
import {executePassengerTool} from '../prototype/tool-executor.mjs';

async function fixture(run){
 const previous={fetch:globalThis.fetch,env:{...process.env}};
 const backend=createHostedTestBackend();
 Object.assign(process.env,{SUPABASE_URL:'https://demo.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test_only',NOOR_SESSION_SECRET:'a'.repeat(64)});
 globalThis.fetch=backend.fetch;
 try{
  const id=await createStoredSession('11111111-1111-4111-8111-111111111111');
  const otherId=await createStoredSession('22222222-2222-4222-8222-222222222222');
  const call=async(handler,body,session=id,origin='https://noor.test')=>{
   const response=await handler(new Request('https://noor.test/api/action',{method:'POST',headers:{origin,'content-type':'application/json',...(session?{cookie:sessionIdCookie(session).split(';')[0]}:{})},body:JSON.stringify(body)}));
   return {status:response.status,...await response.json()};
  };
  await run({backend,id,otherId,call});
  assert.equal(backend.ledger.length,0);
 }finally{globalThis.fetch=previous.fetch;process.env=previous.env;}
}

test('hosted crew requires exact reviewed confirmation, isolates sessions, and deduplicates concurrent submission',()=>fixture(async({call,id,otherId})=>{
 assert.equal((await call(crew,{action:'submit',confirmed:true,token:'invented'})).status,409);
 assert.equal((await call(crew,{action:'review',category:'seat',details:'urgent medical help'})).status,400);
 const reviewed=await call(crew,{action:'review',category:'seat',details:'Seat recline is stuck'});
 assert.equal(reviewed.status,200);assert.equal((await call(crew,{action:'list'})).requests.length,0);
 const token=reviewed.draft.token;
 assert.equal((await call(crew,{action:'submit',token})).status,400);
 assert.equal((await call(crew,{action:'submit',token,confirmed:true},otherId)).status,409);
 const submitted=await Promise.all([call(crew,{action:'submit',token,confirmed:true}),call(crew,{action:'submit',token,confirmed:true})]);
 assert.equal(submitted[0].request.id,submitted[1].request.id);
 assert.equal((await call(crew,{action:'list'})).requests.length,1);
 assert.equal((await call(crew,{action:'cancel',id:submitted[0].request.id},otherId)).status,404);
 assert.equal((await call(crew,{action:'cancel',id:submitted[0].request.id})).request.status,'cancelled');
}));

test('hosted reminders require confirmation, become due, retain per-session limits, and cancel',()=>fixture(async({call,backend,id})=>{
 assert.equal((await call(reminders,{action:'review',kind:'boarding',dueAt:Date.now()+60000,timeZone:'invalid'})).status,400);
 const r=await call(reminders,{action:'review',kind:'boarding',dueAt:Date.now()+60000,timeZone:'America/New_York'});
 assert.equal((await call(reminders,{action:'list'})).reminders.length,0);
 assert.equal((await call(reminders,{action:'save',token:r.draft.token,confirmed:'true'})).status,400);
 const saved=await call(reminders,{action:'save',token:r.draft.token,confirmed:true});
 assert.equal(saved.reminder.status,'pending');
 assert.equal((await call(reminders,{action:'save',token:r.draft.token,confirmed:true})).reminder.id,saved.reminder.id);
 backend.sessions.get(id).demo_actions.reminders.items[0].dueAt=Date.now()-1;
 assert.equal((await call(reminders,{action:'list'})).reminders[0].status,'due');
 assert.equal((await call(reminders,{action:'cancel',id:saved.reminder.id})).reminder.status,'cancelled');
 backend.sessions.get(id).demo_actions.reminders.items=Array.from({length:10},()=>({...saved.reminder}));
 assert.equal((await call(reminders,{action:'review',kind:'boarding',dueAt:Date.now()+60000,timeZone:'UTC'})).status,429);
}));

test('expired or replaced reviews, storage failure, session expiry and foreign origins fail closed',()=>fixture(async({call,backend,id})=>{
 const first=await call(crew,{action:'review',category:'seat',details:'First'});
 await call(crew,{action:'review',category:'comfort',details:'Second'});
 assert.equal((await call(crew,{action:'submit',token:first.draft.token,confirmed:true})).status,409);
 backend.sessions.get(id).demo_actions.crew.draft.expiresAt=Date.now()-1;
 const token=backend.sessions.get(id).demo_actions.crew.draft.token;
 assert.equal((await call(crew,{action:'submit',token,confirmed:true})).status,409);
 assert.equal((await call(crew,{action:'list'},null)).status,401);
 assert.equal((await call(crew,{action:'list'},id,'https://foreign.test')).status,403);
 backend.actionConflicts=3;assert.equal((await call(crew,{action:'review',category:'seat',details:'Conflict'})).status,409);
 const real=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Storage unavailable');};
 assert.equal((await call(crew,{action:'list'})).status,503);globalThis.fetch=real;
 backend.advance(900001);assert.equal((await call(reminders,{action:'list'})).status,401);
}));

test('hosted tools prepare forms without executing or claiming completion',async()=>{
 const crew=await executePassengerTool('prepare_crew_request',{category:'seat',details:'Seat help'},{local:false,hostedActions:true});
 const reminder=await executePassengerTool('prepare_reminder',{kind:'boarding',delayMinutes:1},{local:false,hostedActions:true});
 assert.equal(crew.crewAssistance,true);assert.equal(crew.facts.submitted,false);assert.equal(crew.confirmationRequired,true);
 assert.equal(reminder.passengerReminders,true);assert.equal(reminder.facts.saved,false);assert.equal(reminder.confirmationRequired,true);
 assert.match(crew.reply,/nothing has been submitted/i);assert.match(reminder.reply,/Nothing has been saved/);
 const sql=await readFile(new URL('../supabase/migrations/20261018062000_noor_hosted_actions.sql',import.meta.url),'utf8');
 assert.match(sql,/for update/);assert.match(sql,/actions_version<>p_version/);assert.match(sql,/from public,anon,authenticated/);assert.doesNotMatch(sql,/noor_usage_events|noor_demo_voice_budget/i);
});
