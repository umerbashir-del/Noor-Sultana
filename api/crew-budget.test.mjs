import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {crewAccessCookie,crewSessionIdFrom,crewAuthorized,newCrewSessionId} from '../lib/crew-dashboard-auth.mjs';
import {createStoredCrewSession} from '../lib/supabase-store.mjs';
import {runCrewClaude,crewClaudeLimits,CrewBudgetError} from '../lib/crew-budget.mjs';
import {createHostedTestBackend} from '../lib/test-hosted-backend.mjs';

process.env.NOOR_CREW_DASHBOARD_KEY='crew-test-'+randomBytes(32).toString('hex');
process.env.NOOR_SESSION_SECRET=randomBytes(32).toString('hex');
process.env.SUPABASE_URL='https://demo.supabase.co';
process.env.SUPABASE_SECRET_KEY='sb_secret_test_only';
const args={apiKey:'offline',model:'test',system:'Crew only',messages:[{role:'user',content:'Queue?'}]};
const count=async()=>({reservedTokens:1000});
const model=async()=>({usageTokens:25,content:[]});
async function fixture(){const backend=createHostedTestBackend();globalThis.fetch=backend.fetch;const id=newCrewSessionId();await createStoredCrewSession(id);return {backend,id};}

test('signed crew cookie carries a random, expiring session identity',()=>{
 const id=newCrewSessionId(),cookie=crewAccessCookie(1000,id).split(';')[0];
 const request=new Request('https://noor.example/api/crew-dashboard',{headers:{cookie}});
 assert.equal(crewSessionIdFrom(request,1001),id);assert.equal(crewAuthorized(request,1001),true);
 assert.equal(crewSessionIdFrom(request,7201000),null);
 const changed=new Request(request.url,{headers:{cookie:cookie.replace(/.$/,'x')}});
 assert.equal(crewAuthorized(changed,1001),false);
});
test('crew reservations settle actual usage and count against the shared global ledger',async()=>{
 const {backend,id}=await fixture();const options={count,requestModel:model,env:{NOOR_DAILY_CLAUDE_GLOBAL_TOKENS:'1020'}};
 await runCrewClaude(args,id,options);assert.equal(backend.ledger[0].actual,25);assert.equal(backend.ledger[0].crewSessionId,id);
 await assert.rejects(()=>runCrewClaude(args,id,options),e=>e instanceof CrewBudgetError&&e.status===429&&e.scope==='global');
});
test('concurrent crew calls and six-model-rounds-per-minute throttle are enforced before Claude',async()=>{
 const {backend,id}=await fixture();let release,started;const wait=new Promise(r=>{release=r;}),ready=new Promise(r=>{started=r;});let calls=0;
 const first=runCrewClaude(args,id,{count,requestModel:async()=>{calls++;started();await wait;return model();}});
 await ready;await assert.rejects(()=>runCrewClaude(args,id,{count,requestModel:model}),e=>e.status===429&&e.scope==='concurrent');
 release();await first;
 for(let i=0;i<5;i++)await runCrewClaude(args,id,{count,requestModel:model});
 await assert.rejects(()=>runCrewClaude(args,id,{count,requestModel:model}),e=>e.status===429&&e.scope==='rate');
 assert.equal(calls,1);backend.advance(60001);await runCrewClaude(args,id,{count,requestModel:model});
});
test('crew daily, session, unavailable storage, and uncertain outcome fail closed',async()=>{
 const {backend,id}=await fixture();let calls=0;
 const options={count,requestModel:async()=>{calls++;return model();},env:{NOOR_DAILY_CLAUDE_CREW_REQUESTS:'1'}};
 await runCrewClaude(args,id,options);await assert.rejects(()=>runCrewClaude(args,id,options),e=>e.status===429&&e.scope==='crew');
 const second=await fixture();second.backend.failReserve=true;
 await assert.rejects(()=>runCrewClaude(args,second.id,{count,requestModel:async()=>{calls++;return model();}}),e=>e.status===503);
 assert.equal(calls,1);second.backend.failReserve=false;
 await assert.rejects(()=>runCrewClaude(args,second.id,{count,requestModel:async()=>{throw Error('Unknown provider result');}}));
 assert.equal(second.backend.ledger[0].state,'uncertain');assert.equal(second.backend.ledger[0].actual,null);
});
test('per-sign-in request cap persists across minute windows',async()=>{
 const {backend,id}=await fixture();const options={count,requestModel:model,env:{NOOR_DAILY_CLAUDE_CREW_SESSION_REQUESTS:'2'}};
 await runCrewClaude(args,id,options);await runCrewClaude(args,id,options);backend.advance(60001);
 await assert.rejects(()=>runCrewClaude(args,id,options),e=>e.status===429&&e.scope==='session');
 assert.equal(backend.ledger.length,2);
});
test('invalid settings and service-only migration guards',async()=>{
 assert.throws(()=>crewClaudeLimits({NOOR_DAILY_CLAUDE_CREW_TOKENS:'0'}),CrewBudgetError);
 assert.deepEqual(Object.fromEntries(Object.entries(crewClaudeLimits({})).filter(([key])=>['crewRequests','crewTokens','sessionRequests','minuteRequests'].includes(key))),{crewRequests:80,crewTokens:60000,sessionRequests:40,minuteRequests:6});
 const sql=await readFile(new URL('../supabase/migrations/20261018072000_noor_crew_claude_budget.sql',import.meta.url),'utf8');
 assert.doesNotMatch(sql,/\b(?:drop|truncate)\b/i);
 assert.match(sql,/pg_advisory_xact_lock\(826401825001::bigint\)/);
 assert.match(sql,/crew_session_id is not null/);
 assert.match(sql,/coalesce\(actual_tokens,reserved_tokens\)/);
 for(const table of ['noor_email_verifications','noor_email_jobs','noor_email_events','noor_usage_events','noor_crew_sessions'])assert.match(sql,new RegExp('public\\.'+table));
 assert.match(sql,/delete from public\.noor_crew_sessions where expires_at < now\(\)/);
 for(const name of ['noor_reserve_crew_model_call','noor_settle_crew_model_call']){
  assert.match(sql,new RegExp('revoke all on function public\\.'+name+'[^;]+from public,anon,authenticated'));
  assert.match(sql,new RegExp('grant execute on function public\\.'+name+'[^;]+to service_role'));
 }
});
