import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));
const code=section('function stopSpeech()','function clearRecordingPreview()')+'\n'+section('async function speakReply(text)',"voiceAudio.addEventListener('ended'");
const drain=async()=>{for(let i=0;i<35;i++)await new Promise(resolve=>setImmediate(resolve));};
function fixture({media=false,blocked=false}={}){
 const starts=[],nodes=[],states=[],mouth=[],urls=new Map();let serial=0,block=blocked;
 const audio={paused:true,ended:false,pause(){this.paused=true;},removeAttribute(){this.src='';},load(){},async play(){if(block){block=false;throw new Error('Autoplay blocked');}this.paused=false;this.ended=false;this.onplaying?.();}};
 const c={AbortController,TextDecoder,Blob,Uint8Array,atob,Date,voiceGeneration:0,voiceEnabled:true,voiceRequest:undefined,voiceSource:undefined,voiceUrl:undefined,voiceRestartAfter:0,chatRequest:undefined,avatarState:'idle',vercelPreview:false,voiceStatus:{textContent:''},playReplyButton:{hidden:true},voiceAudio:audio,URL:{createObjectURL:blob=>{const url='blob:segment-'+serial++;urls.set(url,blob);return url;},revokeObjectURL:url=>urls.delete(url)},speechMouthReady:Promise.resolve(),speechMouth:{stop(){mouth.push('stop');},trackSource(node){mouth.push(node.buffer.id);}},setAvatarState(state){c.avatarState=state;states.push(state);},bindSpeechPlaybackState(){audio.onplaying=()=>c.setAvatarState('speaking');},window:{setTimeout},fetch:undefined};
 c.voiceContext={state:media?'suspended':'running',destination:{},async decodeAudioData(buffer){return{id:new Uint8Array(buffer)[0]};},createBufferSource(){const node={buffer:null,connect(){},disconnect(){this.disconnected=true;},start(){starts.push(this.buffer.id);},stop(){this.stopped=true;}};nodes.push(node);return node;}};
 vm.createContext(c);vm.runInContext(code,c);return{c,starts,nodes,states,mouth,audio,urls};
}
function stream(){let controller,cancelled=false;const body=new ReadableStream({start(c){controller=c;},cancel(){cancelled=true;}});return{response:new Response(body,{headers:{'content-type':'application/x-ndjson'}}),line:entry=>controller.enqueue(new TextEncoder().encode(JSON.stringify(entry)+'\n')),raw:text=>controller.enqueue(new TextEncoder().encode(text)),close:()=>controller.close(),get cancelled(){return cancelled;}};}
const segment=index=>({index,audio:Buffer.from([index+1]).toString('base64')});
test('starts first segment before later generation; plays three segments in order',async()=>{
 const f=fixture(),s=stream();f.c.fetch=async()=>s.response;const task=f.c.speakReply('stream fixture');s.line(segment(0));await drain();assert.deepEqual(f.starts,[1]);s.line(segment(1));s.line(segment(2));s.line({done:true});s.close();await drain();assert.deepEqual(f.starts,[1]);f.nodes[0].onended();await drain();assert.deepEqual(f.starts,[1,2]);f.nodes[1].onended();await drain();assert.deepEqual(f.starts,[1,2,3]);f.nodes[2].onended();await task;assert.equal(f.c.avatarState,'idle');assert.deepEqual(f.mouth.filter(x=>x!=='stop'),[1,2,3]);
});
test('Stop aborts reader, disconnects current source and prevents queued playback',async()=>{
 const f=fixture(),s=stream();f.c.fetch=async()=>s.response;const task=f.c.speakReply('stop fixture');s.line(segment(0));s.line(segment(1));await drain();f.c.stopSpeech();await task;assert.equal(s.cancelled,true);assert.deepEqual(f.starts,[1]);assert.equal(f.nodes[0].stopped,true);assert.equal(f.nodes[0].disconnected,true);assert.notEqual(f.c.avatarState,'speaking');
});
test('new reply cancels old queue; stale completion cannot affect new playback',async()=>{
 const f=fixture(),old=stream(),next=stream();let n=0;f.c.fetch=async()=>n++?next.response:old.response;const first=f.c.speakReply('old');old.line(segment(0));old.line(segment(1));await drain();const stale=f.nodes[0].onended;const second=f.c.speakReply('new');next.line(segment(0));next.line({done:true});next.close();await drain();stale?.();await drain();assert.deepEqual(f.starts,[1,1]);assert.equal(f.c.avatarState,'speaking');f.nodes[1].onended();await Promise.all([first,second]);assert.equal(old.cancelled,true);assert.equal(f.c.avatarState,'idle');
});
for(const kind of ['malformed','truncated','server error'])test(kind+' stream aborts active source and resets mouth',async()=>{
 const f=fixture(),s=stream();f.c.fetch=async()=>s.response;const task=f.c.speakReply(kind);s.line(segment(0));await drain();if(kind==='malformed')s.raw('{broken}\n');else if(kind==='server error')s.line({error:'fixture failure'});s.close();await task;assert.equal(f.c.avatarState,'error');assert.equal(f.nodes[0].stopped,true);assert.equal(f.nodes[0].disconnected,true);assert.equal(f.c.voiceSource,undefined);assert.equal(f.mouth.at(-1),'stop');
});
test('HTMLAudio autoplay block retains queued segments for manual Play',async()=>{
 const f=fixture({media:true,blocked:true}),s=stream();f.c.fetch=async()=>s.response;const task=f.c.speakReply('media fixture');s.line(segment(0));s.line(segment(1));s.line({done:true});s.close();await drain();const firstURL=f.c.voiceUrl;assert(firstURL);assert.equal(f.c.playReplyButton.hidden,false);await f.audio.play();assert.equal(f.c.avatarState,'speaking');f.audio.ended=true;f.audio.onended();await drain();assert.notEqual(f.c.voiceUrl,firstURL);assert.equal(f.audio.paused,false);f.audio.ended=true;f.audio.onended();await task;assert.equal(f.c.avatarState,'idle');assert.equal(f.urls.size,0);
});
for(const kind of ['server error','truncation'])test('blocked HTMLAudio then '+kind+' removes revoked Play reply',async()=>{
 const f=fixture({media:true,blocked:true}),s=stream();f.c.fetch=async()=>s.response;const task=f.c.speakReply('blocked '+kind);s.line(segment(0));await drain();assert.equal(f.c.playReplyButton.hidden,false);assert(f.c.voiceUrl);if(kind==='server error')s.line({error:'fixture failure'});s.close();await task;assert.equal(f.c.voiceUrl,undefined);assert.equal(f.c.playReplyButton.hidden,true);assert.equal(f.c.avatarState,'error');assert.equal(f.mouth.at(-1),'stop');assert.equal(f.urls.size,0);
});
test('late old request error cannot hide a newer blocked stream Play reply',async()=>{
 const f=fixture({media:true,blocked:true}),s=stream();let rejectOld,requests=0;f.c.fetch=()=>requests++?Promise.resolve(s.response):new Promise((_,reject)=>{rejectOld=reject;});const old=f.c.speakReply('old deferred');await drain();const next=f.c.speakReply('new blocked');s.line(segment(0));s.line({done:true});s.close();await drain();const currentURL=f.c.voiceUrl;assert(currentURL);assert.equal(f.c.playReplyButton.hidden,false);rejectOld(new Error('Late old request failure'));await old;assert.equal(f.c.voiceUrl,currentURL);assert.equal(f.c.playReplyButton.hidden,false);assert.equal(f.c.avatarState,'idle');f.c.stopSpeech();await next;
});

test('gaps between audio segments return to idle instead of the thinking pose',async()=>{
 const f=fixture(),s=stream();f.c.fetch=async()=>s.response;
 const task=f.c.speakReply('gap fixture');
 assert.equal(f.c.avatarState,'idle');
 s.line(segment(0));await drain();assert.equal(f.c.avatarState,'speaking');
 f.nodes[0].onended();await drain();assert.equal(f.c.avatarState,'idle');
 s.line(segment(1));s.line({done:true});s.close();await drain();
 assert.equal(f.c.avatarState,'speaking');f.nodes[1].onended();await task;
 assert.equal(f.c.avatarState,'idle');assert(!f.states.includes('thoughtful'));
});
