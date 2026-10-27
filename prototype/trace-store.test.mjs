import test from 'node:test';
import assert from 'node:assert/strict';
import { createTraceStore, safeTraceFields } from './trace-store.mjs';
test('trace allowlist excludes prompts, arguments, credentials and unknown tools',()=>{
 const safe=safeTraceFields({status:'success',tool:'secret-key',model:'secret-key',tokens:12,query:'passenger@example.com',apiKey:'sk-private',cookie:'session',reply:'Private answer',error:'Secret failure'},['flight_status']);
 assert.deepEqual(safe,{status:'success',tool:'unknown',tokens:12});
});
test('traces persist across reopen, are bounded, and expire',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'noor-traces-'));
 let now=1000;
 const path=join(dir,'traces.sqlite');
 let store;
 try{
 store=createTraceStore({dbPath:path,clock:()=>now,retentionMs:100,maxEvents:3});
 const trace=store.start();
 for(let i=0;i<5;i++)trace.event('tool_end',{tool:'injected-secret',tokens:i,prompt:'private'});
 assert.equal(store.read().length,3);
 assert.ok(!JSON.stringify(store.read()).includes('private'));
 store.close();store=null;
 store=createTraceStore({dbPath:path,clock:()=>now,retentionMs:100,maxEvents:3});
 assert.equal(store.read().length,3);
 now=1101;assert.equal(store.read().length,0);
 }finally{store?.close();await rm(dir,{recursive:true,force:true});}
});

test('usage and timing counters accept only nonnegative safe integers',()=>{
 const fields=['uncachedInputTokens','outputTokens','cacheCreationInputTokens','cacheReadInputTokens','countDurationMs','reservationDurationMs','providerDurationMs','settlementDurationMs'];
 for(const field of fields){
  assert.deepEqual(safeTraceFields({[field]:0}),{[field]:0});
  for(const value of [-1,1.5,NaN,Infinity,'12',Number.MAX_SAFE_INTEGER+1])assert.deepEqual(safeTraceFields({[field]:value}),{});
 }
});
