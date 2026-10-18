import test from 'node:test';import assert from 'node:assert/strict';import {POST as dashboard} from './crew-dashboard.mjs';import {POST as crew} from './crew.mjs';import {createHostedTestBackend} from '../lib/test-hosted-backend.mjs';import {createStoredSession} from '../lib/supabase-store.mjs';import {sessionIdCookie} from '../lib/vercel-session.mjs';import {crewAccessCookie,crewAuthorized} from '../lib/crew-dashboard-auth.mjs';
async function fixture(run){const saved={env:{...process.env},fetch:globalThis.fetch};Object.assign(process.env,{SUPABASE_URL:'https://demo.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test_only',NOOR_SESSION_SECRET:'a'.repeat(64),NOOR_CREW_DASHBOARD_KEY:'c'.repeat(64)});const backend=createHostedTestBackend();globalThis.fetch=backend.fetch;try{const id=await createStoredSession('11111111-1111-4111-8111-111111111111');const passenger=sessionIdCookie(id).split(';')[0];const call=async(handler,input,cookie='',origin='https://noor.test')=>{const r=await handler(new Request('https://noor.test/api/crew-dashboard',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(input)}));return {status:r.status,cookies:r.headers.getSetCookie(),...await r.json()};};await run({backend,id,passenger,call});assert.equal(backend.ledger.length,0);}finally{globalThis.fetch=saved.fetch;process.env=saved.env;}}
test('crew access is distinct from passenger access and signed cookies expire or revoke on rotation',()=>fixture(async({call,passenger})=>{
 assert.equal((await call(dashboard,{action:'list'})).status,401);assert.equal((await call(dashboard,{action:'list'},passenger)).status,401);
 assert.equal((await call(dashboard,{action:'login',code:'wrong'})).status,401);
 assert.equal((await call(dashboard,{action:'login',code:'c'.repeat(64)},'','https://foreign.test')).status,403);
 const login=await call(dashboard,{action:'login',code:'c'.repeat(64)});assert.equal(login.status,200);assert.match(login.cookies[0],/HttpOnly; Secure; SameSite=Strict/);
 const cookie=login.cookies[0].split(';')[0];assert.equal((await call(dashboard,{action:'list'},cookie)).status,200);
 const request=c=>new Request('https://noor.test/api/crew-dashboard',{headers:{cookie:c}});
 assert.equal(crewAuthorized(request(cookie+'x')),false);assert.equal(crewAuthorized(request(crewAccessCookie(Date.now()-7200001).split(';')[0])),false);
 process.env.NOOR_CREW_DASHBOARD_KEY='d'.repeat(64);assert.equal(crewAuthorized(request(cookie)),false);
 const logout=await call(dashboard,{action:'logout'},cookie);assert.match(logout.cookies[0],/Max-Age=0/);
}));
test('only confirmed requests reach crew; status updates are fresh for passengers and conflict with stale writes',()=>fixture(async({call,passenger,id,backend})=>{
 const cookie=(await call(dashboard,{action:'login',code:'c'.repeat(64)})).cookies[0].split(';')[0];
 const review=await call(crew,{action:'review',category:'seat',details:'Seat recline is stuck'},passenger);assert.deepEqual((await call(dashboard,{action:'list'},cookie)).requests,[]);
 const submitted=await call(crew,{action:'submit',token:review.draft.token,confirmed:true},passenger);const request=submitted.request;
 assert.equal((await call(dashboard,{action:'list'},cookie)).requests.length,1);assert.equal((await call(dashboard,{action:'list'},cookie)).requests[0].token,undefined);
 const update=(status,expectedStatus)=>call(dashboard,{action:'update',sessionId:id,id:request.id,status,expectedStatus},cookie);
 assert.equal((await update('completed','submitted')).status,400);
 assert.equal((await update('acknowledged','submitted')).status,200);assert.equal((await update('acknowledged','submitted')).status,200);
 assert.equal((await update('in_progress','submitted')).status,409);
 assert.equal((await call(crew,{action:'list'},passenger)).requests[0].status,'acknowledged');
 assert.equal((await update('in_progress','acknowledged')).status,200);assert.equal((await update('completed','in_progress')).status,200);
 assert.equal((await call(crew,{action:'list'},passenger)).requests[0].status,'completed');
 assert.equal((await call(crew,{action:'cancel',id:request.id},passenger)).status,409);
 assert.equal(backend.sessions.get(id).actions_version>=5,true);
 backend.advance(900001);assert.deepEqual((await call(dashboard,{action:'list'},cookie)).requests,[]);assert.equal((await update('acknowledged','submitted')).status,404);
}));
