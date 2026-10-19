import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const setup = section('if (vercelPreview) {', '\nconst conversation =');
const availability = section('function canTalk()', '\nasync function startSession(');
const stop = section("stopButton.addEventListener('click'", "\nform.addEventListener('submit'");

function fixture({ hosted = true, recognition = false, transcription = false } = {}) {
  const row = { hidden: false }, notice = { hidden: true };
  const c = {
    hostedTranscriptionAvailable: false, fetch: async () => ({ ok: true, json: async () => ({ available: transcription }) }),
    vercelPreview: hosted, BrowserSpeechRecognition: recognition ? class {} : undefined,
    navigator: { mediaDevices: { getUserMedia() {} } }, window: { MediaRecorder: class {} },
    document: { querySelector: () => notice },
    arrivalEmailButton: {}, micDeviceControls: {}, checkMicButton: {}, voiceToggle: {}, voiceStatus: {},
    talkButton: { disabled: true, closest: () => row }, micStatus: {}, sessionReady: true,
    stopButton: { addEventListener: (_, callback) => { c.stop = callback; } },
    stopMicCheck() {}, micSequence: 0, finishRecording() {}, interruptNoor() { c.interrupted = true; },
    clearTranscriptReview() {}, clearRecordingPreview() {}, cancelSynthesis() {},
    responseText: {}, sourceLine: {}, voiceEnabled: true, setPose() {},
  };
  vm.createContext(c);
  vm.runInContext(setup + availability + stop, c);
  return { c, row, notice };
}

test('hosted Firefox keeps Talk and Stop visible and enables recording when server transcription is available', async () => {
  const { c, row, notice } = fixture({ transcription: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(row.hidden, false); assert.equal(notice.hidden, false);
  assert.equal(c.canTalk(), true); assert.equal(c.talkButton.disabled, false);
  assert.match(c.micStatus.textContent, /Replicate/);
  c.stop(); assert.equal(c.interrupted, true); assert.equal(c.talkButton.disabled, false);
  c.sessionReady = false; assert.equal(c.canTalk(), false);
});

test('missing server transcription leaves typed chat and Stop available with a clear reason', async () => {
  const { c, notice } = fixture();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.canTalk(), false); assert.equal(c.talkButton.disabled, true);
  assert.equal(notice.hidden, false); assert.match(c.micStatus.textContent, /unavailable/);
  c.stop(); assert.equal(c.interrupted, true);
});

test('supported hosted speech and local transcription still require an active session', () => {
  for (const config of [{ recognition: true }, { hosted: false }]) {
    const { c, row, notice } = fixture(config);
    assert.equal(row.hidden, false);
    assert.equal(notice.hidden, true);
    assert.equal(c.canTalk(), true);
    c.stop();
    assert.equal(c.talkButton.disabled, false);
    c.sessionReady = false;
    assert.equal(c.canTalk(), false);
    c.stop();
    assert.equal(c.talkButton.disabled, true);
  }
});
