import { scoreAgentTurn } from '../prototype/agent-evaluation.mjs';
import { requiredEvidence } from '../prototype/evidence.mjs';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
if (!process.argv.includes('--live')) {
 console.log('Live evaluation is opt-in and uses Claude API credits. Run with --live, optionally --case=on-time-status or --from=landed-status. Offline tests: npm run test:agent');
 process.exit(0);
}
const fixtures=JSON.parse(await readFile(new URL('../prototype/agent-scenarios.json',import.meta.url),'utf8'));
const selected=process.argv.find(a=>a.startsWith('--case='))?.slice(7);
const from=process.argv.find(a=>a.startsWith('--from='))?.slice(7);
if(from&&!fixtures.some(s=>s.id===from))throw new Error('Unknown starting scenario ID.');
const cases=selected?fixtures.filter(s=>s.id===selected):from?fixtures.slice(fixtures.findIndex(s=>s.id===from)):fixtures;
if(!cases.length)throw new Error('Unknown scenario ID.');
const base='http://127.0.0.1:4173';
const dataDir=resolve(process.env.NOOR_DATA_DIR||fileURLToPath(new URL('../prototype/data/',import.meta.url)));
await mkdir(dataDir,{recursive:true});
const identityPath=resolve(dataDir,'agent-eval-visitor.json');
const jar=new Map();
try {
 const saved=JSON.parse(await readFile(identityPath,'utf8'));
 if(typeof saved.visitor!=='string'||!/^noor_visitor=[a-f0-9]{64}$/.test(saved.visitor))throw new Error('Invalid saved evaluation identity; refusing to silently replace it.');
 const [key,value]=saved.visitor.split('=');
 jar.set(key,value);
}catch(error){if(error.code!=='ENOENT')throw error;}
let blocked=false,failed=0;
const report=[];
function record(result){report.push(result);console.log(JSON.stringify(result));}
async function post(path,body){
 const response=await fetch(base+path,{method:'POST',headers:{origin:base,'content-type':'application/json',cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')},body:JSON.stringify(body)});
 for(const value of response.headers.getSetCookie()){
  const pair=value.split(';')[0],i=pair.indexOf('=');
  jar.set(pair.slice(0,i),pair.slice(i+1));
 }
 if(jar.has('noor_visitor'))await writeFile(identityPath,JSON.stringify({visitor:'noor_visitor='+jar.get('noor_visitor')})+'\n',{mode:0o600});
 if(response.status===429)blocked=true;
 return response;
}
for(const scenario of cases){
 if(blocked){record({scenario:scenario.id,status:'skipped',reason:'usage_or_rate_limit'});continue;}
 const started=await post('/api/session',{});
 if(!started.ok){record({scenario:scenario.id,status:'blocked',httpStatus:started.status});failed++;break;}
 try{
  for(const message of scenario.history||[])if(message.role==='user'){
   const prep=await post('/api/chat',{useTools:true,message:message.content,...scenario.context});
   if(!prep.ok)throw Object.assign(new Error('Context setup failed'),{status:prep.status});
  }
  const response=await post('/api/chat',{useTools:true,message:scenario.message,...scenario.context});
  const result=await response.json();
  if(!response.ok){record({scenario:scenario.id,status:response.status===429?'blocked':'failed',httpStatus:response.status,traceId:result.traceId,limitScope:result.limitScope});failed++;continue;}
  const used=Array.isArray(result.toolsUsed)?result.toolsUsed:[];
  const expected=scenario.tools.map(t=>t.name);
  const toolMatch=expected.every(name=>used.includes(name))&&(expected.length>0||used.length===0);
  const flagMatch=!scenario.flag||Boolean(result[scenario.flag]);
  const evidenceMatch=['grounded','not_required'].includes(result.evidenceStatus)&&(!requiredEvidence(scenario.message,scenario.history||[]).length||result.evidenceStatus==='grounded');
  const score=scoreAgentTurn({...scenario,evidence:requiredEvidence(scenario.message,scenario.history||[]).length?'grounded':undefined},result);
  const pass=toolMatch&&flagMatch&&evidenceMatch&&score.status==='passed';
  if(!pass)failed++;
  record({scenario:scenario.id,status:pass?'passed':'failed',toolsUsed:used,expectedTools:expected,traceId:result.traceId,evidenceStatus:result.evidenceStatus,checks:{...score.checks,toolMatch,flagMatch,evidenceMatch},dimensions:score.dimensions});
 }catch(error){failed++;record({scenario:scenario.id,status:'failed',httpStatus:error.status||null});}
 finally{await post('/api/session/end',{});}
}
await writeFile(resolve(dataDir,'agent-eval-latest.json'),JSON.stringify({at:new Date().toISOString(),results:report},null,2)+'\n');
process.exitCode=blocked?2:failed?1:0;
