# Noor flight assistant demo

This is a small prototype with offline launch safeguards. It uses fictional Cloudline Air CL 204 flight details and sends general passenger chat to Claude. It can check current model weather for a named city or near Tokyo Haneda and JFK through Open-Meteo, but it does not check real flight, airport-operation, or cabin-service data.

Passenger shortcuts include **Boarding time**, **Baggage guidance**, **Weather availability**, and **Arrival note**. The boarding time is fictional, baggage guidance comes from a draft knowledge page, and the fixed arrival note is general demo guidance. These shortcuts appear alongside Tokyo weather, weather elsewhere, and the arrival email draft.

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

Click **Tokyo weather now** or **Weather at sample arrival** to ask Noor and see a read-only weather card. **Weather elsewhere** fills in an example question; replace the selected city with another place. You can also type or say a question such as “What is the current weather in Paris, France?” The server resolves a named city through Open-Meteo geocoding, checks its current model conditions, and passes only those facts and the question to Claude for a short reply. If the name is ambiguous, Noor asks for a state or country. If Claude is not connected or cannot answer, Noor uses a factual server-written reply. The server calls only the fixed Open-Meteo geocoding and forecast hosts; a passenger cannot supply an arbitrary URL. Future forecasts remain limited to the fictional Tokyo arrival.

The sample arrival is October 13, 2026 at 2:40 PM Japan time. Its forecast is available only while that time is in the future and within the provider's forecast window. The card shows the forecast time and when the data was retrieved. If weather is unavailable, Noor reports that instead of inventing conditions. Weather is for passenger information, not aircraft operating decisions. Flight details remain fictional.

Weather and place data: [Open-Meteo](https://open-meteo.com/). Its free API is for non-commercial evaluation and requires attribution; a commercial deployment needs a suitable licence or provider. The server must be able to reach `api.open-meteo.com` and `geocoding-api.open-meteo.com` over HTTPS.

## Conversation sessions

The server creates a new anonymous passenger session when the page opens. The browser sends only each new message; conversation history is kept in server memory, limited to the most recent six exchanges. A separate 30-day visitor cookie keeps daily limits in effect across conversations. Both cookies are HttpOnly and SameSite=Strict; production adds Secure. No passenger profile or conversation text is saved to SQLite or another persistent store.

Click **End conversation** to stop voice activity, clear the screen, invalidate that session on the server, and start a fresh one. Reloading the page also starts a fresh session. Sessions expire after 15 minutes without chat activity or two hours total, whichever comes first. If a session expires while the page is open, Noor clears the conversation and asks you to send the question again. Restarting the server also clears all sessions. Production requires `PUBLIC_ORIGIN` to be HTTPS, binds to `0.0.0.0` by default, accepts POSTs only from that origin, and sends Secure cookies and an HSTS header. The hosting proxy must actually serve HTTPS; with Cloudflare, use Full (strict) to protect the origin connection too.

## Usage limits and monitoring

The server saves only pseudonymous visitor hashes, request categories, counts, and Claude token totals in `data/usage.sqlite` by default. It reserves an estimated token amount before each Claude request, then replaces that estimate with Anthropic's reported input/output usage when available. Uncertain provider outcomes keep their reservation so a timeout cannot create free retries. Default UTC-day limits are 30 Claude requests and 30,000 tokens per browser visitor, with 500 requests and 300,000 tokens overall; speech, transcription, and verification have separate limits in `.env.example`. These are application limits, so also set a Claude workspace spending cap. Clearing cookies can reset one visitor's identity; the overall cap remains. Real user-account limits require an authentication integration.

Usage and error events are logged as structured JSON with route, status, duration, and token counts. Prompts, transcripts, email addresses, cookies, and API keys are excluded. `GET /healthz` returns a minimal health response for a hosting monitor. Visitor usage records are deleted after 30 days. This SQLite ledger and the email scheduler support one server instance; moving to multiple instances requires shared storage and coordination.

## Retention

Microphone audio is processed in memory and not saved. Transcripts are shown in the browser and, when sent, kept only in the in-memory conversation until it ends or expires. Email verification rows are removed after one day; terminal email jobs have addresses and message bodies cleared after 30 days; email event rows are removed after 90 days. The local server runs cleanup automatically. Review hosting logs, backups, and provider retention separately before launch.

## Linux package and Supabase preparation

The repository root has a `Dockerfile` that installs Node, Python, Chatterbox, and faster-whisper, and copies the allowlisted passenger knowledge pages. Build it from the `Noor Sultana` folder, set `PUBLIC_ORIGIN` and secrets as hosting environment variables, and mount persistent storage at `/app/data`. `/healthz` is the health-check path. The image uses the installed package versions from the working Windows environment, but voice speed and GPU support must be measured on the chosen Linux host. Building the image downloads dependencies and models.

`../supabase/migrations/20261011_noor_foundation.sql` prepares private-by-policy email and usage tables plus a deletion function. Enable Supabase Cron and apply `../supabase/cron.sql` to run that function daily. **The live app still uses SQLite.** Moving the email scheduler and usage ledger to Supabase requires an adapter, actual project credentials, and migration tests; do not add multiple app instances before that work is complete. Keep the Supabase secret key server-side.

## Noor’s voice

Click **Voice off** in the demo to turn on spoken replies. Noor’s next reply is synthesized locally with Chatterbox Turbo’s built-in voice. Text chat still works if the voice model is unavailable.

Each conversation has its own speech job. Chatterbox processes jobs one at a time to fit the local voice model; a visitor's **Stop** button cancels only that visitor's job. If a job is already generating, the worker restarts before processing the next queued visitor. Voice requests require an active conversation session.

## Talk to Noor

1. Click **Talk** and allow the browser to use your microphone. If more than one microphone is available, select the intended one below the controls. Noor uses automatic gain control while recording; browser echo cancellation and noise suppression are off so quiet speech is less likely to be removed.
2. Ask a question, then click **Done**. A local faster-whisper `base.en` model transcribes the recording and puts the words in the message box. Recording also stops after 30 seconds.
3. Check and edit the transcript, then click **Send** for Noor to answer and speak. Click **Talk** to record again, or **Stop** to discard the transcript, stop playback, or cancel speech generation. You can still type and send a question normally.

If transcription cannot hear you, click **Check recording** to play back the clip locally. The page does not save this playback clip; it is cleared when you record again or end the conversation.

Talk automatically turns Noor's voice on. The microphone is active only between **Talk** and **Done** (or **Stop**). Automatic end-of-turn detection and always-listening are not used in this version.

The server uses the existing Chatterbox Python environment at `../chatterboc-demo/.venv/Scripts/python.exe`, which now also has `faster-whisper` installed. If you move this project or use another environment, set `CHATTERBOX_PYTHON` in `.env.local` to the full path of a Python executable with `chatterbox-tts`, PyTorch, torchaudio, and `faster-whisper` installed. You can set `ASR_PYTHON` separately if speech recognition uses another environment. The server starts loading Chatterbox when it launches, so the first spoken reply waits less if you allow that startup to finish. Later replies reuse the model. Microphone recordings are processed locally for transcription; the transcript is sent to Claude. The audio reference and generated speech are not sent to Claude.

The Hope reference is a 12.5-second ElevenLabs clip converted to mono 24 kHz, 16-bit PCM WAV. The hosted Chatterbox voice sends this clip to Replicate as a data URI with each speech request. The local demo uses it when `NOOR_VOICE_REFERENCE=voice/noor-reference.wav` is set in `.env.local`; restart `node server.mjs` after changing that setting. Chatterbox follows the reference voice and its delivery, though its generated speech may not match the source exactly.
