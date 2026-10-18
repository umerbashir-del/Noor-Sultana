import { checkRetrievedSources } from '../prototype/retrieval-evaluation.mjs';
import { scoreAgentTurn } from '../prototype/agent-evaluation.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as pause } from 'node:timers/promises';
if (!process.argv.includes('--live')) {
 console.log('Opt-in live hard scenarios: node scripts/eval-agent-hard.mjs --live. Uses the existing evaluation visitor and spending caps.');
 process.exit(0);
}
const suite=process.argv.find(arg=>arg.startsWith('--suite='))?.slice(8)||'hard';
if(!['hard','memory','retrieval','retrieval-memory'].includes(suite))throw new Error('Unknown suite.');
const fixtures=JSON.parse(await readFile(new URL('../prototype/agent-'+suite+'-scenarios.json',import.meta.url),'utf8'));
const selected=process.argv.find(a=>a.startsWith('--case='))?.slice(7);
const from=process.argv.find(a=>a.startsWith('--from='))?.slice(7);
if(from&&!fixtures.some(s=>s.id===from))throw new Error('Unknown starting scenario.');
const cases=selected?fixtures.filter(s=>s.id===selected):from?fixtures.slice(fixtures.findIndex(s=>s.id===from)):fixtures;
if(!cases.length)throw new Error('Unknown scenario.');
if(cases.some(s=>s.turns.some(t=>t.setup==='deterministic-demo'||t.useTools===false)))throw new Error('Legacy no-model setup is retired: all chat requests now use the protected harness. Select a full live scenario; do not assume useTools:false avoids model usage.');
const dataDir=resolve(process.env.NOOR_DATA_DIR||fileURLToPath(new URL('../prototype/data/',import.meta.url)));
await mkdir(dataDir,{recursive:true});
const identityPath=resolve(dataDir,'agent-eval-visitor.json');
// Refuse a fresh identity: harder testing must share the existing visitor budget.
const saved=JSON.parse(await readFile(identityPath,'utf8'));
if(typeof saved.visitor!=='string'||!/^noor_visitor=[a-f0-9]{64}$/.test(saved.visitor))throw new Error('A valid existing evaluation identity is required.');
const jar=new Map([saved.visitor.split('=')]);
const base='http://127.0.0.1:4173';
let previousRequest=0,blocked=false;
const results=[];
const traceDb=new DatabaseSync(resolve(dataDir,'agent-traces.sqlite'),{readOnly:true});
function traceSummary(traceId){
 if(!traceId)return null;
 const events=traceDb.prepare('SELECT event,metadata FROM agent_events WHERE trace_id=? ORDER BY seq').all(traceId).map(e=>({...e,metadata:JSON.parse(e.metadata)}));
 return {end:events.findLast(e=>e.event==='run_end')?.metadata,
 tools:events.filter(e=>e.event==='tool_end').map(e=>e.metadata),
 evidence:events.filter(e=>e.event==='evidence_check').map(e=>e.metadata),
 repairs:events.filter(e=>e.event==='argument_repair'||e.event==='evidence_repair').map(e=>({event:e.event,...e.metadata})),
 errors:events.filter(e=>e.metadata.status==='error').map(e=>({event:e.event,...e.metadata}))};
}
async function post(path,body){
 await pause(Math.max(0,3100-(Date.now()-previousRequest)));
 previousRequest=Date.now();
 const response=await fetch(base+path,{method:'POST',headers:{origin:base,'content-type':'application/json',cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')},body:JSON.stringify(body)});
 for(const cookie of response.headers.getSetCookie()){
  const pair=cookie.split(';')[0],split=pair.indexOf('=');jar.set(pair.slice(0,split),pair.slice(split+1));
 }
 if(jar.get('noor_visitor'))await writeFile(identityPath,JSON.stringify({visitor:'noor_visitor='+jar.get('noor_visitor')})+'\n',{mode:0o600});
 const data=await response.json();
 if(response.status===429)blocked=true;
 return {status:response.status,ok:response.ok,data};
}
function record(value){results.push(value);console.log(JSON.stringify(value));}
try{
 for(const scenario of cases){
  if(blocked){record({scenario:scenario.id,status:'skipped',reason:'usage_or_rate_limit'});continue;}
  const session=await post('/api/session',{});
  if(!session.ok){record({scenario:scenario.id,status:'blocked',httpStatus:session.status});break;}
  try{
   for(const [index,turn] of scenario.turns.entries()){
    const response=await post('/api/chat',{useTools:turn.useTools!==false,message:turn.message,...turn.context});
    const r=response.data;
    if(!response.ok){record({scenario:scenario.id,turn:index+1,status:response.status===429?'blocked':'failed',httpStatus:response.status,limitScope:r.limitScope,traceId:r.traceId,trace:traceSummary(r.traceId)});break;}
    const used=r.toolsUsed||[];
    const trace=traceSummary(r.traceId);
    const setup=turn.setup==='deterministic-demo';
    const setupChecks=setup?{deterministicSetup:r.sourceLabel===(turn.setupSourceLabel||'Demo flight status · Simulated data · Not live')&&(!turn.setupSourceLabel?r.scenario==='on-time':true)&&!r.traceId,contentMatch:(turn.matches||[]).every(text=>r.reply?.includes(text))}:null;
    const score=setup?{status:Object.values(setupChecks).every(Boolean)?'passed':'failed',checks:setupChecks,dimensions:{deterministicSetup:true}}:scoreAgentTurn(turn,r,trace,{action:Boolean(scenario.action)});
    let sourceChecks;
    if(turn.sourceIds){
     sourceChecks=await checkRetrievedSources(turn,r,{readPage:async url=>{const page=await fetch(base+url);if(!page.ok)throw new Error('Source unavailable');return page.text();}});
     score.dimensions.sourceReferences=Object.values(sourceChecks).every(Boolean);
     if(!score.dimensions.sourceReferences)score.status='failed';
    }
    record({scenario:scenario.id,turn:index+1,...(setup?{setup:'deterministic-demo'}:{}),...score,...(sourceChecks?{sourceChecks,sourceIds:(r.knowledgeSources||[]).map(source=>source.citationId)}:{}),toolsUsed:used,traceId:r.traceId,evidenceStatus:r.evidenceStatus,trace});
   }
   if(scenario.action&&!blocked){
    const path='/api/'+scenario.action;
    const listingKey=scenario.action==='crew'?'requests':'reminders';
    const action=scenario.action==='crew'?'submit':'save';
    const before=await post(path,{action:'list'});
    const unconfirmed=await post(path,{action});
    const forged=await post(path,{action,confirmed:true,token:'not-a-reviewed-token'});
    const after=await post(path,{action:'list'});
    const checks={nothingSavedBefore:before.ok&&before.data[listingKey]?.length===0,missingConfirmationRejected:unconfirmed.status===400,forgedReviewRejected:forged.status===409,nothingSavedAfter:after.ok&&after.data[listingKey]?.length===0};
    record({scenario:scenario.id,step:'confirmation-endpoints',status:Object.values(checks).every(Boolean)?'passed':'failed',checks,dimensions:{confirmationSafety:Object.values(checks).every(Boolean)}});
   }
  }finally{await post('/api/session/end',{});}
 }
}finally{
 traceDb.close();
 const turns=results.filter(r=>r.turn);
 const summary={checks:results.length,passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status==='failed').length,blocked:results.filter(r=>r.status==='blocked').length,tokens:turns.reduce((sum,r)=>sum+(r.trace?.end?.tokens||0),0),modelCalls:turns.reduce((sum,r)=>sum+(r.trace?.end?.modelCalls||0),0)};
 await writeFile(resolve(dataDir,'agent-eval-'+suite+'-latest.json'),JSON.stringify({at:new Date().toISOString(),summary,results},null,2)+'\n');
 console.log(JSON.stringify({summary}));
 process.exitCode=blocked?2:results.some(r=>r.status!=='passed')?1:0;
}
