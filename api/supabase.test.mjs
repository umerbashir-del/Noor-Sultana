import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';import {after,test} from 'node:test';
import {POST as start} from './session.mjs';import {POST as chat} from './chat.mjs';import {POST as end} from './session/end.mjs';
import {sessionCookie,freshSession,sessionIdFrom} from '../lib/vercel-session.mjs';import {createHostedTestBackend} from '../lib/test-hosted-backend.mjs';
process.env.NOOR_SESSION_SECRET=randomBytes(32).toString('hex');process.env.ANTHROPIC_API_KEY='offline-test-key';
const originalFetch=globalThis.fetch;after(()=>{globalThis.fetch=originalFetch;});
const request=(path,cookie,message)=>new Request('https://noor.example'+path,{method:'POST',headers:{origin:'https://noor.example',...(cookie?{cookie}:{})},...(message?{body:JSON.stringify({message})}:{})});
const cookies=r=>r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
function setup(){process.env.SUPABASE_URL='https://demo.supabase.co';process.env.SUPABASE_SECRET_KEY='sb_secret_test_only';for(const key of ['VISITOR_REQUESTS','GLOBAL_REQUESTS','VISITOR_TOKENS','GLOBAL_TOKENS'])delete process.env['NOOR_DAILY_CLAUDE_'+key];let calls=0;const backend=createHostedTestBackend(async()=>{calls++;return Response.json({content:[{type:'text',text:'{"reply":"Welcome aboard."}'}],usage:{input_tokens:10,output_tokens:5}});});globalThis.fetch=backend.fetch;return {backend,calls:()=>calls};}

test('hosted endpoints fail closed without server storage and reject legacy cookie sessions',async()=>{
 setup();const legacy=sessionCookie(freshSession()).split(';')[0];delete process.env.SUPABASE_URL;delete process.env.SUPABASE_SECRET_KEY;globalThis.fetch=async()=>{throw Error('Must not call providers');};
 assert.equal((await start(request('/api/session'))).status,503);assert.equal((await chat(request('/api/chat',legacy,'Hello'))).status,503);assert.equal((await end(request('/api/session/end',legacy))).status,503);
 setup();assert.equal((await chat(request('/api/chat',legacy,'Hello'))).status,401);
});
test('server counters and memory survive old cookie replay; ending a session revokes it without erasing usage',async()=>{
 const f=setup(),cookie=cookies(await start(request('/api/session')));const session=[...f.backend.sessions.values()][0];
 for(let i=0;i<100;i++){const result=await chat(request('/api/chat',cookie,'Hello Noor'));assert.equal(result.status,200);}
 assert.equal(session.calls,100);assert.equal((await chat(request('/api/chat',cookie,'Hello Noor'))).status,429);assert.equal(f.calls(),100);assert.equal(f.backend.ledger.length,100);
 assert.equal((await end(request('/api/session/end',cookie))).status,200);assert.equal((await chat(request('/api/chat',cookie,'Hello Noor'))).status,401);assert.equal(f.backend.ledger.length,100);
});
test('server-stored memory wins over an old memory cookie',async()=>{
 const f=setup(),cookie=cookies(await start(request('/api/session')));const row=[...f.backend.sessions.values()][0];row.memory={version:1,topics:[],flightId:'CL204',preferences:{language:'spanish'}};
 const r=await chat(request('/api/chat',cookie,'Thanks'));assert.equal(r.status,200);assert.match((await r.json()).reply,/De nada/);assert.equal(f.calls(),0);assert.equal(row.memory.preferences.language,'spanish');
});
test('visitor budget persists across new and ended conversations',async()=>{
 const f=setup();process.env.NOOR_DAILY_CLAUDE_VISITOR_REQUESTS='1';const first=await start(request('/api/session'));const cookie=cookies(first);const visitor=first.headers.getSetCookie().find(c=>c.startsWith('noor_visitor=')).split(';')[0];const hash=[...f.backend.sessions.values()][0].visitor_hash;
 assert.equal((await chat(request('/api/chat',cookie,'Hello'))).status,200);await end(request('/api/session/end',cookie));const second=await start(request('/api/session',visitor));const next=cookies(second);assert.equal([...f.backend.sessions.values()][0].visitor_hash,hash);assert.notEqual(sessionIdFrom(request('/',next)),sessionIdFrom(request('/',cookie)));
 const denied=await chat(request('/api/chat',next,'Hello'));assert.equal(denied.status,429);assert.equal((await denied.json()).limitScope,'visitor');assert.equal(f.calls(),1);assert.equal(f.backend.ledger.length,1);assert.equal(f.backend.ledger[0].actual,15);
});
test('global budget covers different visitors and UTC rollover retains earlier usage',async()=>{
 const f=setup();process.env.NOOR_DAILY_CLAUDE_GLOBAL_REQUESTS='1';const a=cookies(await start(request('/api/session'))),b=cookies(await start(request('/api/session')));
 assert.equal((await chat(request('/api/chat',a,'Hello'))).status,200);const denied=await chat(request('/api/chat',b,'Hello'));assert.equal(denied.status,429);assert.equal((await denied.json()).limitScope,'global');const old=f.backend.ledger[0];f.backend.advance(86400000);const fresh=cookies(await start(request('/api/session')));assert.equal((await chat(request('/api/chat',fresh,'Hello'))).status,200);assert.equal(f.backend.ledger.length,2);assert.equal(f.backend.ledger[0],old);assert.notEqual(f.backend.ledger[1].day,old.day);
});
