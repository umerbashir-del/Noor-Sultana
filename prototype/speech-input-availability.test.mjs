import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const setup = section('if (vercelPreview) {', '\nconst conversation =');
const availability = section('function useHostedTranscription()', '\nasync function startSession(');
const toggle = section('function toggleDictation()', "talkButton.addEventListener('click'");

function fixture({ hosted = true, recognition = false, transcription = false } = {}) {
  const row = { hidden: false }, notice = { hidden: true };
  const c = {
    hostedTranscriptionAvailable: false, hostedTranscriptionChecking: hosted, fetch: async () => ({ ok: true, json: async () => ({ available: transcription }) }),
    vercelPreview: hosted, BrowserSpeechRecognition: recognition ? class {} : undefined,
    navigator: { mediaDevices: { getUserMedia() {} } }, window: { MediaRecorder: class {} },
    document: { querySelector: () => notice },
    arrivalEmailButton: {}, micDeviceControls: {}, checkMicButton: {}, voiceToggle: {}, voiceStatus: {},
    talkButton: { disabled: true, closest: () => row }, micStatus: {}, sessionReady: true,
    browserRecognition: undefined, recorder: undefined, startRecording() { c.started = true; },
    stopMicCheck() {}, micSequence: 0, finishRecording() {}, interruptNoor() { c.interrupted = true; },
    clearTranscriptReview() {}, clearRecordingPreview() {}, cancelSynthesis() {},
    responseText: {}, sourceLine: {}, voiceEnabled: true, setPose() {},
  };
  vm.createContext(c);
  vm.runInContext(setup + availability + toggle, c);
  return { c, row, notice };
}

test('hosted Firefox enables dictation when server transcription is available', async () => {
  const { c, row, notice } = fixture({ transcription: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(row.hidden, false); assert.equal(notice.hidden, false);
  assert.equal(c.canTalk(), true); assert.equal(c.talkButton.disabled, false);
  assert.equal(c.micStatus.textContent, '');
  c.toggleDictation(); assert.equal(c.started, true);
  c.sessionReady = false; assert.equal(c.canTalk(), false);
});

test('missing server transcription disables dictation with a clear reason', async () => {
  const { c, notice } = fixture();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.canTalk(), false); assert.equal(c.talkButton.disabled, true);
  assert.equal(notice.hidden, false); assert.match(c.micStatus.textContent, /unavailable/);
  c.toggleDictation(); assert.equal(c.started, undefined);
});

test('supported hosted speech and local transcription still require an active session', async () => {
  for (const config of [{ recognition: true }, { hosted: false, transcription: true }]) {
    const { c, row, notice } = fixture(config);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(row.hidden, false);
    assert.equal(notice.hidden, config.hosted !== false);
    assert.equal(c.canTalk(), true);
    c.talkButton.disabled = !c.canTalk();
    c.toggleDictation();
    assert.equal(c.started, true);
    c.sessionReady = false;
    assert.equal(c.canTalk(), false);

  }
});


test('Chrome waits for capability detection and prefers the disclosed hosted path', async () => {
  const { c, notice } = fixture({ recognition: true, transcription: true });
  assert.equal(c.canTalk(), false);
  assert.match(c.micStatus.textContent, /Checking/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.canTalk(), true);
  assert.equal(c.useHostedTranscription(), true);
  assert.equal(notice.hidden, false);
  assert.equal(c.micStatus.textContent, '');
});

test('Chrome falls back to browser recognition if hosted transcription is unavailable', async () => {
  const { c, notice } = fixture({ recognition: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.canTalk(), true);
  assert.equal(c.useHostedTranscription(), false);
  assert.equal(notice.hidden, true);
  assert.equal(c.micStatus.textContent, '');
});


test('local missing Replicate configuration disables dictation even when browser recognition exists', async () => {
  const { c } = fixture({ hosted: false, recognition: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.canTalk(), false);
  assert.equal(c.talkButton.disabled, true);
  c.toggleDictation();
  assert.equal(c.started, undefined);
});
