import test from 'node:test';import assert from 'node:assert/strict';
import {once} from 'node:events';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {DatabaseSync} from 'node:sqlite';
test('local HTTP guidance returns retrievable source pages and redacted traces',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'noor-guidance-http-')),originalFetch=globalThis.fetch;let server,db,calls=0;
 try{
  Object.assign(process.env,{PORT:'0',NOOR_HOST:'127.0.0.1',NOOR_SKIP_VOICE_WARMUP:'1',NOOR_EMAIL_DB:':memory:',NOOR_USAGE_DB:':memory:',NOOR_DATA_DIR:dir,ANTHROPIC_API_KEY:'offline-guidance-key',ANTHROPIC_MODEL:'claude-test'});
  globalThis.fetch=async(url,options)=>{
   if(String(url)==='https://api.anthropic.com/v1/messages/count_tokens')return Response.json({input_tokens:100});
   if(String(url)!=='https://api.anthropic.com/v1/messages')return originalFetch(url,options);
   let content;
   if(++calls===1)content=[{type:'tool_use',id:'private-guidance-call',name:'passenger_guidance',input:{question:'My suitcase is damaged and I travel with medication'}}];
   else{
    const body=JSON.parse(options.body),packet=JSON.parse(body.messages.at(-1).content[0].content);
    assert.ok(packet.facts.passages.some(p=>p.source.id==='baggage'));assert.ok(packet.facts.passages.some(p=>p.source.id==='passenger-needs'));
    content=[{type:'text',text:JSON.stringify({reply:'Contact the airline for its reporting process and medication guidance.',expression:'thoughtful'})}];
   }
   return Response.json({content,usage:{input_tokens:100,output_tokens:20}});
  };
  ({server}=await import('./server.mjs'));if(!server.listening)await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port,start=await originalFetch(base+'/api/session',{method:'POST'}),cookie=start.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const response=await originalFetch(base+'/api/chat',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({useTools:true,message:'My suitcase is damaged and I travel with medication'})});
  assert.equal(response.status,200);const result=await response.json();assert.ok(result.knowledgeSources.length>=2);
  for(const source of result.knowledgeSources){const page=await originalFetch(base+source.url);assert.equal(page.status,200);assert.ok((await page.text()).includes('### '+source.section));assert.ok(result.reply.includes('['+source.citationId+']'));}
  db=new DatabaseSync(join(dir,'agent-traces.sqlite'),{readOnly:true});const rows=db.prepare('SELECT metadata FROM agent_events WHERE trace_id=?').all(result.traceId);
  assert.ok(rows.length);for(const value of ['private-guidance-call','suitcase','medication','offline-guidance-key',cookie])assert.ok(!JSON.stringify(rows).includes(value));
 }finally{globalThis.fetch=originalFetch;db?.close();if(server)await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
