import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpeechMouth} from './speech-mouth.js';
function fixture(){
 const callbacks=new Map(),values=[];let id=0,time=0,resets=0;
 const source=()=>({connections:new Set(),connect(node){this.connections.add(node);},disconnect(node){this.connections.delete(node);}});
 const media=source(),buffer=source();
 const context={state:'running',destination:{},createMediaElementSource:()=>media,createAnalyser:()=>({fftSize:512,disconnect(){},getFloatTimeDomainData(values){values.fill(.2);}})};
 const driver=createSpeechMouth({getAvatar:()=>({setMouthOpen:value=>values.push(value),resetMouth:()=>resets++}),requestFrame:callback=>{callbacks.set(++id,callback);return id;},cancelFrame:key=>callbacks.delete(key)});
 const tick=()=>{const pending=[...callbacks.values()];callbacks.clear();time+=16;pending.forEach(callback=>callback(time));};
 class AudioFixture extends EventTarget{paused=false;ended=false;}
 const audio=new AudioFixture();const unwatch=driver.watchMediaElement(audio,()=>context);
 return{driver,context,buffer,media,audio,unwatch,tick,values,callbacks,get resets(){return resets;}};
}
test('cold HTMLAudio load cleanup cannot stop the first BufferSource analyser',()=>{
 const f=fixture();f.driver.trackSource(f.buffer,f.context);f.tick();const before=f.resets;
 f.audio.dispatchEvent(new Event('emptied'));assert.equal(f.callbacks.size,1);f.tick();assert(f.values.at(-1)>0);assert.equal(f.resets,before);f.driver.stop();
});
test('queued HTMLAudio stop events cannot cancel a newer BufferSource analyser',()=>{
 const f=fixture();f.audio.dispatchEvent(new Event('playing'));f.tick();
 f.driver.trackSource(f.buffer,f.context);f.tick();const before=f.resets;
 for(const name of ['pause','emptied','ended','waiting','error']){
  f.audio.dispatchEvent(new Event(name));
  assert.equal(f.callbacks.size,1,`${name} cancelled unrelated buffer analysis`);
  f.tick();assert(f.values.at(-1)>0);
 }
 assert.equal(f.resets,before,'Unrelated media events reset native mouth');f.driver.stop();
});
test('current HTMLAudio pause still detaches its analyser and resets mouth',()=>{
 const f=fixture();f.audio.dispatchEvent(new Event('playing'));f.tick();const before=f.resets;
 f.audio.dispatchEvent(new Event('pause'));assert.equal(f.callbacks.size,0);assert.equal(f.resets,before+1);assert.equal(f.media.connections.size,1,'Audio destination remains connected for replay');
});
test('media listener removal cannot stop an independently tracked BufferSource',()=>{
 const f=fixture();f.driver.trackSource(f.buffer,f.context);f.tick();f.unwatch();assert.equal(f.callbacks.size,1);f.tick();assert(f.values.at(-1)>0);f.driver.stop();
});
test('a rejected old media resume cannot cancel newer buffer analysis',async()=>{
 const f=fixture();let rejectResume;f.context.state='suspended';f.context.resume=()=>new Promise((_,reject)=>{rejectResume=reject;});
 f.audio.dispatchEvent(new Event('playing'));f.context.state='running';f.driver.trackSource(f.buffer,f.context);f.tick();const before=f.resets;
 rejectResume(new Error('old media resume rejected'));await Promise.resolve();assert.equal(f.callbacks.size,1);assert.equal(f.resets,before);f.tick();assert(f.values.at(-1)>0);f.driver.stop();
});
