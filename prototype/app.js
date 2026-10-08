const form = document.querySelector('#messageForm');
const input = document.querySelector('#messageInput');
const sendButton = form.querySelector('button[type="submit"]');
const responseText = document.querySelector('#responseText');
const userLine = document.querySelector('#userLine');
const userText = document.querySelector('#userText');
const sourceLine = document.querySelector('#sourceLine');
const noor = document.querySelector('#noorWrap');
const flightCard = document.querySelector('#flightCard');
const flightInfoButton = document.querySelector('#flightInfoButton');

const conversation = [];
const maxTurns = 12;

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
}

async function sendMessage(message) {
  const cleanMessage = message.trim();
  if (!cleanMessage || sendButton.disabled) return;

  userText.textContent = cleanMessage;
  userLine.hidden = false;
  input.value = '';
  input.disabled = true;
  sendButton.disabled = true;
  noor.setAttribute('aria-busy', 'true');
  setPose('thoughtful');
  showTemporaryStatus('Let me think about that…');

  conversation.push({ role: 'user', content: cleanMessage });
  if (conversation.length > maxTurns) conversation.splice(0, conversation.length - maxTurns);

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: conversation }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Noor could not respond right now.');

    responseText.textContent = data.reply;
    setPose(data.expression);
    sourceLine.textContent = 'Claude · Fictional flight information · Not live';
    conversation.push({ role: 'assistant', content: data.reply });
    animateNoor();
  } catch (error) {
    conversation.pop();
    responseText.textContent = error.message || 'I couldn’t connect just now. Please try again.';
    sourceLine.textContent = 'Connection unavailable';
    setPose('welcome');
  } finally {
    noor.removeAttribute('aria-busy');
    input.disabled = false;
    sendButton.disabled = false;
    input.focus();
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

flightInfoButton.addEventListener('click', () => {
  const isOpen = flightInfoButton.getAttribute('aria-expanded') === 'true';
  flightInfoButton.setAttribute('aria-expanded', String(!isOpen));
  flightCard.hidden = isOpen;
});
