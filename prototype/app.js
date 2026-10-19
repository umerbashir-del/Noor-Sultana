function revealPassengerTool(data) {
 const toolId = data.translation ? 'translatorPanel' : data.crewAssistance ? 'crewPanel' : data.passengerReminders ? 'reminderPanel' : data.emailDraft ? 'emailCard' : data.weather ? 'weatherCard' : null;
 if (!toolId) return;
 const drawer = document.querySelector('#passengerTools');
 drawer.open = true;
 document.querySelectorAll('[data-active-tool]').forEach((el) => el.removeAttribute('data-active-tool'));
 document.getElementById(toolId).setAttribute('data-active-tool', 'true');
 // Keep the requested tool visible inside the drawer without scrolling the character scene.
 requestAnimationFrame(() => {
   const tool = document.getElementById(toolId);
   drawer.scrollTop += tool.getBoundingClientRect().top - drawer.getBoundingClientRect().top - 50;
 });
}

const form = document.querySelector('#messageForm');
const input = document.querySelector('#messageInput');
const sendButton = form.querySelector('button[type="submit"]');
const responseText = document.querySelector('#responseText');
const userLine = document.querySelector('#userLine');
const userText = document.querySelector('#userText');
const sourceLine = document.querySelector('#sourceLine');
const knowledgeSources = document.querySelector('#knowledgeSources');
const endConversationButton = document.querySelector('#endConversationButton');
const sessionStatus = document.querySelector('#sessionStatus');
const localDemoLink = document.querySelector('#localDemoLink');
const boardingTimeButton = document.querySelector('#boardingTimeButton');
const baggageGuidanceButton = document.querySelector('#baggageGuidanceButton');
const weatherAvailabilityButton = document.querySelector('#weatherAvailabilityButton');
const arrivalNoteButton = document.querySelector('#arrivalNoteButton');
const weatherNowButton = document.querySelector('#weatherNowButton');
const weatherArrivalButton = document.querySelector('#weatherArrivalButton');
const otherWeatherButton = document.querySelector('#otherWeatherButton');
const arrivalEmailButton = document.querySelector('#arrivalEmailButton');
const weatherCard = document.querySelector('#weatherCard');
const weatherTitle = document.querySelector('#weatherTitle');
const weatherSummary = document.querySelector('#weatherSummary');
const weatherTimes = document.querySelector('#weatherTimes');
const weatherStatus = document.querySelector('#weatherStatus');
const placeSource = document.querySelector('#placeSource');
const emailCard = document.querySelector('#emailCard');
const emailRecipient = document.querySelector('#emailRecipient');
const sendEmailCodeButton = document.querySelector('#sendEmailCodeButton');
const emailCodeControls = document.querySelector('#emailCodeControls');
const emailCode = document.querySelector('#emailCode');
const verifyEmailCodeButton = document.querySelector('#verifyEmailCodeButton');
const emailSendTime = document.querySelector('#emailSendTime');
const emailJobs = document.querySelector('#emailJobs');
const emailJobList = document.querySelector('#emailJobList');
const reviewEmailButton = document.querySelector('#reviewEmailButton');
const closeEmailButton = document.querySelector('#closeEmailButton');
const emailStatus = document.querySelector('#emailStatus');
const emailReviewDialog = document.querySelector('#emailReviewDialog');
const emailReviewTitle = document.querySelector('#emailReviewTitle');
const emailReviewTo = document.querySelector('#emailReviewTo');
const emailReviewSubject = document.querySelector('#emailReviewSubject');
const emailReviewSendTime = document.querySelector('#emailReviewSendTime');
const emailReviewBody = document.querySelector('#emailReviewBody');
const confirmScheduleButton = document.querySelector('#confirmScheduleButton');
const editEmailAddressButton = document.querySelector('#editEmailAddressButton');
const closeReviewButton = document.querySelector('#closeReviewButton');
const backgroundSelect = document.querySelector('#backgroundSelect');
const noorScene = document.querySelector('#noorScene');
const sceneLabels = { cabin: 'Airplane cabin scene', tokyo: 'Tokyo destination scene', paris: 'Paris destination scene', dubai: 'Dubai destination scene', rome: 'Rome destination scene' };
const backgroundPreferenceKey = 'noor.background';
function applyBackground(background) {
  if (!Object.hasOwn(sceneLabels, background) || !noorScene || !backgroundSelect) return false;
  noorScene.dataset.background = background;
  noorScene.setAttribute('aria-label', sceneLabels[background]);
  backgroundSelect.value = background;
  return true;
}
try { applyBackground(localStorage.getItem(backgroundPreferenceKey)); } catch { /* Storage can be disabled. */ }
backgroundSelect?.addEventListener('change', () => {
  if (!applyBackground(backgroundSelect.value)) return;
  try { localStorage.setItem(backgroundPreferenceKey, backgroundSelect.value); } catch { /* Keep switching usable without storage. */ }
});
const noor = document.querySelector('#noorWrap');
const flightCard = document.querySelector('#flightCard');
const flightInfoButton = document.querySelector('#flightInfoButton');
const voiceToggle = document.querySelector('#voiceToggle');
const playReplyButton = document.querySelector('#playReplyButton');
const voiceStatus = document.querySelector('#voiceStatus');
const talkButton = document.querySelector('#talkButton');
const doneButton = document.querySelector('#doneButton');
const stopButton = document.querySelector('#stopButton');
const micStatus = document.querySelector('#micStatus');
const micDeviceControls = document.querySelector('#micDeviceControls');
const micDeviceSelect = document.querySelector('#micDeviceSelect');
const checkMicButton = document.querySelector('#checkMicButton');
const playRecordingButton = document.querySelector('#playRecordingButton');
const transcriptReview = document.querySelector('#transcriptReview');
const vercelPreview = document.documentElement.dataset.vercelPreview === 'true';
const BrowserSpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let hostedTranscriptionAvailable = false;
let hostedTranscriptionChecking = vercelPreview;

if (vercelPreview) {
  arrivalEmailButton.hidden = true;
  micDeviceControls.hidden = !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder;
  checkMicButton.hidden = micDeviceControls.hidden;
  voiceToggle.disabled = true;
  voiceStatus.textContent = 'Checking Chatterbox voice…';
  micStatus.textContent = 'Checking microphone transcription…';
  void fetch('/api/transcribe').then(async (response) => {
    const data = await response.json();
    hostedTranscriptionAvailable = response.ok && data.available === true;
  }).catch(() => {}).finally(() => {
    hostedTranscriptionChecking = false;
    talkButton.disabled = !canTalk();
    const notice = document.querySelector('#speechInputNotice');
    if (notice) notice.hidden = !useHostedTranscription() && Boolean(BrowserSpeechRecognition);
    micStatus.textContent = useHostedTranscription()
      ? 'Press Talk to record. Audio is sent to Replicate for transcription; review the words before Send.'
      : BrowserSpeechRecognition
        ? 'Press Talk to use browser speech recognition; review the words before Send.'
        : 'Microphone transcription is unavailable. You can still type your question.';
  });
}

const conversation = [];
const maxTurns = 12;
let sessionReady = false;
let sessionTimer;
let idleDeadline = 0;
let absoluteDeadline = 0;
const voiceAudio = new Audio();
let voiceContext;
let voiceSource;
let voiceEnabled = false;
let voiceAvailable = !vercelPreview;
let voiceRequest;
let voiceUrl;
let voiceGeneration = 0;
let voiceRestartAfter = 0;
let chatRequest;
let chatSequence = 0;
let pendingUserMessage;
let transcribeRequest;
let recorder;
let browserRecognition;
let browserRecognitionDraft;
let micStream;
let micCheckStream;
let micCheckRecorder;
let micCheckTimer;
let micCheckSequence = 0;
const recordedAudio = new Audio();
let recordedAudioUrl;
let discardRecording = false;
let recordTimeout;
let micSequence = 0;
let reviewingTranscript = false;
let arrivalEmailDraft;
let emailChallengeId;
let emailVerified = false;
let emailReviewHash;
let reviewedSendTime;
let emailPollTimer;
let speechMouth;
let avatarState = 'welcoming';
const speechMouthReady = import('./speech-mouth.js').then(({ createSpeechMouth }) => {
  speechMouth = createSpeechMouth();
  speechMouth.watchMediaElement(voiceAudio, () => voiceContext);
  return speechMouth;
}).catch(() => undefined); // Voice still plays if optional animation cannot load.
window.addEventListener('noor-avatar-ready', () => window.noorAvatar?.setState(avatarState));

function stopSpeech() {
  if (avatarState === 'speaking' || voiceRequest || (avatarState === 'thoughtful' && !chatRequest)) setAvatarState('idle');
  voiceAudio.onplaying = voiceAudio.onwaiting = voiceAudio.onpause = voiceAudio.onerror = voiceAudio.onended = null;
  speechMouth?.stop();
  voiceGeneration += 1;
  if (vercelPreview && voiceRequest) voiceRestartAfter = Date.now() + 1500;
  voiceRequest?.abort();
  voiceRequest = undefined;
  if (voiceSource) {
    voiceSource.onended = null;
    try { voiceSource.stop(); } catch { /* The source may have finished already. */ }
    voiceSource.disconnect();
    voiceSource = undefined;
  }
  voiceAudio.pause();
  voiceAudio.removeAttribute('src');
  voiceAudio.load();
  if (voiceUrl) URL.revokeObjectURL(voiceUrl);
  voiceUrl = undefined;
  playReplyButton.hidden = true;
}

function clearRecordingPreview() {
  recordedAudio.pause();
  recordedAudio.removeAttribute('src');
  recordedAudio.load();
  if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl);
  recordedAudioUrl = undefined;
  playRecordingButton.hidden = true;
}

function keepRecordingPreview(blob) {
  clearRecordingPreview();
  recordedAudioUrl = URL.createObjectURL(blob);
  recordedAudio.src = recordedAudioUrl;
  playRecordingButton.hidden = false;
}

playRecordingButton.addEventListener('click', async () => {
  try {
    recordedAudio.currentTime = 0;
    await recordedAudio.play();
    micStatus.textContent = 'Playing what your microphone recorded…';
  } catch {
    micStatus.textContent = 'This browser could not play the recording.';
  }
});
recordedAudio.addEventListener('ended', () => {
  micStatus.textContent = 'Recording finished. If it was silent, choose another microphone and check again. Chrome speech recognition uses its default input.';
});

async function listMicrophones(stream) {
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput');
    const selected = stream.getAudioTracks()[0]?.getSettings().deviceId || micDeviceSelect.value;
    micDeviceSelect.replaceChildren(new Option('Default microphone', ''));
    devices.forEach((device, index) => {
      micDeviceSelect.add(new Option(device.label || `Microphone ${index + 1}`, device.deviceId));
    });
    if (devices.some((device) => device.deviceId === selected)) micDeviceSelect.value = selected;
  } catch { /* Device names may be unavailable in this browser. */ }
}

function stopMicCheck() {
  micCheckSequence += 1;
  clearTimeout(micCheckTimer);
  if (micCheckRecorder?.state === 'recording') micCheckRecorder.stop();
  micCheckStream?.getTracks().forEach((track) => track.stop());
  micCheckRecorder = undefined;
  micCheckStream = undefined;
  checkMicButton.disabled = false;
  micDeviceSelect.disabled = false;
  talkButton.disabled = !canTalk();
}

async function checkMicrophone() {
  if (micCheckRecorder || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return;
  micSequence += 1;
  finishRecording(true);
  interruptNoor();
  clearTranscriptReview(true);
  clearRecordingPreview();
  const sequence = ++micCheckSequence;
  checkMicButton.disabled = true;
  micDeviceSelect.disabled = true;
  talkButton.disabled = true;
  micStatus.textContent = 'Recording a four-second microphone check…';
  try {
    const deviceId = micDeviceSelect.value;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { ideal: deviceId } } : true });
    if (sequence !== micCheckSequence) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    micCheckStream = stream;
    await listMicrophones(stream);
    if (sequence !== micCheckSequence) return;
    const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    const mimeType = preferred.find((type) => MediaRecorder.isTypeSupported(type));
    const activeRecorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 128000 });
    micCheckRecorder = activeRecorder;
    const chunks = [];
    activeRecorder.addEventListener('dataavailable', (event) => {
      if (event.data.size) chunks.push(event.data);
      if (vercelPreview && chunks.reduce((sum, part) => sum + part.size, 0) > 900000) finishRecording(false);
    });
    activeRecorder.addEventListener('stop', () => {
      stream.getTracks().forEach((track) => track.stop());
      if (micCheckStream === stream) micCheckStream = undefined;
      if (micCheckRecorder === activeRecorder) micCheckRecorder = undefined;
      if (sequence !== micCheckSequence) return;
      clearTimeout(micCheckTimer);
      checkMicButton.disabled = false;
      micDeviceSelect.disabled = false;
      talkButton.disabled = !canTalk();
      const blob = new Blob(chunks, { type: activeRecorder.mimeType || mimeType || 'audio/webm' });
      if (!blob.size) {
        micStatus.textContent = 'The microphone check captured no audio. Choose another microphone and try again.';
        return;
      }
      keepRecordingPreview(blob);
      micStatus.textContent = 'Microphone check ready. Press Check recording to hear it. This recording stays in your browser.';
    }, { once: true });
    activeRecorder.start();
    micCheckTimer = window.setTimeout(() => {
      if (activeRecorder.state === 'recording') activeRecorder.stop();
    }, 4000);
  } catch (error) {
    if (sequence !== micCheckSequence) return;
    stopMicCheck();
    micStatus.textContent = `Microphone check could not start (${error.name || 'unknown error'}). Check Chrome's input device and try again.`;
  }
}

checkMicButton.addEventListener('click', checkMicrophone);

async function cancelSynthesis() {
  if (vercelPreview) return;
  try { await fetch('/api/stop', { method: 'POST' }); } catch { /* Local server may be unavailable. */ }
}

function unlockVoicePlayback() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    voiceContext ||= new AudioContextClass();
    if (voiceContext.state !== 'running') void voiceContext.resume().catch(() => {});
  } catch { /* The Play reply button remains available. */ }
}

async function speakReply(text) {
  stopSpeech();
  if (!voiceEnabled) return;
  if (vercelPreview && text.length > 500) {
    voiceStatus.textContent = 'That reply is too long for the demo voice. You can read it above.';
    return;
  }
  const generation = voiceGeneration;
  const controller = new AbortController();
  voiceRequest = controller;
  // The answer is ready; audio preparation is not a new thinking turn.
  setAvatarState('idle');
  voiceStatus.textContent = 'Generating Noor’s voice… This may take a few seconds.';
  try {
    const waitForPrevious = voiceRestartAfter - Date.now();
    if (vercelPreview && waitForPrevious > 0) {
      voiceStatus.textContent = 'Stopping the previous voice before starting this reply…';
      await new Promise((resolve) => window.setTimeout(resolve, waitForPrevious));
      if (generation !== voiceGeneration || !voiceEnabled || controller.signal.aborted) return;
      voiceStatus.textContent = 'Generating Noor’s voice… This may take a few seconds.';
    }
    const response = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, stream: true }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.error || 'Voice unavailable');
    }
    if (response.headers?.get('content-type')?.includes('application/x-ndjson')) {
      await playStreamedSpeech(response, generation, controller);
      return;
    }
    const audio = await response.blob();
    if (generation !== voiceGeneration || !voiceEnabled) return;
    voiceRequest = undefined;
    await speechMouthReady;
    if (generation !== voiceGeneration || !voiceEnabled) return;
    if (voiceContext?.state === 'running') {
      try {
        const decoded = await voiceContext.decodeAudioData(await audio.arrayBuffer());
        if (generation !== voiceGeneration || !voiceEnabled) return;
        const source = voiceContext.createBufferSource();
        source.buffer = decoded;
        source.connect(voiceContext.destination);
        source.onended = () => {
          if (voiceSource !== source) return;
          voiceSource = undefined;
          source.disconnect();
          speechMouth?.stop();
          setAvatarState('idle');
          voiceStatus.textContent = 'Voice on';
        };
        voiceSource = source;
        source.start();
        setAvatarState('speaking');
        speechMouth?.trackSource(source, voiceContext);
        voiceStatus.textContent = 'Noor is speaking. Press Stop to interrupt.';
        return;
      } catch {
        if (generation !== voiceGeneration || !voiceEnabled) return;
        speechMouth?.stop();
        if (voiceSource) {
          voiceSource.onended = null;
          try { voiceSource.stop(); } catch { /* Source may not have started. */ }
          voiceSource.disconnect();
          voiceSource = undefined;
        }
        // Fall back to the browser audio element.
      }
    }
    if (generation !== voiceGeneration || !voiceEnabled) return;
    voiceUrl = URL.createObjectURL(audio);
    voiceAudio.src = voiceUrl;
    bindSpeechPlaybackState(generation, voiceUrl);
    voiceStatus.textContent = 'Noor is speaking. Press Stop to interrupt.';
    try { await voiceAudio.play(); }
    catch {
      if (generation !== voiceGeneration || !voiceEnabled) return;
      speechMouth?.stop();
      playReplyButton.hidden = false;
      setAvatarState('idle');
      voiceStatus.textContent = 'Audio is ready. Press Play reply to hear Noor.';
    }
  } catch (error) {
    if (generation === voiceGeneration) { speechMouth?.stop(); playReplyButton.hidden = true; }
    if (error.name !== 'AbortError' && generation === voiceGeneration) {
      setAvatarState('error');
      voiceStatus.textContent = vercelPreview ? error.message : 'Voice unavailable. Check the server window or try again.';
    }
  } finally {
    if (voiceRequest === controller) voiceRequest = undefined;
  }
}

// Read while playing: the next native audio segment can generate in parallel.
async function playStreamedSpeech(response, generation, controller) {
  const current = () => generation === voiceGeneration && voiceEnabled && !controller.signal.aborted;
  const started = Date.now();
  // Metadata only: observers can distinguish transport completion from playback.
  const trace = kind => {
    if (typeof window.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') return;
    window.dispatchEvent(new CustomEvent('noor-speech-stream', { detail: {
      kind, generation, requestId: response.headers?.get('x-noor-speech-id') || null,
      durationMs: Date.now() - started,
    } }));
  };
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Voice stream is unavailable.');
  const cancelStream = () => { trace('abort'); void reader.cancel().catch(() => {}); };
  controller.signal.addEventListener('abort', cancelStream, { once: true });
  const decoder = new TextDecoder();
  let pending = '', count = 0, done = false, playback = Promise.resolve(), playbackError;
  const enqueue = line => {
    const entry = JSON.parse(line);
    if (entry.error) throw new Error(entry.error);
    if (entry.done === true) { if (!count || done) throw new Error('Invalid voice stream.'); done = true; trace('terminal_done'); return; }
    if (done || count >= 5 || entry.index !== count || typeof entry.audio !== 'string'
      || entry.audio.length > 6_700_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(entry.audio)) throw new Error('Invalid voice segment.');
    const raw = atob(entry.audio);
    const audio = new Blob([Uint8Array.from(raw, value => value.charCodeAt(0))], { type: 'audio/wav' });
    count += 1;
    playback = playback.then(async () => {
      if (current()) await playSpeechSegment(audio, generation, controller.signal);
    }).catch(error => { playbackError ||= error; controller.abort(); });
  };
  try {
    while (true) {
      const part = await reader.read();
      pending += decoder.decode(part.value, { stream: !part.done });
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        if (line.trim()) enqueue(line);
      }
      if (pending.length > 6_700_100) throw new Error('Voice segment is too large.');
      if (part.done) { trace('reader_eof'); break; }
    }
    if (pending.trim()) enqueue(pending);
    if (!done) throw new Error('Voice stream ended before the reply finished.');
    await playback;
    if (playbackError) throw playbackError;
    if (current()) { trace('playback_complete'); setAvatarState('idle'); voiceStatus.textContent = 'Voice on'; }
  } catch (error) {
    trace(controller.signal.aborted ? 'cancelled' : 'error');
    controller.abort();
    await reader.cancel().catch(() => {});
    await playback;
    // Aborting playback during cleanup must not hide the stream's actual error.
    throw playbackError && playbackError.name !== 'AbortError' ? playbackError : error;
  } finally { controller.signal.removeEventListener('abort', cancelStream); reader.releaseLock(); }
}

async function playSpeechSegment(audio, generation, signal) {
  const current = () => generation === voiceGeneration && voiceEnabled && !signal.aborted;
  const cancelled = () => Object.assign(new Error('Voice stopped.'), { name: 'AbortError' });
  await speechMouthReady;
  if (!current()) throw cancelled();
  // Decoding can fail on some browsers; keep the native HTMLAudio fallback.
  let decoded;
  if (voiceContext?.state === 'running') {
    try { decoded = await voiceContext.decodeAudioData(await audio.arrayBuffer()); } catch { /* Use media element below. */ }
  }
  if (!current()) throw cancelled();
  await new Promise((resolve, reject) => {
    let source, url, settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      if (source) {
        source.onended = null;
        if (error) { try { source.stop(); } catch { /* Already ended. */ } }
        source.disconnect();
        if (voiceSource === source) voiceSource = undefined;
      }
      if (url) {
        URL.revokeObjectURL(url);
        if (voiceUrl === url) { voiceAudio.pause(); voiceAudio.removeAttribute('src'); voiceUrl = undefined; }
      }
      if (current()) {
        speechMouth?.stop();
        setAvatarState('idle');
        voiceStatus.textContent = 'Preparing the next part of Noor’s reply…';
        playReplyButton.hidden = true;
      }
      error ? reject(error) : resolve();
    };
    const abort = () => finish(cancelled());
    signal.addEventListener('abort', abort, { once: true });
    if (!current()) { abort(); return; }
    if (decoded) {
      try {
        source = voiceContext.createBufferSource(); source.buffer = decoded;
        source.connect(voiceContext.destination); source.onended = () => finish();
        voiceSource = source; source.start();
        speechMouth?.trackSource(source, voiceContext);
        setAvatarState('speaking'); voiceStatus.textContent = 'Noor is speaking. Press Stop to interrupt.';
        return;
      } catch {
        if (source) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); if (voiceSource === source) voiceSource = undefined; }
        source = undefined;
      }
    }
    url = URL.createObjectURL(audio); voiceUrl = url; voiceAudio.src = url;
    bindSpeechPlaybackState(generation, url);
    voiceAudio.onended = () => finish();
    voiceAudio.onerror = () => finish(new Error('Your browser could not play this audio.'));
    voiceAudio.play().catch(() => {
      if (!current() || settled) return;
      speechMouth?.stop(); playReplyButton.hidden = false;
      setAvatarState('idle'); voiceStatus.textContent = 'Audio is ready. Press Play reply to hear Noor.';
    });
  });
}

voiceAudio.addEventListener('ended', () => {
  if (voiceUrl) URL.revokeObjectURL(voiceUrl);
  voiceUrl = undefined;
  voiceStatus.textContent = 'Voice on';
  playReplyButton.hidden = true;
});

playReplyButton.addEventListener('click', async () => {
  const generation = voiceGeneration;
  if (!voiceEnabled || !voiceUrl) return;
  try {
    await voiceAudio.play();
    if (generation !== voiceGeneration || !voiceEnabled) return;
    playReplyButton.hidden = true;
    voiceStatus.textContent = 'Noor is speaking. Press Stop to interrupt.';
  } catch {
    if (generation !== voiceGeneration || !voiceEnabled) return;
    speechMouth?.stop();
    setAvatarState('error');
    voiceStatus.textContent = 'Your browser could not play this audio.';
  }
});

function setVoiceEnabled(enabled) {
  if (enabled && !voiceAvailable) return;
  voiceEnabled = enabled;
  voiceToggle.setAttribute('aria-pressed', String(enabled));
  voiceToggle.textContent = enabled ? '🔊 Voice on' : '🔇 Voice off';
  if (enabled) {
    unlockVoicePlayback();
    voiceStatus.textContent = 'Noor will speak her replies.';
  } else {
    stopSpeech();
    void cancelSynthesis();
    voiceStatus.textContent = 'Turn on voice to hear Noor’s replies.';
  }
}

voiceToggle.addEventListener('click', () => setVoiceEnabled(!voiceEnabled));

async function loadVoiceAvailability() {
  if (!vercelPreview) return;
  try {
    const response = await fetch('/api/speak');
    const config = await response.json();
    voiceAvailable = response.ok && config.available === true;
  } catch { voiceAvailable = false; }
  voiceToggle.disabled = !voiceAvailable;
  voiceStatus.textContent = voiceAvailable
    ? 'Turn on Chatterbox voice to hear Noor’s replies.'
    : 'Chatterbox voice is not connected yet. You can still talk and read Noor’s replies.';
}

function setAvatarState(state) {
  avatarState = state;
  noor.dataset.pose = state === 'thoughtful' ? 'thinking' : 'welcome';
  noor.dataset.avatarState = state;
  window.noorAvatar?.setState(state);
}

function bindSpeechPlaybackState(generation, url) {
  const current = () => generation === voiceGeneration && voiceEnabled && voiceUrl === url;
  voiceAudio.onplaying = () => { if (current() && !voiceAudio.paused) setAvatarState('speaking'); };
  voiceAudio.onwaiting = () => { if (current()) setAvatarState('idle'); };
  voiceAudio.onpause = () => { if (current()) setAvatarState('idle'); };
  voiceAudio.onended = () => { if (generation === voiceGeneration && !voiceSource && !voiceRequest) setAvatarState('idle'); };
  voiceAudio.onerror = () => { if (current()) setAvatarState('error'); };
}

function setPose(pose) {
  noor.dataset.pose = pose === 'thoughtful' ? 'thinking' : 'welcome';
  setAvatarState(pose === 'thoughtful' ? 'thoughtful' : 'welcoming');
}

function animateNoor() {
  noor.classList.remove('responding');
  void noor.offsetWidth;
  noor.classList.add('responding');
  window.setTimeout(() => noor.classList.remove('responding'), 850);
}

function showTemporaryStatus(message) {
  responseText.textContent = message;
  sourceLine.textContent = 'Connecting to Noor…';
  renderKnowledgeSources();
}

function scheduleSessionEnd() {
  clearTimeout(sessionTimer);
  sessionTimer = window.setTimeout(() => void endConversation(), Math.max(0, Math.min(idleDeadline, absoluteDeadline) - Date.now()));
}

function useHostedTranscription() {
  return hostedTranscriptionAvailable && Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

function canTalk() {
  return sessionReady && (!vercelPreview || (!hostedTranscriptionChecking
    && (useHostedTranscription() || Boolean(BrowserSpeechRecognition))));
}

async function startSession(successMessage = 'Conversation ready. End it to clear this screen.') {
  if (window.location.protocol === 'file:') {
    sessionStatus.textContent = 'Open the local demo through Noor’s server to type or talk.';
    localDemoLink.hidden = false;
    voiceToggle.disabled = true;
    voiceStatus.textContent = 'Voice needs Noor’s server too.';
    return;
  }
  sessionReady = false;
  clearTimeout(sessionTimer);
  input.disabled = true;
  sendButton.disabled = true;
  boardingTimeButton.disabled = true;
  baggageGuidanceButton.disabled = true;
  weatherAvailabilityButton.disabled = true;
  arrivalNoteButton.disabled = true;
  talkButton.disabled = true;
  weatherNowButton.disabled = true;
  weatherArrivalButton.disabled = true;
  otherWeatherButton.disabled = true;
  arrivalEmailButton.disabled = true;
  endConversationButton.disabled = true;
  sessionStatus.textContent = 'Starting conversation…';
  try {
    const response = await fetch('/api/session', { method: 'POST' });
    if (!response.ok) throw new Error('Session unavailable');
    sessionReady = true;
    idleDeadline = Date.now() + 15 * 60_000;
    absoluteDeadline = Date.now() + 2 * 60 * 60_000;
    scheduleSessionEnd();
    input.disabled = false;
    sendButton.disabled = false;
    boardingTimeButton.disabled = false;
    baggageGuidanceButton.disabled = false;
    weatherAvailabilityButton.disabled = false;
    arrivalNoteButton.disabled = false;
    talkButton.disabled = !canTalk();
    weatherNowButton.disabled = false;
    weatherArrivalButton.disabled = false;
    otherWeatherButton.disabled = false;
    arrivalEmailButton.disabled = vercelPreview;
    endConversationButton.disabled = false;
    endConversationButton.textContent = 'End conversation';
    sessionStatus.textContent = successMessage;
    setAvatarState('welcoming');
  } catch {
    endConversationButton.disabled = false;
    endConversationButton.textContent = 'Retry session';
    setAvatarState('error');
    sessionStatus.textContent = 'Could not start a conversation. Check the server and retry.';
  }
}

function clearConversationDisplay() {
  document.querySelector('#passengerTools').open = false;
  clearTranslationDemo();
  clearReminderDemo();
  clearCrewDemo();
  clearRecordingPreview();
  conversation.length = 0;
  pendingUserMessage = undefined;
  input.value = '';
  reviewingTranscript = false;
  transcriptReview.hidden = true;
  userText.textContent = '';
  userLine.hidden = true;
  responseText.textContent = 'Hi, I’m Noor. Ask me about this flight.';
  sourceLine.textContent = 'Fictional flight information · Not live';
  knowledgeSources.replaceChildren();
  knowledgeSources.hidden = true;
  weatherCard.hidden = true;
  clearEmailDraft();
  setPose('welcome');
  noor.removeAttribute('aria-busy');
  micStatus.textContent = 'Press Talk to ask Noor a question.';
  voiceStatus.textContent = voiceEnabled ? 'Voice on' : voiceAvailable
    ? 'Turn on voice to hear Noor’s replies.'
    : 'Chatterbox voice is not connected yet. You can still talk and read Noor’s replies.';
}

function clearEmailDraft() {
  arrivalEmailDraft = undefined;
  emailChallengeId = undefined;
  emailVerified = false;
  emailReviewHash = undefined;
  reviewedSendTime = undefined;
  clearInterval(emailPollTimer);
  if (emailReviewDialog.open) emailReviewDialog.close();
  emailRecipient.value = '';
  emailCode.value = '';
  emailCodeControls.hidden = true;
  emailSendTime.value = '';
  reviewEmailButton.disabled = true;
  emailJobs.hidden = true;
  emailJobList.replaceChildren();
  emailReviewTo.textContent = '';
  emailReviewSubject.textContent = '';
  emailReviewSendTime.textContent = '';
  emailReviewBody.textContent = '';
  emailStatus.textContent = 'Enter your address to receive a verification code.';
  emailCard.hidden = true;
}

function renderEmailDraft(draft) {
  if (typeof draft?.subject !== 'string' || typeof draft?.body !== 'string') return;
  clearEmailDraft();
  arrivalEmailDraft = { subject: draft.subject, body: draft.body };
  const defaultTime = new Date(Date.now() + 60 * 60_000);
  emailSendTime.value = localDateTimeValue(defaultTime);
  emailCard.hidden = false;
}

function localDateTimeValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

async function emailApi(path, body, touchSession = true) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'Email service is unavailable.');
    error.status = response.status;
    throw error;
  }
  if (touchSession && sessionReady) {
    idleDeadline = Date.now() + 15 * 60_000;
    scheduleSessionEnd();
  }
  return data;
}

function emailError(error) {
  if (error.status === 401) {
    clearEmailDraft();
    emailStatus.textContent = 'This conversation ended. Start a new one to use email.';
    return;
  }
  emailStatus.textContent = error.message || 'Email service is unavailable. Please try again.';
}

function invalidateEmailReview() {
  emailReviewHash = undefined;
  reviewedSendTime = undefined;
  if (emailReviewDialog.open) emailReviewDialog.close();
}

emailRecipient.addEventListener('input', () => {
  emailChallengeId = undefined;
  emailVerified = false;
  invalidateEmailReview();
  emailCode.value = '';
  emailCodeControls.hidden = true;
  reviewEmailButton.disabled = true;
  clearInterval(emailPollTimer);
  emailJobs.hidden = true;
  emailJobList.replaceChildren();
  emailStatus.textContent = 'Send a code to verify this address.';
});
emailSendTime.addEventListener('input', invalidateEmailReview);

sendEmailCodeButton.addEventListener('click', async () => {
  emailRecipient.value = emailRecipient.value.trim();
  if (!emailRecipient.value || !emailRecipient.checkValidity()) {
    emailStatus.textContent = 'Enter one valid email address.';
    emailRecipient.focus();
    return;
  }
  sendEmailCodeButton.disabled = true;
  emailStatus.textContent = 'Requesting a verification code…';
  try {
    const result = await emailApi('/api/email/verification', { email: emailRecipient.value });
    emailChallengeId = result.challengeId;
    emailVerified = false;
    reviewEmailButton.disabled = true;
    emailCodeControls.hidden = false;
    emailStatus.textContent = result.delivery === 'accepted'
      ? 'Verification email accepted. Check your inbox and enter the six-digit code.'
      : 'Delivery could not be confirmed. Enter the code if it arrives, or request a new one.';
    emailCode.focus();
  } catch (error) { emailError(error); }
  finally { sendEmailCodeButton.disabled = false; }
});

verifyEmailCodeButton.addEventListener('click', async () => {
  if (!emailChallengeId) return;
  verifyEmailCodeButton.disabled = true;
  try {
    await emailApi('/api/email/verify', { challengeId: emailChallengeId, code: emailCode.value.trim() });
    emailVerified = true;
    reviewEmailButton.disabled = false;
    emailStatus.textContent = 'Address verified. Choose a time and review the complete email.';
    await loadEmailJobs();
    clearInterval(emailPollTimer);
    emailPollTimer = window.setInterval(() => { if (sessionReady && emailVerified) void loadEmailJobs(); }, 30_000);
  } catch (error) { emailError(error); }
  finally { verifyEmailCodeButton.disabled = false; }
});

reviewEmailButton.addEventListener('click', async () => {
  if (!emailVerified || !emailChallengeId || !emailSendTime.value) {
    emailStatus.textContent = 'Verify your address and choose a send time first.';
    return;
  }
  const date = new Date(emailSendTime.value);
  if (!Number.isFinite(date.getTime())) {
    emailStatus.textContent = 'Choose a valid send time.';
    return;
  }
  reviewEmailButton.disabled = true;
  try {
    const preview = await emailApi('/api/email/review', {
      challengeId: emailChallengeId, scheduledAt: date.toISOString(),
    });
    emailReviewHash = preview.reviewHash;
    reviewedSendTime = preview.scheduledAt;
    emailReviewTo.textContent = preview.to;
    emailReviewSubject.textContent = preview.subject;
    emailReviewBody.textContent = preview.body;
    emailReviewSendTime.textContent = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'full', timeStyle: 'long',
    }).format(new Date(preview.scheduledAt));
    emailReviewDialog.showModal();
    emailReviewTitle.focus();
    emailStatus.textContent = 'Review the full email and send time before confirming.';
  } catch (error) { emailError(error); }
  finally { reviewEmailButton.disabled = !emailVerified; }
});

confirmScheduleButton.addEventListener('click', async () => {
  if (!emailReviewHash || !reviewedSendTime) return;
  confirmScheduleButton.disabled = true;
  try {
    const result = await emailApi('/api/email/schedule', {
      challengeId: emailChallengeId, scheduledAt: reviewedSendTime, reviewHash: emailReviewHash,
    });
    emailReviewDialog.close();
    emailStatus.textContent = result.job.status === 'scheduled'
      ? 'Email scheduled. You can see its status or cancel it below.'
      : `Email request status: ${result.job.status}.`;
    await loadEmailJobs();
  } catch (error) { emailError(error); }
  finally { confirmScheduleButton.disabled = false; }
});

async function loadEmailJobs() {
  if (!emailChallengeId || !emailVerified) return;
  try {
    const { jobs } = await emailApi(`/api/email/jobs?challengeId=${encodeURIComponent(emailChallengeId)}`, undefined, false);
    emailJobList.replaceChildren();
    emailJobs.hidden = jobs.length === 0;
    for (const job of jobs) {
      const item = document.createElement('li');
      const details = document.createElement('span');
      const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(job.scheduledAt));
      const status = job.status === 'sent' ? `sent to provider${job.deliveryEvent ? ` · ${job.deliveryEvent}` : ''}` : job.status;
      details.textContent = `${when} · ${status}${job.failureReason ? ` · ${job.failureReason}` : ''}`;
      item.append(details);
      if (job.status === 'scheduled') {
        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.textContent = 'Cancel';
        cancelButton.addEventListener('click', async () => {
          cancelButton.disabled = true;
          try {
            await emailApi(`/api/email/jobs/${job.id}/cancel`, { challengeId: emailChallengeId });
            emailStatus.textContent = 'Email request cancelled.';
            await loadEmailJobs();
          } catch (error) { emailError(error); cancelButton.disabled = false; }
        });
        item.append(cancelButton);
      }
      emailJobList.append(item);
    }
  } catch (error) { emailError(error); }
}

editEmailAddressButton.addEventListener('click', () => {
  emailReviewDialog.close();
  emailRecipient.focus();
});
closeReviewButton.addEventListener('click', () => emailReviewDialog.close());
closeEmailButton.addEventListener('click', clearEmailDraft);

function weatherTime(iso, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(iso));
}

function renderWeather(weather) {
  weatherCard.hidden = false;
  weatherTitle.textContent = weather.location;
  weatherSummary.textContent = `${weather.condition} · ${weather.temperatureC}°C${weather.kind === 'arrival' ? ` · ${weather.precipitationProbability}% chance of precipitation` : ''}`;
  weatherTimes.textContent = `${weather.kind === 'arrival' ? 'Forecast for' : 'Conditions for'} ${weatherTime(weather.validAt, weather.timeZone)} · Retrieved ${weatherTime(weather.fetchedAt, weather.timeZone)}`;
  weatherStatus.textContent = weather.kind === 'arrival' ? 'Arrival time comes from the fictional demo flight.'
    : weather.city ? 'Current model conditions near the named place.' : 'Current model conditions near the airport.';
  placeSource.hidden = !weather.city;
}

function renderKnowledgeSources(sources) {
  knowledgeSources.replaceChildren();
  knowledgeSources.hidden = !Array.isArray(sources) || sources.length === 0;
  if (knowledgeSources.hidden) return;
  for (const source of sources) {
    if (typeof source?.url !== 'string' || !/^\/knowledge\/[a-z-]+\.md$/.test(source.url)) continue;
    const link = document.createElement('a');
    link.href = source.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = `${source.citationId ? "[" + source.citationId + "] " : ""}${source.title}${source.section ? " — " + source.section : ""} (draft v${source.version}; ${source.review}${Number.isInteger(source.lineStart) ? "; lines " + source.lineStart + "–" + source.lineEnd : ""})`;
    knowledgeSources.append(link);
  }
  if (!knowledgeSources.childElementCount) knowledgeSources.hidden = true;
}

boardingTimeButton.addEventListener('click', () => void sendMessage('What time does this sample flight board?'));
baggageGuidanceButton.addEventListener('click', () => void sendMessage('What general guidance do you have about carry-on and checked baggage?'));
weatherAvailabilityButton.addEventListener('click', () => void sendMessage('What weather information can you check?'));
arrivalNoteButton.addEventListener('click', () => void sendMessage('Show me the fixed arrival note.'));
weatherNowButton.addEventListener('click', () => void sendMessage('What is the weather near Tokyo Haneda now?'));
weatherArrivalButton.addEventListener('click', () => void sendMessage('What is the weather near Tokyo Haneda at the sample arrival?'));
otherWeatherButton.addEventListener('click', () => {
  input.value = 'What is the current weather in Paris, France?';
  input.focus();
  input.setSelectionRange(input.value.indexOf('Paris'), input.value.indexOf('?'));
});
arrivalEmailButton.addEventListener('click', () => void sendMessage('Prepare my arrival email draft.'));

function cancelPendingChat() {
  chatSequence += 1;
  chatRequest?.abort();
  chatRequest = undefined;
  if (pendingUserMessage) {
    const index = conversation.indexOf(pendingUserMessage);
    if (index !== -1) conversation.splice(index, 1);
    pendingUserMessage = undefined;
  }
  input.disabled = !sessionReady;
  sendButton.disabled = !sessionReady;
  boardingTimeButton.disabled = !sessionReady;
  baggageGuidanceButton.disabled = !sessionReady;
  weatherAvailabilityButton.disabled = !sessionReady;
  arrivalNoteButton.disabled = !sessionReady;
  weatherNowButton.disabled = !sessionReady;
  weatherArrivalButton.disabled = !sessionReady;
  otherWeatherButton.disabled = !sessionReady;
  arrivalEmailButton.disabled = vercelPreview || !sessionReady;
  noor.removeAttribute('aria-busy');
}

function finishRecording(discard = false) {
  if (browserRecognition || recorder?.state === 'recording') setAvatarState(discard ? 'idle' : 'thoughtful');
  if (discard) discardRecording = true;
  if (browserRecognition) {
    if (discard) {
      input.value = browserRecognitionDraft ?? '';
      browserRecognitionDraft = undefined;
      sendButton.disabled = !sessionReady;
    }
    try {
      if (discard) browserRecognition.abort();
      else browserRecognition.stop();
    } catch { /* Recognition may already have stopped. */ }
    doneButton.disabled = true;
    talkButton.disabled = true;
    return;
  }
  if (!recorder || recorder.state === 'inactive') return;
  clearTimeout(recordTimeout);
  recorder.stop();
  doneButton.disabled = true;
  talkButton.disabled = true;
}

function interruptNoor() {
  const wasGenerating = Boolean(voiceRequest);
  stopSpeech();
  if (wasGenerating) void cancelSynthesis();
  cancelPendingChat();
  transcribeRequest?.abort();
  transcribeRequest = undefined;
  setAvatarState('idle');
}

function clearTranscriptReview(clearText = false) {
  if (clearText && reviewingTranscript) input.value = '';
  reviewingTranscript = false;
  transcriptReview.hidden = true;
}

async function sendMessage(message) {
  if (browserRecognition) {
    micStatus.textContent = 'Press Done and review the transcript before sending.';
    return;
  }
  const cleanMessage = message.trim();
  if (!cleanMessage || !sessionReady || sendButton.disabled) return;
  if (cleanMessage.length > input.maxLength) {
    micStatus.textContent = 'Question is too long. Shorten it before pressing Send.';
    input.focus();
    return;
  }

  const fromTranscript = reviewingTranscript;
  if (fromTranscript) micStatus.textContent = 'Sending your reviewed question to Noor…';
  clearTranscriptReview();

  if (recorder?.state === 'recording' || browserRecognition) {
    micSequence += 1;
    finishRecording(true);
  }
  transcribeRequest?.abort();
  transcribeRequest = undefined;
  const wasGenerating = Boolean(voiceRequest);
  stopSpeech();
  if (wasGenerating) void cancelSynthesis();
  if (voiceEnabled) voiceStatus.textContent = 'Noor will speak after she replies.';

  userText.textContent = cleanMessage;
  userLine.hidden = false;
  input.value = '';
  input.disabled = true;
  sendButton.disabled = true;
  boardingTimeButton.disabled = true;
  baggageGuidanceButton.disabled = true;
  weatherAvailabilityButton.disabled = true;
  arrivalNoteButton.disabled = true;
  weatherNowButton.disabled = true;
  weatherArrivalButton.disabled = true;
  otherWeatherButton.disabled = true;
  arrivalEmailButton.disabled = true;
  noor.setAttribute('aria-busy', 'true');
  setPose('thoughtful');
  showTemporaryStatus('Let me think about that…');

  const turn = ++chatSequence;
  let focusEmailAfterReply = false;
  const userMessage = { role: 'user', content: cleanMessage };
  pendingUserMessage = userMessage;
  conversation.push(userMessage);
  if (conversation.length > maxTurns) conversation.splice(0, conversation.length - maxTurns);
  const controller = new AbortController();
  chatRequest = controller;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ useTools: true, message: cleanMessage, demoScenario: document.querySelector('#demoFlightScenario')?.value || 'on-time', demoFare: document.querySelector('#demoBaggageFare')?.value || 'standard', demoMealStock: document.querySelector('#demoMealStock')?.value || 'available', demoLanguage: document.querySelector('#demoTranslationLanguage')?.value || 'japanese' }),
      signal: controller.signal,
    });
    const data = await response.json();
    if (turn !== chatSequence) return;
    if (!response.ok) {
      const error = new Error(data.error || 'Noor could not respond right now.');
      error.status = response.status;
      throw error;
    }

    revealPassengerTool(data);
    if (data.translation || data.crewAssistance || data.passengerReminders || data.emailDraft || data.weather) document.querySelector('#passengerTools').open = true;
    if (data.crewProposal) {
      document.querySelector('#crewCategory').value = data.crewProposal.category;
      document.querySelector('#crewDetails').value = data.crewProposal.details;
    }
    if (data.reminderProposal) {
      document.querySelector('#reminderKind').value = data.reminderProposal.kind;
      if (data.reminderProposal.delayMinutes !== null) document.querySelector('#reminderMinutes').value = data.reminderProposal.delayMinutes;
    }
    renderTranslation(data.translation);
    responseText.textContent = data.reply;
    // Reply expressions must not keep the pending-answer artwork visible.
    setAvatarState('idle');
    sourceLine.textContent = data.sourceLabel || 'Claude · Fictional flight information · Not live';
    renderKnowledgeSources(data.knowledgeSources);
    if (data.weather) renderWeather(data.weather);
    else weatherCard.hidden = true;
    if (data.passengerReminders) document.querySelector('#reminderPanel').open = true;
    if (data.crewAssistance) document.querySelector('#crewPanel').open = true;
    if (data.emailDraft) {
      renderEmailDraft(data.emailDraft);
      focusEmailAfterReply = true;
    }
    conversation.push({ role: 'assistant', content: data.reply });
    pendingUserMessage = undefined;
    if (fromTranscript) micStatus.textContent = 'Question sent. Press Talk to ask another one.';
    idleDeadline = Date.now() + 15 * 60_000;
    scheduleSessionEnd();
    animateNoor();
    if (voiceEnabled) speakReply(data.reply);
  } catch (error) {
    if (turn !== chatSequence) return;
    if (error.status === 401 || error.status === 409) {
      clearConversationDisplay();
      responseText.textContent = 'That conversation has ended. Please ask your question again.';
      sourceLine.textContent = 'New conversation';
      await startSession('Previous conversation cleared. Ready for a new question.');
    } else {
      const index = conversation.indexOf(userMessage);
      if (index !== -1) conversation.splice(index, 1);
      pendingUserMessage = undefined;
      input.value = cleanMessage;
      if (fromTranscript) {
        reviewingTranscript = true;
        transcriptReview.hidden = false;
        micStatus.textContent = 'Question was not sent. Check it and press Send to try again.';
      }
      responseText.textContent = error.message || 'I couldn’t connect just now. Please try again.';
      sourceLine.textContent = 'Connection unavailable';
      renderKnowledgeSources();
      setPose('welcome');
      setAvatarState('error');
    }
  } finally {
    if (turn === chatSequence) {
      chatRequest = undefined;
      noor.removeAttribute('aria-busy');
      input.disabled = !sessionReady;
      sendButton.disabled = !sessionReady;
      boardingTimeButton.disabled = !sessionReady;
      baggageGuidanceButton.disabled = !sessionReady;
      weatherAvailabilityButton.disabled = !sessionReady;
      arrivalNoteButton.disabled = !sessionReady;
      talkButton.disabled = !canTalk();
      weatherNowButton.disabled = !sessionReady;
      weatherArrivalButton.disabled = !sessionReady;
      otherWeatherButton.disabled = !sessionReady;
      arrivalEmailButton.disabled = vercelPreview || !sessionReady;
      if (sessionReady) (focusEmailAfterReply ? emailRecipient : input).focus();
    }
  }
}

async function transcribeForReview(blob) {
  setAvatarState('thoughtful');
  keepRecordingPreview(blob);
  if (vercelPreview && blob.size > 900000) {
    setAvatarState('idle');
    micStatus.textContent = 'Recording is too large. Record a shorter question, or type it.';
    talkButton.disabled = !canTalk();
    return;
  }
  if (blob.size < 1000) {
    setAvatarState('idle');
    micStatus.textContent = 'Recording was too short. Try again, or use Check recording to hear what the microphone captured.';
    talkButton.disabled = !canTalk();
    return;
  }
  const controller = new AbortController();
  transcribeRequest = controller;
  micStatus.textContent = 'Turning your speech into text…';
  try {
    const response = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'content-type': blob.type || 'audio/webm' },
      body: blob,
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not transcribe the recording.');
    if (transcribeRequest !== controller) return;
    talkButton.disabled = !canTalk();
    const transcript = typeof data.text === 'string' ? data.text.trim() : '';
    if (!transcript) {
      setAvatarState('idle');
      micStatus.textContent = 'No speech was recognized. Press Talk to try again, or type your question.';
      return;
    }
    reviewTranscript(transcript);
  } catch (error) {
    if (transcribeRequest !== controller) return;
    if (error.name !== 'AbortError') {
      if (transcribeRequest === controller) setAvatarState('error');
      micStatus.textContent = `${error.message || 'Could not transcribe.'} Use Check recording; if it is silent, choose another microphone.`;
    }
    talkButton.disabled = !canTalk();
  } finally {
    if (transcribeRequest === controller) transcribeRequest = undefined;
  }
}

function reviewTranscript(transcript) {
  setAvatarState('idle');
  input.value = transcript;
  reviewingTranscript = true;
  transcriptReview.hidden = false;
  micStatus.textContent = transcript.length > input.maxLength
    ? 'Transcript is too long. Shorten it before pressing Send.'
    : 'Transcript ready. Check or edit it, then press Send. Press Talk to try again or Stop to discard it.';
  input.focus();
}

function startBrowserRecognition() {
  if (!BrowserSpeechRecognition) return;
  interruptNoor();
  clearTranscriptReview(true);
  clearRecordingPreview();
  browserRecognitionDraft = input.value;
  input.value = '';
  if (voiceAvailable && !voiceEnabled) setVoiceEnabled(true);
  const session = ++micSequence;
  const recognition = new BrowserSpeechRecognition();
  recognition.lang = 'en-US';
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  browserRecognition = recognition;
  let transcript = '';
  let recognitionError = false;
  discardRecording = false;
  talkButton.disabled = true;
  doneButton.disabled = false;
  sendButton.disabled = true;
  micStatus.textContent = 'Requesting microphone access…';
  recognition.onstart = () => {
    if (browserRecognition === recognition && session === micSequence && !discardRecording) setAvatarState('listening');
    if (session === micSequence) micStatus.textContent = 'Listening… words appear in the question field. Press Done when you finish.';
  };
  recognition.onresult = (event) => {
    if (browserRecognition !== recognition || session !== micSequence || discardRecording) return;
    transcript = Array.from(event.results, (result) => result[0]?.transcript || '').join(' ').trim();
    input.value = transcript;
  };
  recognition.onerror = (event) => {
    recognitionError = true;
    if (session === micSequence && !discardRecording) {
      setAvatarState('error');
      micStatus.textContent = event.error === 'not-allowed'
        ? 'Microphone permission was denied. Check browser settings, or type your question.'
        : 'Speech was not recognized. Press Talk to try again, or type your question.';
    }
  };
  recognition.onend = () => {
    if (browserRecognition !== recognition) return;
    clearTimeout(recordTimeout);
    browserRecognition = undefined;
    if (session !== micSequence) return;
    setAvatarState(recognitionError ? 'error' : 'idle');
    doneButton.disabled = true;
    talkButton.disabled = !canTalk();
    sendButton.disabled = !sessionReady;
    if (discardRecording || recognitionError || !transcript) {
      input.value = browserRecognitionDraft ?? '';
      browserRecognitionDraft = undefined;
      if (!discardRecording && !recognitionError) micStatus.textContent = 'No speech was recognized. Press Talk to try again, or type your question.';
      return;
    }
    browserRecognitionDraft = undefined;
    reviewTranscript(transcript);
  };
  try {
    recognition.start();
    recordTimeout = window.setTimeout(() => {
      micStatus.textContent = 'Recording reached 30 seconds. Preparing your transcript…';
      finishRecording(false);
    }, 30_000);
  } catch {
    browserRecognition = undefined;
    input.value = browserRecognitionDraft ?? '';
    browserRecognitionDraft = undefined;
    doneButton.disabled = true;
    talkButton.disabled = !canTalk();
    sendButton.disabled = !sessionReady;
    setAvatarState('error');
    micStatus.textContent = 'Could not start the microphone. You can still type a question.';
  }
}

async function startRecording() {
  if (!sessionReady || recorder?.state === 'recording' || talkButton.disabled) return;
  stopMicCheck();
  if (vercelPreview && !useHostedTranscription() && BrowserSpeechRecognition) return startBrowserRecognition();
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    micStatus.textContent = 'This browser cannot record your microphone. You can still type a question.';
    return;
  }
  interruptNoor();
  clearTranscriptReview(true);
  clearRecordingPreview();
  if (voiceAvailable && !voiceEnabled) setVoiceEnabled(true);
  const session = ++micSequence;
  talkButton.disabled = true;
  sendButton.disabled = true;
  micStatus.textContent = 'Requesting microphone access…';
  try {
    const deviceId = micDeviceSelect.value;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: {
      ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
      echoCancellation: false, noiseSuppression: false, autoGainControl: true,
    } });
    if (session !== micSequence) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    micStream = stream;
    micDeviceSelect.disabled = true;
    void listMicrophones(stream);
    const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    const mimeType = preferred.find((type) => MediaRecorder.isTypeSupported(type));
    const activeRecorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 128000 });
    recorder = activeRecorder;
    const chunks = [];
    discardRecording = false;
    activeRecorder.addEventListener('dataavailable', (event) => {
      if (event.data.size) chunks.push(event.data);
      if (vercelPreview && chunks.reduce((sum, part) => sum + part.size, 0) > 900000) finishRecording(false);
    });
    activeRecorder.addEventListener('stop', () => {
      const blob = new Blob(chunks, { type: activeRecorder.mimeType || mimeType || 'audio/webm' });
      stream.getTracks().forEach((track) => track.stop());
      if (micStream === stream) micStream = undefined;
      micDeviceSelect.disabled = false;
      if (recorder === activeRecorder) recorder = undefined;
      if (session !== micSequence) return;
      sendButton.disabled = !sessionReady;
      if (discardRecording) talkButton.disabled = !canTalk();
      else void transcribeForReview(blob);
    }, { once: true });
    activeRecorder.start(250);
    setAvatarState('listening');
    doneButton.disabled = false;
    micStatus.textContent = 'Listening… press Done when you finish.';
    recordTimeout = window.setTimeout(() => {
      micStatus.textContent = 'Recording reached 30 seconds. Preparing your transcript…';
      finishRecording(false);
    }, 30_000);
  } catch {
    if (session !== micSequence) return;
    micStream?.getTracks().forEach((track) => track.stop());
    micStream = undefined;
    micDeviceSelect.disabled = false;
    recorder = undefined;
    talkButton.disabled = !canTalk();
    doneButton.disabled = true;
    sendButton.disabled = !sessionReady;
    setAvatarState('error');
    micStatus.textContent = 'Microphone access failed. Check browser permission, or type your question.';
  }
}

talkButton.addEventListener('click', startRecording);
doneButton.addEventListener('click', () => {
  micStatus.textContent = 'Finishing your recording…';
  finishRecording(false);
});
stopButton.addEventListener('click', () => {
  stopMicCheck();
  micSequence += 1;
  finishRecording(true);
  interruptNoor();
  clearTranscriptReview(true);
  clearRecordingPreview();
  void cancelSynthesis();
  responseText.textContent = 'Stopped. Ask another question when you’re ready.';
  sourceLine.textContent = 'Stopped';
  voiceStatus.textContent = voiceEnabled ? 'Voice on' : 'Voice off';
  micStatus.textContent = canTalk() ? 'Stopped. Press Talk to ask another question.' : 'Stopped. Type another question when you’re ready.';
  talkButton.disabled = !canTalk();
  setPose('welcome');
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

async function endConversation() {
  if (!sessionReady) return startSession();
  stopMicCheck();
  sessionReady = false;
  clearTimeout(sessionTimer);
  micSequence += 1;
  finishRecording(true);
  interruptNoor();
  clearConversationDisplay();
  input.disabled = true;
  sendButton.disabled = true;
  boardingTimeButton.disabled = true;
  baggageGuidanceButton.disabled = true;
  weatherAvailabilityButton.disabled = true;
  arrivalNoteButton.disabled = true;
  talkButton.disabled = true;
  weatherNowButton.disabled = true;
  weatherArrivalButton.disabled = true;
  otherWeatherButton.disabled = true;
  arrivalEmailButton.disabled = true;
  endConversationButton.disabled = true;
  sessionStatus.textContent = 'Ending the conversation…';
  try {
    const response = await fetch('/api/session/end', { method: 'POST' });
    if (!response.ok) throw new Error('Could not end session');
    await startSession('Conversation cleared. Ready for a new question.');
  } catch {
    endConversationButton.disabled = false;
    endConversationButton.textContent = 'Retry session';
    sessionStatus.textContent = 'Screen cleared, but server reset was not confirmed. Reconnect and retry.';
  }
}

endConversationButton.addEventListener('click', endConversation);
document.addEventListener('visibilitychange', () => {
  if (sessionReady && !document.hidden && Date.now() >= Math.min(idleDeadline, absoluteDeadline)) void endConversation();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted && sessionReady) void endConversation();
});

flightInfoButton.addEventListener('click', () => {
  const isOpen = flightInfoButton.getAttribute('aria-expanded') === 'true';
  flightInfoButton.setAttribute('aria-expanded', String(!isOpen));
  flightCard.hidden = isOpen;
});


/* Demo crew requests are scoped to the current conversation. */
let crewDraftToken = null;
let crewBusy = false;
let crewViewGeneration = 0;
let crewRefreshTimer;
let crewHasActiveRequests = false;
function clearCrewDemo() {
 crewViewGeneration += 1;
 clearTimeout(crewRefreshTimer);
 crewHasActiveRequests = false;
 crewDraftToken = null;
 document.querySelector('#crewPanel').open = false;
 document.querySelector('#crewDetails').value = '';
 document.querySelector('#crewRequests').replaceChildren();
 document.querySelector('#crewStatus').textContent = 'No real crew contacted. Requests expire with this conversation.';
 document.querySelector('#crewReviewDialog').close();
}
async function crewApi(payload) {
 const response = await fetch('/api/crew', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
 const result = await response.json();
 if (!response.ok) throw new Error(result.error || 'Could not update the demo request.');
 return result;
}
function renderCrewRequests(requests) {
 crewHasActiveRequests = requests.some(r => ['submitted','acknowledged','in_progress'].includes(r.status));
 const list = document.querySelector('#crewRequests');
 list.replaceChildren();
 for (const request of requests) {
  const item = document.createElement('li');
  const label = document.createElement('span');
  label.textContent = `Seat ${request.seat} · ${request.category} · ${request.details} · ${request.status.replaceAll('_',' ')} (demo only)`;
  item.append(label);
  if (['submitted','acknowledged','in_progress'].includes(request.status)) {
   const cancel = document.createElement('button');
   cancel.type = 'button';
   cancel.textContent = 'Cancel request';
   cancel.addEventListener('click', () => runCrewAction(async () => {
    await crewApi({ action: 'cancel', id: request.id });
    return 'Demo request cancelled. No real crew contacted.';
   }));
   item.append(cancel);
  }
  list.append(item);
 }
}
async function runCrewAction(action) {
 if (crewBusy) return;
 if (!sessionReady) {
  document.querySelector('#crewStatus').textContent = 'Start a conversation before using demo crew requests.';
  return;
 }
 crewBusy = true;
 const generation = crewViewGeneration;
 const buttons = [...document.querySelectorAll('#crewPanel button, #crewReviewDialog button')];
 buttons.forEach((b) => { b.disabled = true; });
 try {
  const notice = await action(generation);
  if (generation !== crewViewGeneration) return;
  const data = await crewApi({ action: 'list' });
  if (generation !== crewViewGeneration) return;
  renderCrewRequests(data.requests);
  if (notice) document.querySelector('#crewStatus').textContent = notice;
 } catch (error) {
  if (generation === crewViewGeneration) document.querySelector('#crewStatus').textContent = error.message;
 } finally {
  crewBusy = false;
  buttons.forEach((b) => { b.disabled = false; });
  clearTimeout(crewRefreshTimer);
  if (sessionReady && crewHasActiveRequests && generation === crewViewGeneration) crewRefreshTimer = setTimeout(() => void runCrewAction(async () => ''), 10000);
 }
}
document.querySelector('#crewReviewButton').addEventListener('click', () => runCrewAction(async (generation) => {
 const data = await crewApi({ action: 'review', category: document.querySelector('#crewCategory').value, details: document.querySelector('#crewDetails').value });
 if (generation !== crewViewGeneration) return;
 crewDraftToken = data.draft.token;
 document.querySelector('#crewReviewText').textContent = `Seat ${data.draft.seat}\n${data.draft.categoryLabel}\n${data.draft.details}\n\nDemo only. No real crew will be contacted. Review expires after five minutes.`;
 document.querySelector('#crewReviewDialog').showModal();
 return 'Review the request, then confirm submission.';
}));
document.querySelector('#crewConfirmButton').addEventListener('click', () => runCrewAction(async (generation) => {
 await crewApi({ action: 'submit', token: crewDraftToken, confirmed: true });
 if (generation !== crewViewGeneration) return;
 crewDraftToken = null;
 document.querySelector('#crewReviewDialog').close();
 return 'Demo request submitted. This does not mean help is on the way. No real crew contacted.';
}));
document.querySelector('#crewEditButton').addEventListener('click', () => {
 crewDraftToken = null;
 document.querySelector('#crewReviewDialog').close();
});
document.querySelector('#crewRefreshButton').addEventListener('click', () => runCrewAction(async () => 'Showing requests for this conversation only.'));


let reminderToken = null;
let reminderBusy = false;
let reminderGeneration = 0;
let reminderTimer;
let reminderNotified = new Set();
function clearReminderDemo() {
 reminderGeneration += 1;
 clearTimeout(reminderTimer);
 reminderToken = null;
 reminderNotified.clear();
 document.querySelector('#reminderList').replaceChildren();
 document.querySelector('#reminderAlert').textContent = '';
 document.querySelector('#reminderStatus').textContent = 'Nothing scheduled. Keep this page and conversation active.';
 document.querySelector('#reminderPanel').open = false;
 document.querySelector('#reminderReviewDialog').close();
}
function reminderTime(item) {
 return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'long', timeZone: item.timeZone }).format(new Date(item.dueAt)) + ' (' + item.timeZone + ')';
}
async function reminderApi(payload) {
 const response = await fetch('/api/reminders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
 const result = await response.json();
 if (!response.ok) throw new Error(result.error || 'Reminder service is unavailable.');
 return result;
}
function renderReminders(items) {
 clearTimeout(reminderTimer);
 const list = document.querySelector('#reminderList');
 list.replaceChildren();
 for (const item of items) {
  const row = document.createElement('li');
  const label = document.createElement('span');
  label.textContent = item.message + ' · ' + reminderTime(item) + ' · ' + item.status + ' (demo)';
  row.append(label);
  if (item.status === 'pending' || item.status === 'due') {
   const cancel = document.createElement('button');
   cancel.type = 'button';
   cancel.textContent = item.status === 'due' ? 'Dismiss reminder' : 'Cancel reminder';
   cancel.addEventListener('click', () => runReminderAction(async () => {
    await reminderApi({ action: 'cancel', id: item.id });
    return 'Demo reminder cancelled or dismissed.';
   }));
   row.append(cancel);
  }
  list.append(row);
 }
 const due = items.filter((r) => r.status === 'due' && !reminderNotified.has(r.id));
 const activeDue = items.filter((r) => r.status === 'due');
 const alertText = activeDue.length ? 'Demo reminder: ' + activeDue.map((r) => r.message).join('; ') : '';
 if (document.querySelector('#reminderAlert').textContent !== alertText) document.querySelector('#reminderAlert').textContent = alertText;
 if (due.length) {
  due.forEach((r) => reminderNotified.add(r.id));
  revealPassengerTool({ passengerReminders: true });
  document.querySelector('#reminderPanel').open = true;
 }
 const next = items.filter((r) => r.status === 'pending').sort((a,b) => a.dueAt - b.dueAt)[0];
 if (next) reminderTimer = setTimeout(() => {
  if (sessionReady) void runReminderAction(async () => '');
 }, Math.max(100, next.dueAt - Date.now() + 100));
}
async function runReminderAction(action) {
 if (reminderBusy) return;
 if (!sessionReady) {
  document.querySelector('#reminderStatus').textContent = 'Start a conversation first.';
  return;
 }
 reminderBusy = true;
 const generation = reminderGeneration;
 const buttons = [...document.querySelectorAll('#reminderPanel button, #reminderReviewDialog button')];
 buttons.forEach((b) => { b.disabled = true; });
 try {
  const notice = await action(generation);
  if (generation !== reminderGeneration) return;
  const data = await reminderApi({ action: 'list' });
  if (generation !== reminderGeneration) return;
  renderReminders(data.reminders);
  if (notice) document.querySelector('#reminderStatus').textContent = notice;
 } catch (error) {
  if (generation === reminderGeneration) document.querySelector('#reminderStatus').textContent = error.message + ' Refresh reminders to retry.';
 } finally {
  reminderBusy = false;
  buttons.forEach((b) => { b.disabled = false; });
 }
}
document.querySelector('#reminderTimeZone').value = Intl.DateTimeFormat().resolvedOptions().timeZone;
document.querySelector('#reminderReviewButton').addEventListener('click', () => runReminderAction(async (generation) => {
 const minutes = Number(document.querySelector('#reminderMinutes').value);
 if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) throw new Error('Choose 1–120 minutes.');
 const data = await reminderApi({ action: 'review', kind: document.querySelector('#reminderKind').value, dueAt: Date.now() + minutes * 60_000, timeZone: document.querySelector('#reminderTimeZone').value });
 if (generation !== reminderGeneration) return;
 reminderToken = data.draft.token;
 document.querySelector('#reminderReviewText').textContent = data.draft.message + '\n' + reminderTime(data.draft) + '\nUTC: ' + new Date(data.draft.dueAt).toISOString() + '\n\nIn-app demo only. Closing the page, ending the conversation, or letting the conversation expire prevents delivery. No automatic changes for flight delays.';
 document.querySelector('#reminderReviewDialog').showModal();
 return 'Review the message and time, then confirm saving.';
}));
document.querySelector('#reminderConfirmButton').addEventListener('click', () => runReminderAction(async (generation) => {
 await reminderApi({ action: 'save', token: reminderToken, confirmed: true });
 if (generation !== reminderGeneration) return;
 reminderToken = null;
 document.querySelector('#reminderReviewDialog').close();
 return 'Demo reminder saved. Keep this page and conversation active.';
}));
document.querySelector('#reminderEditButton').addEventListener('click', () => {
 reminderToken = null;
 document.querySelector('#reminderReviewDialog').close();
});
document.querySelector('#reminderRefreshButton').addEventListener('click', () => runReminderAction(async () => 'Showing reminders for this conversation.'));


function clearTranslationDemo() {
 document.querySelector('#translationResult').hidden = true;
 document.querySelector('#translatedPhrase').textContent = '';
 document.querySelector('#translationOriginal').textContent = '';
 document.querySelector('#translationPronunciation').textContent = '';
 document.querySelector('#translationCopyStatus').textContent = '';
 document.querySelector('#translatorPanel').open = false;
}
function renderTranslation(data) {
 const result = document.querySelector('#translationResult');
 result.hidden = !data;
 document.querySelector('#translationCopyStatus').textContent = '';
 if (!data) return;
 document.querySelector('#translationOriginal').textContent = data.english;
 const phrase = document.querySelector('#translatedPhrase');
 phrase.textContent = data.text;
 phrase.lang = data.code;
 document.querySelector('#translationPronunciation').textContent = 'Approximate pronunciation: ' + data.pronunciation;
 document.querySelector('#translatorPanel').open = true;
}
document.querySelector('#translatePhraseButton').addEventListener('click', () => {
 if (!sessionReady || chatRequest) return;
 void sendMessage('Translate "' + document.querySelector('#travelPhrase').value + '"');
});
document.querySelector('#translationCopyButton').addEventListener('click', async () => {
 const text = document.querySelector('#translatedPhrase').textContent;
 if (!text) return;
 try {
  await navigator.clipboard.writeText(text);
  document.querySelector('#translationCopyStatus').textContent = 'Translation copied.';
 } catch {
  document.querySelector('#translationCopyStatus').textContent = 'Copy is unavailable. Select the displayed translation and copy it manually.';
 }
});


const demoQuestionButtons = [...document.querySelectorAll('[data-demo-question]')];
for (const button of demoQuestionButtons) {
 button.addEventListener('click', () => {
  if (!sessionReady || sendButton.disabled) return;
  void sendMessage(button.dataset.demoQuestion);
 });
}
const syncDemoQuestionButtons = () => {
 for (const button of demoQuestionButtons) button.disabled = sendButton.disabled;
};
new MutationObserver(syncDemoQuestionButtons).observe(sendButton, { attributes: true, attributeFilter: ['disabled'] });
syncDemoQuestionButtons();

void startSession();
if (window.location.protocol !== 'file:') void loadVoiceAvailability();
