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
const weatherNowButton = document.querySelector('#weatherNowButton');
const weatherArrivalButton = document.querySelector('#weatherArrivalButton');
const arrivalEmailButton = document.querySelector('#arrivalEmailButton');
const weatherCard = document.querySelector('#weatherCard');
const weatherTitle = document.querySelector('#weatherTitle');
const weatherSummary = document.querySelector('#weatherSummary');
const weatherTimes = document.querySelector('#weatherTimes');
const weatherStatus = document.querySelector('#weatherStatus');
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
const noor = document.querySelector('#noorWrap');
const flightCard = document.querySelector('#flightCard');
const flightInfoButton = document.querySelector('#flightInfoButton');
const voiceToggle = document.querySelector('#voiceToggle');
const voiceStatus = document.querySelector('#voiceStatus');
const talkButton = document.querySelector('#talkButton');
const doneButton = document.querySelector('#doneButton');
const stopButton = document.querySelector('#stopButton');
const micStatus = document.querySelector('#micStatus');
const transcriptReview = document.querySelector('#transcriptReview');
const vercelPreview = document.documentElement.dataset.vercelPreview === 'true';

if (vercelPreview) {
  arrivalEmailButton.hidden = true;
  voiceToggle.closest('.voice-controls').hidden = true;
  talkButton.closest('.mic-controls').hidden = true;
  voiceToggle.disabled = true;
}

const conversation = [];
const maxTurns = 12;
let sessionReady = false;
let sessionTimer;
let idleDeadline = 0;
let absoluteDeadline = 0;
const voiceAudio = new Audio();
let voiceEnabled = false;
let voiceRequest;
let voiceUrl;
let voiceGeneration = 0;
let chatRequest;
let chatSequence = 0;
let pendingUserMessage;
let transcribeRequest;
let recorder;
let micStream;
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

function stopSpeech() {
  voiceGeneration += 1;
  voiceRequest?.abort();
  voiceRequest = undefined;
  voiceAudio.pause();
  voiceAudio.removeAttribute('src');
  voiceAudio.load();
  if (voiceUrl) URL.revokeObjectURL(voiceUrl);
  voiceUrl = undefined;
}

async function cancelSynthesis() {
  try { await fetch('/api/stop', { method: 'POST' }); } catch { /* Local server may be unavailable. */ }
}

async function speakReply(text) {
  stopSpeech();
  if (!voiceEnabled) return;
  const generation = voiceGeneration;
  const controller = new AbortController();
  voiceRequest = controller;
  voiceStatus.textContent = 'Preparing Noor’s voice…';
  try {
    const response = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('Voice unavailable');
    const audio = await response.blob();
    if (generation !== voiceGeneration || !voiceEnabled) return;
    voiceRequest = undefined;
    voiceUrl = URL.createObjectURL(audio);
    voiceAudio.src = voiceUrl;
    voiceStatus.textContent = 'Noor is speaking. Press Stop to interrupt.';
    await voiceAudio.play();
  } catch (error) {
    if (error.name !== 'AbortError' && generation === voiceGeneration) {
      voiceStatus.textContent = 'Voice unavailable. Check the server window or try again.';
    }
  } finally {
    if (voiceRequest === controller) voiceRequest = undefined;
  }
}

voiceAudio.addEventListener('ended', () => {
  if (voiceUrl) URL.revokeObjectURL(voiceUrl);
  voiceUrl = undefined;
  voiceStatus.textContent = 'Voice on';
});

function setVoiceEnabled(enabled, replay = true) {
  voiceEnabled = enabled;
  voiceToggle.setAttribute('aria-pressed', String(enabled));
  voiceToggle.textContent = enabled ? '🔊 Voice on' : '🔇 Voice off';
  if (enabled) {
    voiceStatus.textContent = 'Noor will speak her replies.';
    if (replay && conversation.at(-1)?.role === 'assistant') speakReply(conversation.at(-1).content);
  } else {
    stopSpeech();
    void cancelSynthesis();
    voiceStatus.textContent = 'Turn on voice to hear Noor’s replies.';
  }
}

voiceToggle.addEventListener('click', () => setVoiceEnabled(!voiceEnabled));

function setPose(pose) {
  noor.dataset.pose = pose === 'thoughtful' ? 'thinking' : 'welcome';
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

async function startSession(successMessage = 'Conversation ready. End it to clear this screen.') {
  sessionReady = false;
  clearTimeout(sessionTimer);
  input.disabled = true;
  sendButton.disabled = true;
  talkButton.disabled = true;
  weatherNowButton.disabled = true;
  weatherArrivalButton.disabled = true;
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
    talkButton.disabled = vercelPreview || !sessionReady;
    weatherNowButton.disabled = false;
    weatherArrivalButton.disabled = false;
    arrivalEmailButton.disabled = vercelPreview;
    endConversationButton.disabled = false;
    endConversationButton.textContent = 'End conversation';
    sessionStatus.textContent = successMessage;
  } catch {
    endConversationButton.disabled = false;
    endConversationButton.textContent = 'Retry session';
    sessionStatus.textContent = 'Could not start a conversation. Check the server and retry.';
  }
}

function clearConversationDisplay() {
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
  voiceStatus.textContent = voiceEnabled ? 'Voice on' : 'Turn on voice to hear Noor’s replies.';
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
  weatherStatus.textContent = weather.kind === 'arrival' ? 'Arrival time comes from the fictional demo flight.' : 'Current model conditions near the airport.';
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
    link.textContent = `${source.title} (draft v${source.version}; ${source.review})`;
    knowledgeSources.append(link);
  }
  if (!knowledgeSources.childElementCount) knowledgeSources.hidden = true;
}

weatherNowButton.addEventListener('click', () => void sendMessage('What is the weather near Tokyo Haneda now?'));
weatherArrivalButton.addEventListener('click', () => void sendMessage('What is the weather near Tokyo Haneda at the sample arrival?'));
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
  weatherNowButton.disabled = !sessionReady;
  weatherArrivalButton.disabled = !sessionReady;
  arrivalEmailButton.disabled = vercelPreview || !sessionReady;
  noor.removeAttribute('aria-busy');
}

function finishRecording(discard = false) {
  if (discard) discardRecording = true;
  if (!recorder || recorder.state === 'inactive') return;
  clearTimeout(recordTimeout);
  recorder.stop();
  micStream?.getTracks().forEach((track) => track.stop());
  micStream = undefined;
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
}

function clearTranscriptReview(clearText = false) {
  if (clearText && reviewingTranscript) input.value = '';
  reviewingTranscript = false;
  transcriptReview.hidden = true;
}

async function sendMessage(message) {
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

  if (recorder?.state === 'recording') {
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
  weatherNowButton.disabled = true;
  weatherArrivalButton.disabled = true;
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
      body: JSON.stringify({ message: cleanMessage }),
      signal: controller.signal,
    });
    const data = await response.json();
    if (turn !== chatSequence) return;
    if (!response.ok) {
      const error = new Error(data.error || 'Noor could not respond right now.');
      error.status = response.status;
      throw error;
    }

    responseText.textContent = data.reply;
    setPose(data.expression);
    sourceLine.textContent = data.sourceLabel || 'Claude · Fictional flight information · Not live';
    renderKnowledgeSources(data.knowledgeSources);
    if (data.weather) renderWeather(data.weather);
    else if (data.sourceLabel === 'Weather unavailable') weatherCard.hidden = true;
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
    }
  } finally {
    if (turn === chatSequence) {
      chatRequest = undefined;
      noor.removeAttribute('aria-busy');
      input.disabled = !sessionReady;
      sendButton.disabled = !sessionReady;
      talkButton.disabled = vercelPreview || !sessionReady;
      weatherNowButton.disabled = !sessionReady;
      weatherArrivalButton.disabled = !sessionReady;
      arrivalEmailButton.disabled = vercelPreview || !sessionReady;
      if (sessionReady) (focusEmailAfterReply ? emailRecipient : input).focus();
    }
  }
}

async function transcribeForReview(blob) {
  if (blob.size < 1000) {
    micStatus.textContent = 'Recording was too short. Please try again.';
    talkButton.disabled = !sessionReady;
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
    talkButton.disabled = !sessionReady;
    const transcript = typeof data.text === 'string' ? data.text.trim() : '';
    if (!transcript) {
      micStatus.textContent = 'No speech was recognized. Press Talk to try again, or type your question.';
      return;
    }
    input.value = transcript;
    reviewingTranscript = true;
    transcriptReview.hidden = false;
    micStatus.textContent = transcript.length > input.maxLength
      ? 'Transcript is too long. Shorten it before pressing Send.'
      : 'Transcript ready. Check or edit it, then press Send. Press Talk to record again or Stop to discard it.';
    input.focus();
  } catch (error) {
    if (error.name !== 'AbortError') micStatus.textContent = error.message || 'Could not transcribe. Please try again.';
    talkButton.disabled = !sessionReady;
  } finally {
    if (transcribeRequest === controller) transcribeRequest = undefined;
  }
}

async function startRecording() {
  if (!sessionReady || recorder?.state === 'recording' || talkButton.disabled) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    micStatus.textContent = 'This browser cannot record your microphone. You can still type a question.';
    return;
  }
  interruptNoor();
  clearTranscriptReview(true);
  if (!voiceEnabled) setVoiceEnabled(true, false);
  const session = ++micSequence;
  talkButton.disabled = true;
  micStatus.textContent = 'Requesting microphone access…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (session !== micSequence) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    micStream = stream;
    const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    const mimeType = preferred.find((type) => MediaRecorder.isTypeSupported(type));
    const activeRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder = activeRecorder;
    const chunks = [];
    discardRecording = false;
    activeRecorder.addEventListener('dataavailable', (event) => {
      if (event.data.size) chunks.push(event.data);
    });
    activeRecorder.addEventListener('stop', () => {
      const blob = new Blob(chunks, { type: activeRecorder.mimeType || mimeType || 'audio/webm' });
      if (recorder === activeRecorder) recorder = undefined;
      if (session !== micSequence) return;
      if (discardRecording) talkButton.disabled = !sessionReady;
      else void transcribeForReview(blob);
    }, { once: true });
    activeRecorder.start(250);
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
    recorder = undefined;
    talkButton.disabled = !sessionReady;
    doneButton.disabled = true;
    micStatus.textContent = 'Microphone access failed. Check browser permission, or type your question.';
  }
}

talkButton.addEventListener('click', startRecording);
doneButton.addEventListener('click', () => {
  micStatus.textContent = 'Finishing your recording…';
  finishRecording(false);
});
stopButton.addEventListener('click', () => {
  micSequence += 1;
  finishRecording(true);
  interruptNoor();
  clearTranscriptReview(true);
  void cancelSynthesis();
  responseText.textContent = 'Stopped. Ask another question when you’re ready.';
  sourceLine.textContent = 'Stopped';
  voiceStatus.textContent = voiceEnabled ? 'Voice on' : 'Voice off';
  micStatus.textContent = 'Stopped. Press Talk to ask another question.';
  talkButton.disabled = !sessionReady;
  setPose('welcome');
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

async function endConversation() {
  if (!sessionReady) return startSession();
  sessionReady = false;
  clearTimeout(sessionTimer);
  micSequence += 1;
  finishRecording(true);
  interruptNoor();
  clearConversationDisplay();
  input.disabled = true;
  sendButton.disabled = true;
  talkButton.disabled = true;
  weatherNowButton.disabled = true;
  weatherArrivalButton.disabled = true;
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

void startSession();
