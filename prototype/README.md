# Noor flight assistant demo

This is a small prototype with offline launch safeguards. The home page offers four fictional sample trips and a filterable destination carousel. The passenger demo is at `/flight-demo.html`; it uses fictional Noor International Airlines CL 204 flight details and sends general passenger chat to Claude. The trip examples have no booking or payment connection. It can check current model weather for a named city or near Tokyo Haneda and JFK through Open-Meteo, but it does not check real flight, airport-operation, or cabin-service data.

Passenger shortcuts include **Boarding time**, **Baggage guidance**, **Weather availability**, and **Arrival note**. The boarding time is fictional, baggage guidance comes from a draft knowledge page, and the fixed arrival note is general demo guidance. These shortcuts appear alongside Tokyo weather, weather elsewhere, and the arrival email draft.

## Live2D avatar

Open `/flight-demo.html` on the loopback server to use the native V6 rig. It adds small head tilt, independent brows, horizontal gaze, restrained body sway and a modest arm gesture to V5's two-eye blink and single mouth-open shape. The canvas keeps the existing avatar frame. The PNG remains visible while loading and returns if assets or WebGL fail. No browser vertex correction is applied.

`avatar.js` exposes `window.noorAvatar` with readiness, capability flags, `nativePose`, `setState()`, `setMouthOpen()` and `resetMouth()`. States are `welcoming`, `thoughtful`, `listening`, `speaking`, `idle` and `error`. Pending chat answers use thoughtful; voice generation and buffering use idle; actual audio playback uses speaking; Stop/end return to idle. Turning Voice on enables future replies without replaying conversation history. `speech-mouth.js` measures output through Web Audio and HTMLAudio without opening a microphone. The mouth and blink remain independent of poses. Reduced motion neutralizes optional poses, disables automatic blinking and cabin-light animation, and retains speech-mouth movement.

During reply preparation the app shows the retained hand-to-chin thinking PNG. Actual speech switches back to the native model, with short head tilts and left-arm gestures followed by holds and rests, within verified parameter bounds. Continuous body rocking is disabled. The thinking image is static; a rigged hand-to-chin pose and independent right-arm gesture are not built. Mouth movement is still audio-volume driven, not phoneme matched. A separate V7 authoring copy and local Rhubarb timing proof exist outside the repo; no shaped-mouth V7 export or cue playback is enabled yet.

The asset inventory, hashes and bounded verification are in `live2d/noor-v6/manifest.json`. The V6 pose gate requires the loaded MOC's SHA256, real native keyforms and measured finite vertex movement. Parameter names alone do not enable it. Pose failures disable only optional poses. V6 passed 1,728 combined native geometry checks and a six-pose WebGL review; its neutral rendered pixels match V5. The source was saved, closed, reopened and re-exported with matching runtime hashes. Detailed local evidence stays in the outer workbench. When replacing an export, update its versioned path, inventory, hashes and verification before restarting the server.

Current limits: head roll rather than a 3D head turn; horizontal gaze only; one mouth-open shape rather than phoneme shapes; a small gesture using the hanging-arm art. A hand-to-chin pose needs additional hand and sleeve artwork. State mapping and playback tests do not establish microphone transcription quality or streaming speech.

The user authorized public Noor application delivery on 2026-10-19. `live2d/noor-v6/` contains the fixed, versioned application runtime, model, Framework, shaders and required license notices. Local and hosted pages use the same verified V6 model. Builds validate hashes, model references and module imports and fail on missing assets. Editable rigs, the raw SDK and historical `live2d-local/` exports remain private/protected; the public application is subject to the bundled Live2D terms.

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

For unlimited daily usage during local development, set `NOOR_LOCAL_UNLIMITED_USAGE=1` in the ignored `.env.local` and restart the server. This applies only to a non-production server bound to loopback (`127.0.0.1`, `localhost` or `::1`). Production ignores this flag and retains its configured daily caps. Usage recording, short-term request limits and provider billing/limits still apply.

The server saves only pseudonymous visitor hashes, request categories, counts, and Claude token totals in `data/usage.sqlite` by default. It reserves an estimated token amount before each Claude request, then replaces that estimate with Anthropic's reported input/output usage when available. Uncertain provider outcomes keep their reservation so a timeout cannot create free retries. Default UTC-day limits are 30 Claude requests and 30,000 tokens per browser visitor, with 500 requests and 300,000 tokens overall; speech, transcription, and verification have separate limits in `.env.example`. These are application limits, so also set a Claude workspace spending cap. Clearing cookies can reset one visitor's identity; the overall cap remains. Real user-account limits require an authentication integration.

Usage and error events are logged as structured JSON with route, status, duration, and token counts. Prompts, transcripts, email addresses, cookies, and API keys are excluded. `GET /healthz` returns a minimal health response for a hosting monitor. Visitor usage records are deleted after 30 days. This SQLite ledger and the email scheduler support one server instance; moving to multiple instances requires shared storage and coordination.

## Retention

Microphone audio is processed in memory and not saved. Transcripts are shown in the browser and, when sent, kept only in the in-memory conversation until it ends or expires. Email verification rows are removed after one day; terminal email jobs have addresses and message bodies cleared after 30 days; email event rows are removed after 90 days. The local server runs cleanup automatically. Review hosting logs, backups, and provider retention separately before launch.

## Linux package and Supabase preparation

The repository root has a `Dockerfile` that installs Node, Python, Chatterbox, and faster-whisper, and copies the allowlisted passenger knowledge pages. Build it from the `Noor Sultana` folder, set `PUBLIC_ORIGIN` and secrets as hosting environment variables, and mount persistent storage at `/app/data`. `/healthz` is the health-check path. The image uses the installed package versions from the working Windows environment, but voice speed and GPU support must be measured on the chosen Linux host. Building the image downloads dependencies and models.

`../supabase/migrations/20261011_noor_foundation.sql` prepares private-by-policy email and usage tables plus a deletion function. Enable Supabase Cron and apply `../supabase/cron.sql` to run that function daily. **The live app still uses SQLite.** Moving the email scheduler and usage ledger to Supabase requires an adapter, actual project credentials, and migration tests; do not add multiple app instances before that work is complete. Keep the Supabase secret key server-side.

## Noor’s voice

Click **Voice off** in the demo to turn on spoken replies. Noor’s next reply is synthesized locally with Chatterbox Turbo, using `NOOR_VOICE_REFERENCE` when configured or its built-in voice otherwise. Text chat still works if the voice model is unavailable.

Each conversation has its own speech job. Chatterbox processes jobs one at a time to fit the local voice model; a visitor's **Stop** button cancels only that visitor's job. If a job is already generating, the worker restarts before processing the next queued visitor. Voice requests require an active conversation session.

### Faster first audio

The browser requests `{text, stream:true}`. The local Node endpoint derives at most five speech segments, preferring sentence and semicolon breaks near 80 characters. The hosted endpoint keeps its existing three-segment limit. Both return newline-delimited JSON audio records from the complete reply; the final segment retains any longer remainder. Playback starts with the first segment while the next generates. The older `{text}` request still returns one WAV file. Stop, a new reply, session end and disconnect cancel pending segments. Mouth movement follows the current playback segment.

The local worker prepares the configured reference voice once during warmup and reuses its conditioning. A small memory cache reuses only exact fixed public phrases such as “Hello.” and “Welcome aboard.” Cache entries expire after ten minutes, share a 2 MB limit, and are keyed by engine/reference identity. Arbitrary conversation replies are not cached. Restarting clears local cache; hosted cache is per warm function instance, not persistent shared storage. Authorization and normal quota checks still run before a cache hit.

Hosted streaming reserves the original exact reply and its character allowance once, rather than trusting client-supplied chunks or charging each sentence as a new reply. It still uses Replicate. Streaming has a 50-second generation budget and up to two seconds for cancellation cleanup within a configured 60-second function duration; this change does not establish live deployed latency. CPU generation can leave pauses between segments, and earlier first audio does not imply shorter total synthesis time. For the timestamp-heavy flight reply, one warm-worker comparison reduced the longest projected playback gap from 26.5 to 8.4 seconds, with first audio at 5.7 versus 6.2 seconds. This local change does not change deployed segmentation or prove hosted performance. No phoneme alignment or true within-sentence model streaming is implemented. One local CPU sample began audio at 3.4 seconds instead of waiting 10.5 seconds for the old complete WAV, while total synthesis remained about 11.1 seconds. These single measurements are not a general performance guarantee.

## Talk to Noor

1. Click **Talk** and allow the browser to use your microphone. If more than one microphone is available, select the intended one below the controls. Noor uses automatic gain control while recording; browser echo cancellation and noise suppression are off so quiet speech is less likely to be removed.
2. Ask a question, then click **Done**. Locally, a faster-whisper `base.en` model transcribes the recording. On the deployed site, Chrome and Firefox use hosted Replicate transcription when available; supported browsers fall back to browser speech recognition if hosted recording is unavailable. The words appear in the message box for review. Recording also stops after 30 seconds.
3. Check and edit the transcript, then click **Send** for Noor to answer and speak. Click **Talk** to record again, or **Stop** to discard the transcript, stop playback, or cancel speech generation. You can still type and send a question normally.

If transcription cannot hear you, click **Check recording** to play back the clip locally. The page does not save this playback clip; it is cleared when you record again or end the conversation.

Talk automatically turns Noor's voice on. The microphone is active only between **Talk** and **Done** (or **Stop**). Automatic end-of-turn detection and always-listening are not used in this version.

Set `CHATTERBOX_PYTHON` in `.env.local` to the full path of a Python executable with the voice packages installed: run `pip install -r requirements-voice.txt`, then `pip install --no-deps -r requirements-voice-nodeps.txt` (Chatterbox's own pins are out of date, so it is installed without them). The Windows default is `../chatterboc-demo/.venv/Scripts/python.exe`; the Linux default is `/opt/noor-venv/bin/python`. On Mac, configure an isolated local environment explicitly. This workspace uses the outer `workbench/voice/.venv/bin/python` and keeps model downloads under `workbench/voice/cache/huggingface` through `HF_HOME`. Keep the virtual-environment executable path; resolving its symlink can bypass the environment. You can set `ASR_PYTHON` separately if speech recognition uses another environment. The server starts loading Chatterbox when it launches, so the first spoken reply waits less if you allow that startup to finish. Later replies reuse the model. Microphone recordings are processed locally for transcription; the transcript is sent to Claude. The audio reference and generated speech are not sent to Claude.

The Hope reference is a 12.5-second ElevenLabs clip converted to mono 24 kHz, 16-bit PCM WAV. The hosted Chatterbox voice sends this clip to Replicate as a data URI with each speech request. The local demo uses it when `NOOR_VOICE_REFERENCE=voice/noor-reference.wav` is set in `.env.local`; restart `node server.mjs` after changing that setting. Chatterbox follows the reference voice and its delivery, though its generated speech may not match the source exactly.

## Agent traces and scenario tests

See [local agent tracing and evaluation](./AGENT-TRACING.md) for private local traces, offline scenario tests, and opt-in live evaluations.

## Local database maintenance

See [database backups, restore checks and migrations](./DATABASES.md). Use `npm run db:backup` from the repository root for a verified snapshot, and `npm run test:database` for recovery and migration tests. The three databases remain separate; confirmed crew requests and reminders still last only for the active local session.

Local speech transport emits metadata-only `speech_stream` server events and `noor-speech-stream` browser events. Correlate `x-noor-speech-id` with terminal done, reader EOF, response finish/close and playback completion. A terminal audio record alone does not prove a clean connection; transport errors remain errors, including failures after the terminal record.

The 2026-10-19 local flight-status browser rerun played all five segments and returned to idle. First audio took 7.4 seconds; the longest inter-segment gap was 9.7 seconds, compared with the earlier 32.8-second observation. These are individual CPU samples, not a latency guarantee.

The same run recorded server `terminal_done` → `response_finish` → `response_close_complete` and browser `terminal_done` → `reader_eof` → `playback_complete`, while CDP still emitted `ERR_ABORTED`. An independent synthetic stream reproduced this without Noor or voice generation. Chromium tracks this fully-read `no-store` reporting bug in [issue 568852319](https://issues.chromium.org/issues/568852319/dupes). Preserve `no-store`; do not buffer the whole reply or ignore real read errors to hide a network-panel warning. A cancelled trace alone is insufficient to classify success: require complete terminal/EOF/playback evidence and clean server completion. Browser patch availability has not been established.

A second independent real Chrome E2E verified background persistence, no greeting replay on Voice on, actual baggage speech, intentional Stop and server cancellation, 58.2 seconds without speech revival, editable input and a 390-pixel viewport without horizontal overflow. Both browser runs used the local CPU worker; hosted performance and deployment were not tested.
