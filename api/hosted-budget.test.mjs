import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';import {readFile} from 'node:fs/promises';
import {runHostedClaude,HostedBudgetError,hostedClaudeLimits} from '../lib/hosted-budget.mjs';
import {POST as start} from './session.mjs';import {POST as chat} from './chat.mjs';import {createHostedTestBackend} from '../lib/test-hosted-backend.mjs';
process.env.NOOR_SESSION_SECRET=randomBytes(32).toString('hex');process.env.SUPABASE_URL='https://demo.supabase.co';process.env.SUPABASE_SECRET_KEY='sb_secret_test_only';process.env.ANTHROPIC_API_KEY='offline-budget-key';
const request=(path,cookie,message)=>new Request('https://noor.example'+path,{method:'POST',headers:{origin:'https://noor.example',...(cookie?{cookie}:{})},...(message?{body:JSON.stringify({message,useTools:false})}:{})});
const result=()=>Response.json({content:[{type:'text',text:'{"reply":"Welcome aboard."}'}],usage:{input_tokens:10,output_tokens:5}});
async function fixture(model=async()=>result()){
 for(const suffix of ['VISITOR_REQUESTS','GLOBAL_REQUESTS','VISITOR_TOKENS','GLOBAL_TOKENS'])delete process.env['NOOR_DAILY_CLAUDE_'+suffix];
 const backend=createHostedTestBackend(model);globalThis.fetch=backend.fetch;const started=await start(request('/api/session'));assert.equal(started.status,200);const cookie=started.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');return {backend,cookie,id:[...backend.sessions.keys()][0]};
}
const args={apiKey:'offline',model:'claude-test',system:'scope',messages:[{role:'user',content:'Hello'}]};

test('concurrent model reservations cannot overdraw the shared allowance, and actual settlement frees unused capacity',async()=>{
 let release,started;const ready=new Promise(r=>{started=r;}),hold=new Promise(r=>{release=r;});let calls=0;
 const f=await fixture(async()=>{calls++;if(calls===1){started();await hold;}return result();});process.env.NOOR_DAILY_CLAUDE_GLOBAL_TOKENS='1000';
 const first=runHostedClaude(args,f.id);await ready;
 await assert.rejects(()=>runHostedClaude(args,f.id),e=>e instanceof HostedBudgetError&&e.status===429&&e.scope==='global');assert.equal(calls,1);assert.equal(f.backend.ledger.length,1);assert.equal(f.backend.ledger[0].state,'reserved');release();await first;assert.equal(f.backend.ledger[0].actual,15);await runHostedClaude(args,f.id);assert.equal(calls,2);assert.equal(f.backend.ledger.length,2);
});
test('unknown provider outcomes keep the reservation and prevent subsequent overspending',async()=>{
 let calls=0;const f=await fixture(async()=>{calls++;throw Error('Unknown outcome');});process.env.NOOR_DAILY_CLAUDE_GLOBAL_TOKENS='1000';await assert.rejects(()=>runHostedClaude(args,f.id));assert.equal(f.backend.ledger[0].state,'uncertain');assert.equal(f.backend.ledger[0].actual,null);await assert.rejects(()=>runHostedClaude(args,f.id),e=>e.status===429);assert.equal(calls,1);
});
test('missing usage retains reserved tokens and a failed settlement never refunds them',async()=>{
 const f=await fixture(async()=>Response.json({content:[{type:'text',text:'{"reply":"Hello."}'}]}));await runHostedClaude(args,f.id);assert.equal(f.backend.ledger[0].actual,null);assert.equal(f.backend.ledger[0].state,'done');f.backend.failSettle=true;await assert.rejects(()=>runHostedClaude(args,f.id),e=>e.status===503);assert.equal(f.backend.ledger[1].state,'reserved');
});
test('unavailable budget storage fails closed before calling Claude',async()=>{
 let calls=0;const f=await fixture(async()=>{calls++;return result();});f.backend.failReserve=true;const response=await chat(request('/api/chat',f.cookie,'Hello'));assert.equal(response.status,503);assert.equal(calls,0);assert.equal(f.backend.ledger.length,0);
});
test('each repair/tool model round is reserved, not just the incoming chat request',async()=>{
 let models=0;const f=await fixture(async()=>{models++;const content=models===2?[{type:'tool_use',id:'status',name:'flight_status',input:{flightId:'CL204'}}]:[{type:'text',text:'{"reply":"Please check flight information."}'}];return Response.json({content,usage:{input_tokens:10,output_tokens:5}});});
 const response=await chat(request('/api/chat',f.cookie,'Are we delayed?'));assert.equal(response.status,200);assert.equal((await response.json()).evidenceStatus,'grounded');assert.equal(models,3);assert.equal(f.backend.ledger.length,3);assert.equal([...f.backend.sessions.values()][0].calls,1);assert.ok(f.backend.ledger.every(r=>r.state==='done'&&r.actual===15));
});
test('a model-round cap stops before the next provider call',async()=>{
 let models=0;const f=await fixture(async()=>{models++;return Response.json({content:models===1?[{type:'tool_use',id:'status',name:'flight_status',input:{flightId:'CL204'}}]:[{type:'text',text:'{"reply":"Check the status."}'}],usage:{input_tokens:10,output_tokens:5}});});process.env.NOOR_DAILY_CLAUDE_VISITOR_REQUESTS='1';const response=await chat(request('/api/chat',f.cookie,'Are we delayed?'));assert.equal(response.status,429);assert.equal(models,1);assert.equal(f.backend.ledger.length,1);
});
test('limits reject malformed configuration and migration preserves existing records with service-only transactional RPCs',async()=>{
 assert.throws(()=>hostedClaudeLimits({NOOR_DAILY_CLAUDE_GLOBAL_TOKENS:'0'}),HostedBudgetError);assert.throws(()=>hostedClaudeLimits({NOOR_DAILY_CLAUDE_GLOBAL_REQUESTS:'not-a-number'}),HostedBudgetError);
 const sql=await readFile(new URL('../supabase/migrations/20261018_noor_hosted_budget.sql',import.meta.url),'utf8');assert.doesNotMatch(sql,/\b(?:drop|truncate|delete\s+from)\b/i);assert.match(sql,/pg_advisory_xact_lock\(826401825001::bigint\)/);assert.match(sql,/now\(\) at time zone 'UTC'/);assert.match(sql,/coalesce\(actual_tokens,reserved_tokens\)/);assert.match(sql,/state='reserved'/);
 for(const fn of ['noor_reserve_demo_model_call','noor_settle_demo_model_call','noor_complete_demo_call_v2']){assert.match(sql,new RegExp('revoke all on function public\\.'+fn+'[^;]+from public,anon,authenticated'));assert.match(sql,new RegExp('grant execute on function public\\.'+fn+'[^;]+to service_role'));}
});
