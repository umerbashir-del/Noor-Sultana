import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('HTTP follow-up uses session memory after its original topic and preference leave recent history',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'noor-memory-http-')),originalFetch=globalThis.fetch;let server;
 try{
  Object.assign(process.env,{PORT:'0',NOOR_HOST:'127.0.0.1',NOOR_SKIP_VOICE_WARMUP:'1',NOOR_EMAIL_DB:':memory:',NOOR_USAGE_DB:':memory:',NOOR_DATA_DIR:dir,ANTHROPIC_API_KEY:'offline-key',ANTHROPIC_MODEL:'claude-test'});
  let pending=false,followup=false;
  globalThis.fetch=async(url,options)=>{
   if(String(url)==='https://api.anthropic.com/v1/messages/count_tokens')return Response.json({input_tokens:100});
   if(String(url)!=='https://api.anthropic.com/v1/messages')return originalFetch(url,options);
   const args=JSON.parse(options.body),last=args.messages.at(-1);
   let content;
   if(pending){pending=false;content=[{type:'text',text:JSON.stringify({reply:'One checked bag is included.',expression:'thoughtful'})}];}
   else if(last.content==='How many checked bags can I take?'||last.content==='And now?'){
    if(last.content==='And now?'){
     followup=true;assert.ok(!JSON.stringify(args.messages).includes('reply in Spanish'));assert.ok(!JSON.stringify(args.messages).includes('How many checked bags'));
     assert.ok(Array.isArray(args.system));
     assert.equal(args.system[0].cache_control.ttl,'5m');
     assert.ok(!args.system[0].text.includes('SESSION MEMORY ('));
     assert.ok(!args.system[1].cache_control);
     const systemText=args.system.map(block=>block.text).join('');
     assert.match(systemText,/SESSION MEMORY/);assert.match(systemText,/"language":"spanish"/);assert.match(systemText,/"requiredTools":\["baggage_allowance"\]/);assert.match(systemText,/"fare":"basic"/);
    }
    pending=true;content=[{type:'tool_use',id:'bags',name:'baggage_allowance',input:{flightId:'CL204',bagType:'all'}}];
   }else content=[{type:'text',text:JSON.stringify({reply:'Thank you.',expression:'welcoming'})}];
   return Response.json({content,usage:{input_tokens:100,output_tokens:20}});
  };
  ({server}=await import('./server.mjs'));if(!server.listening)await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  const start=await originalFetch(base+'/api/session',{method:'POST'});
  const cookie=start.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  async function send(message,context={}){
   const response=await originalFetch(base+'/api/chat',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({useTools:true,message,...context})});assert.equal(response.status,200);return response.json();
  }
  await send('Please reply in Spanish.');await send('How many checked bags can I take?',{demoFare:'business'});
  for(let i=0;i<9;i++)await send('Thanks');
  // Client-supplied memory must not override the actual server session.
  const result=await send('And now?',{demoFare:'basic',sessionMemory:{topics:['flight_status'],preferences:{language:'japanese'}}});
  assert.ok(followup);assert.equal(result.evidenceStatus,'grounded');assert.match(result.reply,/No checked bag/);assert.deepEqual(result.toolsUsed,['baggage_allowance']);assert.equal(result.sessionMemory,undefined);
 }finally{
  globalThis.fetch=originalFetch;if(server)await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});
 }
});
