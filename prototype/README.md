# Noor flight assistant demo

This is a small local prototype. It uses fictional Cloudline Air CL 204 flight details and sends general passenger chat to Claude. It can check real public weather near Tokyo Haneda and JFK through Open-Meteo, but it does not check real flight, airport-operation, or cabin-service data.

## Passenger knowledge

For common passenger questions, the server searches the seven local [draft knowledge pages](../Documents/knowledge/README.md) and sends one matching excerpt to Claude. Noor's answer shows a link to the draft page. The pages offer general next steps only; they are not approved Cloudline Air policy. Noor should say when an allowance, deadline, entitlement, booking detail, or live status cannot be verified. The document search uses a small defined set of question topics and may miss other wording. Weather questions use the separate weather lookup.

The server reads only the seven allowlisted files. Each source link opens the full draft page. Changes to those files are read on the next matching question. Before deployment, an airline owner must verify the rules, sources, and review dates, and approve the pages for policy use.

## Arrival email

Click **Arrival email draft** or ask Noor for an email. The server supplies a fixed arrival note and demo subject; Claude cannot write or change it. Enter an address and request a six-digit verification code. After the address is verified, choose a local send time (one minute to 30 days ahead), review the exact recipient, subject, body, time, and attachment status, then select **Confirm schedule**. Noor reports **scheduled** only after the server saves the request. The background worker sends due requests through Resend. The status list shows scheduled, sent, failed, cancelled, or unknown provider outcomes; scheduled requests can be cancelled. **Sent** means Resend accepted the email; the separate delivery event reflects later provider updates. If the provider outcome cannot be confirmed, the request is marked **unknown** instead of claiming delivery.

To enable email, add `RESEND_API_KEY` and `NOOR_EMAIL_FROM` to `prototype/.env.local`. The sample `noor@your-domain.com` in `.env.example` is a fill-in: replace it with an address on a domain verified in Resend. Restart the server after configuration. Without both settings, verification and scheduling return a clear unavailable message. This demo does not include a live API key or verified domain.

Requests are saved in `prototype/data/email.sqlite` by default; this folder is ignored by Git. The server stores the verified address, fixed message, confirmation and provider outcomes. Verification codes expire after 10 minutes and are stored only as hashes. A new conversation can regain status and cancellation access by verifying the same address again. Terminal requests have their address and message removed after 30 days; event records are removed after 90 days. The server checks ownership and session access for review, scheduling, status, and cancellation. The email body identifies the sample flight as fictional and contains no live airport or flight details.

## Connect Claude

Requires Node.js 22 or later and an Anthropic API key. Sending chat messages makes API calls billed to your Anthropic account.

1. Copy `.env.example` to `.env.local` in this folder.
2. Put your Anthropic key in `.env.local` as the value of `ANTHROPIC_API_KEY`. Keep this file private; it is ignored by Git.
3. From this folder, start the local server:

   ```sh
   node server.mjs
   ```

4. Open `http://127.0.0.1:4173` in a browser.

Restart the server after changing `.env.local`. The key stays on the server and is not sent to the browser. The prototype uses `claude-haiku-5-5` by default; set `ANTHROPIC_MODEL` in `.env.local` to change it.

## Destination weather

Click **Tokyo weather now** or **Weather at sample arrival** to ask Noor and see a read-only weather card. You can also type or say a question about current weather near JFK or Tokyo, or weather around the fictional Tokyo arrival. The server checks Open-Meteo data and passes only those weather facts and the current question to Claude for a short reply. If Claude is not connected or cannot answer, Noor uses a factual server-written reply, so weather still works without a Claude key. The server only queries those two fixed locations; it does not accept an arbitrary URL or destination.

The sample arrival is October 13, 2026 at 2:40 PM Japan time. Its forecast is available only while that time is in the future and within the provider's forecast window. The card shows the forecast time and when the data was retrieved. If weather is unavailable, Noor reports that instead of inventing conditions. Weather is for passenger information, not aircraft operating decisions. Flight details remain fictional.

Weather data: [Open-Meteo](https://open-meteo.com/). Its free API is for non-commercial evaluation and requires attribution; a commercial deployment needs a suitable licence or provider. The server must be able to reach `api.open-meteo.com` over HTTPS.

## Conversation sessions

The server creates a new anonymous passenger session when the page opens. The browser sends only each new message; conversation history is kept in server memory, limited to the most recent six exchanges. The session identifier is an HttpOnly, SameSite cookie. No passenger profile or conversation is saved to SQLite or another persistent store.

Click **End conversation** to stop voice activity, clear the screen, invalidate that session on the server, and start a fresh one. Reloading the page also starts a fresh session. Sessions expire after 15 minutes without chat activity or two hours total, whichever comes first. If a session expires while the page is open, Noor clears the conversation and asks you to send the question again. Restarting the server also clears all sessions. This is a local HTTP demo; a deployed version needs HTTPS and a Secure session cookie.

## Noor’s voice

Click **Voice off** in the demo to turn on spoken replies. Noor’s next reply is synthesized locally with Chatterbox Turbo using `voice/noor-reference.wav`. Text chat still works if the voice model is unavailable.

## Talk to Noor

1. Click **Talk** and allow the browser to use your microphone. Noor requests the browser's echo cancellation, noise suppression, and automatic gain control.
2. Ask a question, then click **Done**. A local faster-whisper `base.en` model transcribes the recording and sends the transcript to Claude. Noor shows the answer and speaks it. Recording also stops after 30 seconds.
3. Click **Stop** to stop playback, cancel speech generation, or discard a recording. You can still type and send a question normally.

Talk automatically turns Noor's voice on. The microphone is active only between **Talk** and **Done** (or **Stop**). Automatic end-of-turn detection and always-listening are not used in this version.

The server uses the existing Chatterbox Python environment at `../chatterboc-demo/.venv/Scripts/python.exe`, which now also has `faster-whisper` installed. If you move this project or use another environment, set `CHATTERBOX_PYTHON` in `.env.local` to the full path of a Python executable with `chatterbox-tts`, PyTorch, torchaudio, and `faster-whisper` installed. You can set `ASR_PYTHON` separately if speech recognition uses another environment. The server starts loading Chatterbox when it launches, so the first spoken reply waits less if you allow that startup to finish. Later replies reuse the model. Microphone recordings are processed locally for transcription; the transcript is sent to Claude. The audio reference and generated speech are not sent to Claude.

The included reference is a 12.5-second ElevenLabs Hope clip converted to mono 24 kHz, 16-bit PCM WAV. To try a different voice, replace `voice/noor-reference.wav` with another suitable reference WAV and restart `node server.mjs`. Chatterbox follows the reference voice and its delivery, so use a clip with the accent and style you want Noor to speak.
