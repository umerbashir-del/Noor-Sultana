import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {createServer} from 'node:http';
import vm from 'node:vm';
import {createVoiceJobQueue,VoiceJobCancelled,VoiceQueueFull} from './voice-jobs.mjs';
import {segmentSpeech} from '../lib/speech-segments.mjs';
import {createSpeechCache} from '../lib/speech-cache.mjs';
const source=await readFile(new URL('./server.mjs',import.meta.url),'utf8');
const slice=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const code=slice('function cancelSessionSpeech(','function ensureAsrWorker()')+slice('async function handleSpeak(','function cookieValueFrom(');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
class Response extends EventEmitter{headersSent=false;destroyed=false;writableEnded=false;writableFinished=false;writes=[];status=0;headers={};setHeader(key,value){this.headers[key]=value;}writeHead(status,headers){this.status=status;this.headers={...this.headers,...headers};this.headersSent=true;return this;}write(value){this.writes.push(value);this.onWrite?.(value);return !this.destroyed;}end(value){if(value!==undefined)this.writes.push(value);this.writableEnded=true;this.writableFinished=true;this.emit('finish');this.emit('close');}close(){this.destroyed=true;this.emit('close');}get lines(){return this.writes.filter(v=>typeof v==='string').join('').trim().split('\n').filter(Boolean).map(v=>JSON.parse(v));}}
function harness({generate=async text=>Buffer.from('RIFF:'+text),cloud=false}={}){
 const calls=[],charges=[],events=[];let active,stops=0,identity='chatterbox-tts@0.1.7:reference-sha-a';
 const voiceJobs=createVoiceJobQueue({run:async payload=>{if(payload?.kind==='identity')return{identity};calls.push(payload);const pending=deferred();active=pending;Promise.resolve(generate(payload)).then(pending.resolve,pending.reject);try{return await pending.promise;}finally{if(active===pending)active=null;}},cancelActive:()=>{stops++;active?.reject(new Error('worker stopped'));}});
 class UsageLimitError extends Error{}
 const context={Buffer,Date,setTimeout,clearTimeout,AbortController,console,cloudSpeech:cloud,replicateVoice:{available:true,speak:async(text,signal)=>{calls.push(text);return generate(text,signal);}},asrRequests:new Map(),speechRequestSequence:0,logEvent:(event,fields)=>events.push({event,...fields}),segmentSpeech,speechCache:createSpeechCache(),speechRequests:new Map(),voiceJobs,VoiceJobCancelled,VoiceQueueFull,UsageLimitError,checkRateLimit:()=>true,sessionFrom:req=>req.session,readJson:async req=>req.body,usageStore:{recordOperation:(visitor,kind)=>charges.push([visitor,kind])}};
 vm.createContext(context);vm.runInContext(code,context);
 const req=(text,stream=true,session='alice')=>Object.assign(new EventEmitter(),{socket:{remoteAddress:'local'},session:{id:session,visitorId:session+'-visitor'},body:{text,stream}});
 return{context,calls,charges,events,req,get stops(){return stops;},setIdentity:value=>identity=value};
}
const longReply='Welcome aboard. '+('Please keep your seat belt fastened while seated. '.repeat(6))+'Thank you.';
test('local stream charges once and emits bounded sequential WAV chunks then done',async()=>{
 const h=harness(),res=new Response();await h.context.handleSpeak(h.req(longReply),res);assert.equal(res.status,200);assert.match(res.headers['content-type'],/ndjson/);assert.equal(h.charges.length,1);assert.deepEqual(h.calls,segmentSpeech(longReply, { local: true }));assert.equal(h.calls.length,5);assert.equal(h.calls.join(' '),longReply.trim());assert.deepEqual(res.lines.map(line=>line.index).filter(Number.isInteger),h.calls.map((_,i)=>i));assert.deepEqual(res.lines.at(-1),{done:true});assert(res.lines.slice(0,-1).every(line=>Buffer.from(line.audio,'base64').toString().startsWith('RIFF:')));
});
test('local legacy request remains a single audio/wav response',async()=>{const h=harness(),res=new Response();await h.context.handleSpeak(h.req(longReply,false),res);assert.equal(res.headers['content-type'],'audio/wav');assert.deepEqual(h.calls,[longReply]);assert.equal(h.charges.length,1);});
test('local auth and full-request quota reject before synthesis',async()=>{
 const h=harness(),res=new Response(),req=h.req('Hello.');req.session=null;await h.context.handleSpeak(req,res);assert.equal(res.status,401);assert.equal(h.charges.length,0);h.context.usageStore.recordOperation=()=>{throw new h.context.UsageLimitError('daily limit');};const capped=new Response();await h.context.handleSpeak(h.req(longReply),capped);assert.equal(capped.status,429);assert.equal(h.calls.length,0);
});
test('local disconnect after first chunk prevents remaining generation',async()=>{const h=harness(),res=new Response();res.onWrite=()=>res.close();await h.context.handleSpeak(h.req(longReply),res);assert.equal(h.calls.length,1);assert.equal(res.lines.length,1);assert.equal(h.context.speechRequests.size,0);});
test('local Stop cancels active stream without submitting later segments',async()=>{const pending=deferred(),h=harness({generate:()=>pending.promise}),res=new Response();const task=h.context.handleSpeak(h.req(longReply),res);await flush();h.context.cancelSessionSpeech('alice');await task;assert.equal(h.stops,1);assert.equal(h.calls.length,1);assert.equal(res.status,409);});
test('local new generation supersedes only its session and prevents old remainder',async()=>{
 const pending=deferred();let first=true;const h=harness({generate:async text=>{if(first){first=false;return pending.promise;}return Buffer.from('RIFF:'+text);}}),old=new Response(),fresh=new Response();const oldTask=h.context.handleSpeak(h.req(longReply),old);await flush();const freshTask=h.context.handleSpeak(h.req('Hello.'),fresh);await Promise.all([oldTask,freshTask]);assert.equal(old.status,409);assert.equal(fresh.lines.at(-1).done,true);assert.deepEqual(h.calls,[segmentSpeech(longReply, { local: true })[0],'Hello.']);
});
test('local queued visitor cancellation does not stop active visitor',async()=>{
 const pending=deferred(),h=harness({generate:()=>pending.promise}),alice=new Response(),bob=new Response();const a=h.context.handleSpeak(h.req('A private reply.',true,'alice'),alice);await flush();const b=h.context.handleSpeak(h.req('Another private reply.',true,'bob'),bob);await flush();h.context.cancelSessionSpeech('bob');await b;assert.equal(h.stops,0);pending.resolve(Buffer.from('RIFF:alice'));await a;assert.equal(alice.lines.at(-1).done,true);assert.equal(bob.status,409);
});
test('local cache only reuses exact fixed phrases and separates engine/reference identities',async()=>{
 const h=harness();for(let i=0;i<2;i++)await h.context.handleSpeak(h.req('Hello.'),new Response());assert.equal(h.calls.length,1);assert.equal(h.charges.length,2);h.setIdentity('chatterbox-tts@0.1.7:reference-sha-b');await h.context.handleSpeak(h.req('Hello.'),new Response());assert.equal(h.calls.length,2);h.setIdentity('chatterbox-tts@0.1.8:reference-sha-b');await h.context.handleSpeak(h.req('Hello.'),new Response());assert.equal(h.calls.length,3);for(let i=0;i<2;i++)await h.context.handleSpeak(h.req('My passenger name is private.'),new Response());assert.equal(h.calls.length,5);
});
test('local stream sanitizes post-header provider failure',async()=>{let count=0;const h=harness({generate:async()=>{if(++count===2)throw new Error('private provider credentials/internal path');return Buffer.from('RIFF:first');}}),res=new Response();await h.context.handleSpeak(h.req(longReply),res);assert.equal(res.status,200);assert(res.lines.at(-1).error);assert(!JSON.stringify(res.lines).includes('credentials'));assert.equal(res.lines.some(line=>line.done),false);});
test('local Stop releases a backpressured final chunk without hanging',async()=>{const h=harness(),res=new Response();res.write=function(value){this.writes.push(value);return false;};const task=h.context.handleSpeak(h.req('Hello.'),res);await flush();assert.equal(res.writableEnded,false);h.context.cancelSessionSpeech('alice');await task;assert.equal(res.writableEnded,true);assert.equal(h.calls.length,1);assert.equal(res.lines.at(-1).error,'Speech was stopped.');});

test('local lifecycle records terminal done, flushed response and clean close with one correlation id',async()=>{
 const h=harness(),res=new Response(),req=h.req('Hello.');await h.context.handleSpeak(req,res);
 assert.deepEqual(h.events.map(event=>event.kind),['start','terminal_done','response_finish','response_close_complete']);
 assert(h.events.every(event=>event.scope===res.headers['x-noor-speech-id']));assert.equal(req.listenerCount('aborted'),0);
 assert(h.events.every(event=>Object.keys(event).every(key=>['event','scope','kind','durationMs'].includes(key))));
});
test('local lifecycle identifies premature disconnect without reporting response finish',async()=>{
 const h=harness(),res=new Response();res.onWrite=()=>res.close();await h.context.handleSpeak(h.req(longReply),res);
 assert.deepEqual(h.events.map(event=>event.kind),['start','response_close_premature','cancel']);
});
test('local lifecycle records aborted request and cleans its listener after cancellation',async()=>{
 const pending=deferred(),h=harness({generate:()=>pending.promise}),res=new Response(),req=h.req(longReply);
 const task=h.context.handleSpeak(req,res);await flush();req.emit('aborted');res.close();await task;
 assert(h.events.some(event=>event.kind==='request_aborted'));assert.equal(req.listenerCount('aborted'),0);
 assert.equal(h.events.some(event=>event.kind==='terminal_done'||event.kind==='response_finish'),false);
});
test('real HTTP response delivers terminal record and EOF with finish and clean close',async()=>{
 const h=harness();
 const server=createServer((req,res)=>{
  req.session={id:'http-fixture',visitorId:'http-fixture-visitor'};req.body={text:longReply,stream:true};
  void h.context.handleSpeak(req,res);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const response=await fetch(`http://127.0.0.1:${server.address().port}/`,{method:'POST'});
  const reader=response.body.getReader();let body='';
  while(true){const part=await reader.read();if(part.done)break;body+=new TextDecoder().decode(part.value);}
  reader.releaseLock();
  const lines=body.trim().split('\n').map(line=>JSON.parse(line));assert.deepEqual(lines.at(-1),{done:true});
  assert.deepEqual(h.events.map(event=>event.kind),['start','terminal_done','response_finish','response_close_complete']);
  assert(h.events.every(event=>event.scope===response.headers.get('x-noor-speech-id')));
 } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('real HTTP client abort records premature close and cancels active generation',{timeout:3000},async()=>{
 const pending=deferred(),completed=deferred();let calls=0;
 const h=harness({generate:async()=>++calls===1?Buffer.from('RIFF:first'):pending.promise});
 const server=createServer((req,res)=>{
  req.session={id:'http-abort',visitorId:'http-abort-visitor'};req.body={text:longReply,stream:true};
  h.context.handleSpeak(req,res).then(completed.resolve,completed.reject);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const controller=new AbortController();
  const response=await fetch(`http://127.0.0.1:${server.address().port}/`,{method:'POST',signal:controller.signal});
  const reader=response.body.getReader();assert.equal((await reader.read()).done,false);
  controller.abort();await assert.rejects(reader.read(),{name:'AbortError'});reader.releaseLock();
  await completed.promise;
  assert(h.events.some(event=>event.kind==='response_close_premature'));
  assert(h.events.some(event=>event.kind==='cancel'));assert.equal(h.stops,1);
  assert.equal(h.events.some(event=>event.kind==='terminal_done'||event.kind==='response_finish'),false);
 } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});


test('local Replicate transport authorizes the current reply and streams three cloud segments without Python jobs', async () => {
 const h=harness({cloud:true}), res=new Response(), req=h.req(longReply);
 req.session.messages=[{role:'assistant',content:longReply}];req.session.revision=2;
 await h.context.handleSpeak(req,res);
 assert.equal(res.status,200);assert.deepEqual(h.calls,segmentSpeech(longReply,{local:false}));
 assert.equal(h.calls.length,3);assert.equal(res.lines.at(-1).done,true);assert.equal(h.stops,0);
 const rejected=new Response(), forged=h.req('Different text.');forged.session.messages=req.session.messages;
 await h.context.handleSpeak(forged,rejected);assert.equal(rejected.status,409);assert.equal(h.calls.length,3);
});

test('local Replicate Stop aborts the current prediction signal and emits no audio', async () => {
 let started;
 const ready=new Promise(resolve=>{started=resolve;});
 const h=harness({cloud:true,generate:(_,signal)=>new Promise((resolve,reject)=>{
  signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});started();
 })}),res=new Response(),req=h.req('Hello.');
 req.session.messages=[{role:'assistant',content:'Hello.'}];req.session.revision=1;
 const task=h.context.handleSpeak(req,res);await ready;h.context.cancelSessionSpeech('alice');await task;
 assert.equal(res.status,409);assert.equal(res.lines.some(line=>line.audio),false);assert.equal(h.context.speechRequests.size,0);
});
