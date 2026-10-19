import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const section = (a,b) => source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const code = section('async function transcribeForReview(blob)', 'function startBrowserRecognition()')
  + section('async function startRecording()', "talkButton.addEventListener('click'");
const drain = async () => { for (let i=0;i<20;i++) await Promise.resolve(); };
function fixture({ hosted = true, recognition = false, transcription = true } = {}) {
  let stopped = false, pending, requests = 0;
  const tracks = [{ stop() { stopped = true; } }];
  class Recorder {
    static isTypeSupported(type) { return type.startsWith('audio/ogg'); }
    constructor(stream, opts) { this.mimeType=opts.mimeType; this.state='inactive'; this.handlers={}; }
    addEventListener(name, handler) { this.handlers[name]=handler; }
    start() { this.state='recording'; }
    stop() { this.state='inactive'; this.handlers.dataavailable({data:new Blob([new Uint8Array(2000)])}); this.handlers.stop(); }
  }
  const c={Blob,AbortController,MediaRecorder:Recorder,window:{MediaRecorder:Recorder,setTimeout:()=>1},navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>tracks})}},
    sessionReady:true,micStream:undefined,recorder:undefined,vercelPreview:hosted,BrowserSpeechRecognition:recognition ? class {} : undefined,talkButton:{disabled:false},sendButton:{},doneButton:{},micStatus:{},micDeviceSelect:{value:''},voiceAvailable:false,voiceEnabled:false,micSequence:0,
    useHostedTranscription:()=>transcription,startBrowserRecognition(){c.nativeStarts=(c.nativeStarts||0)+1;},stopMicCheck(){},interruptNoor(){},clearTranscriptReview(){},clearRecordingPreview(){},setVoiceEnabled(){},listMicrophones(){},setAvatarState(s){c.state=s;},canTalk:()=>c.sessionReady,
    input:{value:'',maxLength:500,focus(){}},transcriptReview:{hidden:true},keepRecordingPreview(){},transcribeRequest:undefined,
    fetch:async(url,opts)=>{requests++;assert.equal(url,'/api/transcribe');assert.match(opts.headers['content-type'],/audio\/ogg/);return new Promise(resolve=>{pending=resolve;});}};
  vm.createContext(c);vm.runInContext(code,c);
  return { c, finish:()=>c.recorder.stop(), resolve:(text)=>pending({ok:true,json:async()=>({text})}), stopped:()=>stopped, requests:()=>requests };
}
test('Firefox records Ogg, releases microphone and offers editable transcript without sending chat', async()=>{
  const f=fixture();await f.c.startRecording();assert.equal(f.c.recorder.state,'recording');assert.equal(f.c.state,'listening');
  f.finish();await drain();assert.equal(f.stopped(),true);assert.equal(f.requests(),1);
  f.resolve('Where is my gate?');await drain();assert.equal(f.c.input.value,'Where is my gate?');assert.equal(f.c.transcriptReview.hidden,false);assert.equal(f.c.state,'idle');
});
test('Stop during transcription prevents stale result from changing question or avatar',async()=>{
  const f=fixture();await f.c.startRecording();f.finish();await drain();
  f.c.transcribeRequest.abort();f.c.transcribeRequest=undefined;f.c.input.value='new question';f.c.state='idle';
  f.resolve('stale recording');await drain();assert.equal(f.c.input.value,'new question');assert.equal(f.c.transcriptReview.hidden,true);assert.equal(f.c.state,'idle');
});


test('Chrome uses the same hosted recording and transcript-review path as Firefox', async () => {
  const f = fixture({ recognition: true });
  await f.c.startRecording();
  assert.equal(f.c.nativeStarts, undefined);
  assert.equal(f.c.recorder.state, 'recording');
  f.finish(); await drain();
  f.resolve('What is our flight status?'); await drain();
  assert.equal(f.c.input.value, 'What is our flight status?');
  assert.equal(f.c.transcriptReview.hidden, false);
  assert.equal(f.requests(), 1);
});

test('Chrome uses browser recognition only when hosted recording is unavailable', async () => {
  const f = fixture({ recognition: true, transcription: false });
  await f.c.startRecording();
  assert.equal(f.c.nativeStarts, 1);
  assert.equal(f.c.recorder, undefined);
  assert.equal(f.requests(), 0);
});

test('local Chrome keeps the local recorder path instead of browser recognition', async () => {
  const f = fixture({ hosted: false, recognition: true, transcription: false });
  await f.c.startRecording();
  assert.equal(f.c.nativeStarts, undefined);
  assert.equal(f.c.recorder.state, 'recording');
});

test('failed microphone access never silently starts browser recognition', async () => {
  const f = fixture({ recognition: true });
  f.c.navigator.mediaDevices.getUserMedia = async () => { throw new Error('NotAllowedError'); };
  await f.c.startRecording();
  assert.equal(f.c.nativeStarts, undefined);
  assert.equal(f.c.state, 'error');
  assert.match(f.c.micStatus.textContent, /permission/);
  assert.equal(f.requests(), 0);
});
