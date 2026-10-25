# Noor flight assistant demo

## Journey selection

Browse/filter journeys, view a journey, then select Meet Noor. [journeys.mjs](journeys.mjs) owns all four fictional schedules and server-validated IDs. Direct chat links without a supported journey return to selection. Each journey starts separate conversation context; tools use that journey and report unavailable for missing route-specific data.

Run `npm test` from the repository root for the offline regression suite. Run `npm run build` to verify the public bundle. Tests use controlled provider and hosted-storage responses; live service and deployment checks are separate.

Current voice controls use one microphone button: click to start dictation and again to finish, review/edit the transcript, then Send. Settings controls spoken replies. There is no live voice mode.

Local chat context is held in memory; hosted chat uses Supabase-backed sessions/messages and existing retention rules. Existing local task data uses SQLite. The dated setup notes below must not be read as a claim that hosted messages never persist.

This is a small prototype with offline launch safeguards. The home page offers four fictional sample trips and a filterable destination carousel. The passenger demo is at `/flight-demo.html?journey=tokyo` (or `paris`, `dubai`, `rome`); it uses the selected fictional Noor International Airlines journey details and sends general passenger chat to Claude. The trip examples have no booking or payment connection. It can check current model weather for a named city or near the selected destination airport and JFK through Open-Meteo, but it does not check real flight, airport-operation, or cabin-service data.

Passenger shortcuts include **Boarding time**, **Baggage guidance**, **Weather availability**, and **Arrival note**. The boarding time is fictional, baggage guidance comes from a draft knowledge page, and the fixed arrival note is general demo guidance. These shortcuts appear alongside selected-destination weather, weather elsewhere, and the arrival email draft.

## Live2D avatar

Choose a journey on the homepage, or open `/flight-demo.html?journey=tokyo` on the loopback server. The approved V7 model retains the existing frame and design. It provides native blink, bounded gaze/head movement, smiling lids, mouth form, breathing and restrained hair/scarf physics. Audio drives mouth opening independently of facial form. The approved continuous idle remains active beyond its first cycle. Thoughtful uses a native expression; PNG artwork is reserved for loading and runtime failure. There is no browser vertex correction.

`avatar-pose.mjs` owns state expressions and the active-page idle clock. Blink owns eye opening; audio owns mouth opening; the physics controller owns only `ParamHairFront`, `ParamHairBack` and `ParamScarfSway`. Physics runs after input writers and before the model update. Long frame deltas are bounded; visibility recovery restarts the clock/stabilizes physics without replaying hidden time. Reduced motion neutralizes optional poses, automatic blinking and physics, while retaining speech-mouth movement.

The full asset inventory and verification identities are in `live2d/noor-v7/manifest.json`. Controls require the loaded MOC's exact SHA-256, valid native ranges/keyforms and measured finite vertex movement. Physics requires the approved referenced bytes and declared output ownership. A failed required V7 gate retains the static fallback and chat instead of presenting a partially working approved rig. `window.noorAvatar` exposes read-only capabilities, gate results and sampled parameter values for diagnostics.

The build validates hashes, model/physics references and module imports, and excludes editable rigs and raw SDK material. V6 remains in source for rollback; a fresh `public/` build contains the active V7 runtime only. Required Live2D notices remain bundled. No deployment is implied by local integration or build success. Large 3D turns, flexible cloth, phoneme visemes and a rigged hand-to-chin pose are outside this model's accepted scope.

## Passenger knowledge

For common passenger questions, the server searches the seven local [draft knowledge pages](../Documents/knowledge/README.md) and sends one matching excerpt to Claude. Noor's answer shows a link to the draft page. The pages offer general next steps only; they are not approved Noor International Airlines policy. Noor should say when an allowance, deadline, entitlement, booking detail, or live status cannot be verified. The document search uses a small defined set of question topics and may miss other wording. Weather questions use the separate weather lookup.

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

Click **Tokyo weather now** or **Weather at sample arrival** to ask Noor and see a read-only weather card. **Weather elsewhere** fills in an example question; replace the selected city with another place. You can also type or say a question such as “What is the current weather in Paris, France?” The server resolves a named city through Open-Meteo geocoding, checks its current model conditions, and passes only those facts and the question to Claude for a short reply. If the name is ambiguous, Noor asks for a state or country. If Claude is not connected or cannot answer, Noor uses a factual server-written reply. The server calls only the fixed Open-Meteo geocoding and forecast hosts; a passenger cannot supply an arbitrary URL. Future forecasts use the selected journey’s arrival.

The selected journey’s arrival instant and destination timezone come from `journeys.mjs`. Its forecast is available only while that time is in the future and within the provider's forecast window. The card shows the forecast time and when the data was retrieved. If weather is unavailable, Noor reports that instead of inventing conditions. Weather is for passenger information, not aircraft operating decisions. Flight details remain fictional.

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

The repository root has a `Dockerfile` that installs Node, Python, Chatterbox, and faster-whisper, and copies the allowlisted passenger knowledge pages. Build it from the `Noor Sultana` folder, set `PUBLIC_ORIGIN` and secrets as hosting environment variables, and mount persistent storage at `/app/data`. `/healthz` is the health-check path. The image installs the voice packages pinned in `requirements-voice.txt` and `requirements-voice-nodeps.txt`, which were tested on Python 3.12; the image uses Debian's Python 3.11 and has not been built with these versions yet. Voice speed and GPU support must be measured on the chosen Linux host. Building the image downloads dependencies and models.

`../supabase/migrations/20261011_noor_foundation.sql` prepares private-by-policy email and usage tables plus a deletion function. Enable Supabase Cron and apply `../supabase/cron.sql` to run that function daily. **The live app still uses SQLite.** Moving the email scheduler and usage ledger to Supabase requires an adapter, actual project credentials, and migration tests; do not add multiple app instances before that work is complete. Keep the Supabase secret key server-side.

## Noor’s voice

The local Node server now uses Replicate by default: Chatterbox Turbo for Noor’s spoken replies and the pinned Whisper model for dictation. Add `REPLICATE_API_TOKEN` to the ignored `prototype/.env.local` and restart the server. The token stays server-side. No Python installation, local model download, Supabase credential, or deployment is needed for the local preview. The account owner must authorize billing and provide the token securely. Missing configuration disables speech availability; text chat remains available.

Click the microphone to record and click it again to finish. Replicate transcribes the recording, the words appear for review, and Send asks Claude to answer. Starting dictation enables spoken replies when available. Settings controls voice playback. There is no always-listening or live conversation mode. The hosted build retains its browser recognition fallback when server transcription is unavailable; the local preview requires configured server transcription.

Local cloud speech requires an active session, the exact current assistant reply, and the existing daily/request limits. It streams at most three sentence segments as NDJSON within a 50-second request budget, plus bounded cleanup. Stop, a new question, session end, or disconnect cancel pending work. Known Replicate predictions are cancelled with bounded cleanup; `cancel-after` limits uncertain create outcomes. No automatic paid inference retries occur. Generated audio is downloaded only from Replicate’s delivery hosts, size-limited and validated as browser-compatible WAV before playback. Mouth opening follows actual playback and resets when playback stops. None of this establishes live provider, microphone, or audible acceptance without a separate real test.

The fixed reference `voice/noor-reference.wav` is sent to Replicate for voice conditioning. Reply text and microphone recordings also go to Replicate; sent transcripts go to Claude. Audio is processed in memory, not saved by the local server. Review each provider’s retention separately. Local conversation context stays in memory; the usage ledger stores counts and tokens. Hosted Vercel handlers retain their separate Supabase authorization and quota enforcement. Local changes do not repair or update a remote deployment.

The old Python worker code is retained for history and explicit legacy operation (`NOOR_SPEECH_PROVIDER=local`); the default server never starts or warms it. Do not reinstall the retired environment to fix the Replicate path. Historical Docker/local CPU measurements are not evidence of the current cloud path.

## Talk to Noor

1. Click the **microphone** and allow the browser to use your microphone. If more than one microphone is available, select the intended one below the controls. Noor uses automatic gain control while recording; browser echo cancellation and noise suppression are off so quiet speech is less likely to be removed.
2. Ask a question, then click the **microphone again**. Replicate Whisper transcribes the recording in the default local configuration. The hosted site uses its own configured Replicate connection, with browser recognition as its existing fallback. The words appear in the message box for review. Recording also stops after 30 seconds.
3. Check and edit the transcript, then click **Send** for Noor to answer and speak. Click the **microphone** to record again, or edit the text to discard it. Turn Voice off in Settings to stop speech playback, or end the conversation to clear it. You can still type and send a question normally.

If transcription cannot hear you, click **Check recording** to play back the clip locally. The page does not save this playback clip; it is cleared when you record again or end the conversation.

Starting dictation automatically turns Noor's voice on when speech output is available. The microphone is active only between the first and second microphone clicks. Automatic end-of-turn detection and always-listening are not used in this version.

The fixed reference is a 12.5-second voice clip converted to mono 24 kHz, 16-bit PCM WAV. Replicate Chatterbox uses it for conditioning. Generated speech may not exactly match the reference. The legacy Python worker remains available only when explicitly selected; it is not required for this setup.

## Agent traces and scenario tests

See [local agent tracing and evaluation](./AGENT-TRACING.md) for private local traces, offline scenario tests, and opt-in live evaluations.

## Local database maintenance

See [database backups, restore checks and migrations](./DATABASES.md). Use `npm run db:backup` from the repository root for a verified snapshot, and `npm run test:database` for recovery and migration tests. The three databases remain separate; confirmed crew requests and reminders still last only for the active local session.

Local speech transport emits metadata-only `speech_stream` server events and `noor-speech-stream` browser events. Correlate `x-noor-speech-id` with terminal done, reader EOF, response finish/close and playback completion. A terminal audio record alone does not prove a clean connection; transport errors remain errors, including failures after the terminal record.

For speech transport diagnostics, require terminal audio, reader EOF and playback completion together with clean server completion. A terminal audio record alone cannot prove success. Preserve `no-store` and report actual read errors.
