import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const code=[section('function setDictationRecording(active)', 'function finishRecording(discard'),section('function stopSpeech()','function clearRecordingPreview()'),section('async function speakReply(text)',"voiceAudio.addEventListener('ended'"),section('function setAvatarState(state)','function animateNoor()'),section('function finishRecording(discard = false)','function interruptNoor()'),section('function reviewTranscript(transcript)','function startBrowserRecognition()'),section('function startBrowserRecognition()','async function startRecording()'),section('async function startSession(', 'function clearConversationDisplay()')].join('\n');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const drain=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
function fixture(){
 const states=[];
 const c={selectedJourney:{id:'tokyo'},encodeURIComponent,dictationIndicator:{hidden:true},AbortController,Date,URL:{createObjectURL:()=> 'blob:fixture',revokeObjectURL(){}},window:{noorAvatar:{setState:s=>states.push(s)},location:{protocol:'http:'},setTimeout:()=>1},clearTimeout(){},voiceGeneration:0,voiceEnabled:true,voiceAvailable:true,voiceRequest:undefined,voiceSource:undefined,voiceContext:undefined,voiceUrl:undefined,chatRequest:undefined,voiceRestartAfter:0,vercelPreview:false,speechMouthReady:Promise.resolve(),speechMouth:{stop(){},trackSource(){}},voiceStatus:{textContent:''},playReplyButton:{hidden:true},voiceAudio:{paused:true,pause(){this.paused=true;},removeAttribute(){},load(){},play(){this.paused=false;return Promise.resolve();}},avatarState:'welcoming',noor:{dataset:{}},fetch:async()=>({ok:true,blob:async()=>({arrayBuffer:async()=>new ArrayBuffer(1)})}),input:{value:'',maxLength:1000,focus(){}},micStatus:{},micSequence:0,discardRecording:false,browserRecognition:undefined,browserRecognitionDraft:undefined,recorder:undefined,sessionReady:true,recordTimeout:undefined,sessionTimer:undefined,transcriptReview:{},reviewingTranscript:false,interruptNoor(){c.stopSpeech();c.setAvatarState('idle');},clearTranscriptReview(){},clearRecordingPreview(){},setVoiceEnabled(){},canTalk:()=>true,scheduleSessionEnd(){},sessionStatus:{}};
 for(const name of ['sendButton','doneButton','talkButton','boardingTimeButton','baggageGuidanceButton','weatherAvailabilityButton','arrivalNoteButton','weatherNowButton','weatherArrivalButton','otherWeatherButton','arrivalEmailButton','endConversationButton'])c[name]={};
 c.talkButton.setAttribute=function(k,v){this[k]=v;};
 c.BrowserSpeechRecognition=class{start(){}stop(){}abort(){}};
 vm.createContext(c);vm.runInContext(code,c);return{c,states};
}
test('speech generation stays idle and stale response cannot restore speaking after Stop',async()=>{
 const {c,states}=fixture(),pending=deferred();c.fetch=()=>pending.promise;
 const task=c.speakReply('fixture');assert.equal(c.avatarState,'idle');assert.equal(c.noor.dataset.pose,'welcome');assert(!states.includes('speaking'));
 c.stopSpeech();assert.equal(c.avatarState,'idle');pending.resolve({ok:true,blob:async()=>({})});await task;assert.equal(c.avatarState,'idle');
});
test('WebAudio speaks only after source start; end and Stop reset with stale callback protection',async()=>{
 const {c}=fixture();let started=false;
 const node={connect(){},disconnect(){},start(){started=true;},stop(){}};
 c.voiceContext={state:'running',destination:{},decodeAudioData:async()=>({}),createBufferSource:()=>node};
 await c.speakReply('fixture');assert(started);assert.equal(c.avatarState,'speaking');
 node.onended();assert.equal(c.avatarState,'idle');await c.speakReply('fixture');const oldEnd=node.onended;
 c.stopSpeech();c.setAvatarState('listening');oldEnd();assert.equal(c.avatarState,'listening');
});
test('HTMLAudio waits for actual playing and preserves newer state against stale media callbacks',async()=>{
 const {c}=fixture();await c.speakReply('fixture');assert.equal(c.avatarState,'idle');
 c.voiceAudio.onplaying();assert.equal(c.avatarState,'speaking');c.voiceAudio.onwaiting();assert.equal(c.avatarState,'idle');
 c.voiceAudio.onplaying();c.voiceAudio.onpause();assert.equal(c.avatarState,'idle');
 c.voiceAudio.onerror();assert.equal(c.avatarState,'error');const stale=c.voiceAudio.onplaying;
 c.stopSpeech();c.setAvatarState('welcoming');stale();assert.equal(c.avatarState,'welcoming');assert.equal(c.voiceAudio.onplaying,null);
});
test('blocked HTMLAudio remains idle; synthesis failure becomes error',async()=>{
 const {c}=fixture();c.voiceAudio.play=async()=>{throw new Error('blocked');};await c.speakReply('fixture');assert.equal(c.avatarState,'idle');
 c.fetch=async()=>{throw new Error('unavailable');};await c.speakReply('fixture');assert.equal(c.avatarState,'error');
});
test('recognition listens only on start; failures and old-session callbacks are bounded',()=>{
 const {c}=fixture();c.startBrowserRecognition();const recognition=c.browserRecognition;
 assert.equal(c.avatarState,'idle');recognition.onstart();assert.equal(c.avatarState,'listening');
 recognition.onerror({error:'not-allowed'});assert.equal(c.avatarState,'error');recognition.onend();assert.equal(c.avatarState,'error');
 c.micSequence++;c.setAvatarState('welcoming');recognition.onstart();recognition.onend();assert.equal(c.avatarState,'welcoming');
});
test('recording completion waits thoughtfully; discard and transcript review return idle',()=>{
 const {c}=fixture();c.recorder={state:'recording',stop(){}};c.finishRecording();assert.equal(c.avatarState,'thoughtful');c.finishRecording(true);assert.equal(c.avatarState,'idle');c.setAvatarState('thoughtful');c.reviewTranscript('hello');assert.equal(c.avatarState,'idle');
});
test('session readiness and failures use welcoming/error without changing PNG pose mapping',async()=>{
 const {c}=fixture();await c.startSession();assert.equal(c.avatarState,'welcoming');c.fetch=async()=>{throw new Error('offline');};await c.startSession();assert.equal(c.avatarState,'error');
 c.setPose('thoughtful');assert.equal(c.noor.dataset.pose,'thinking');assert.equal(c.avatarState,'thoughtful');c.setPose('welcome');assert.equal(c.noor.dataset.pose,'welcome');assert.equal(c.avatarState,'welcoming');
});

test('thinking artwork is shown only while preparing a reply and cleared for speech and Stop',()=>{
 const {c}=fixture();
 c.setAvatarState('thoughtful');
 assert.equal(c.noor.dataset.pose,'thinking');
 assert.equal(c.noor.dataset.avatarState,'thoughtful');
 c.setAvatarState('speaking');
 assert.equal(c.noor.dataset.pose,'welcome');
 assert.equal(c.noor.dataset.avatarState,'speaking');
 c.stopSpeech();
 assert.equal(c.noor.dataset.pose,'welcome');
 assert.equal(c.noor.dataset.avatarState,'idle');
});

test('enabling voice does not replay history or replace the current chat pose',()=>{
 const {c}=fixture();let requests=0;
 c.voiceToggle={setAttribute(){},textContent:''};
 c.conversation=[{role:'assistant',content:'Previous reply'}];
 c.unlockVoicePlayback=()=>{};
 c.speakReply=()=>{requests++;};
 vm.runInContext(section('function setVoiceEnabled(enabled)',"voiceToggle.addEventListener('click'"),c);
 c.setAvatarState('idle');c.setVoiceEnabled(true);
 assert.equal(requests,0);assert.equal(c.avatarState,'idle');assert.equal(c.noor.dataset.pose,'welcome');
 c.setAvatarState('thoughtful');c.setVoiceEnabled(true);
 assert.equal(requests,0);assert.equal(c.avatarState,'thoughtful');
});

test('browser recognition enables the same finish control and releases it on completion', () => {
 const {c}=fixture(); c.startBrowserRecognition(); const recognition=c.browserRecognition;
 assert.equal(c.talkButton.disabled,true);
 recognition.onstart(); assert.equal(c.talkButton.disabled,false); assert.equal(c.talkButton['aria-pressed'],'true'); assert.equal(c.dictationIndicator.hidden,false);
 c.finishRecording(); assert.equal(c.dictationIndicator.hidden,true); assert.equal(c.input.hidden,false);
 recognition.onend(); assert.equal(c.talkButton.disabled,false); assert.equal(c.talkButton['aria-label'],'Dictate a message');
});
