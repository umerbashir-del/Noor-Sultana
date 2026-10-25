# Noor Sultana

https://github.com/user-attachments/assets/e901922e-e6fd-4516-af0b-4cc5f502c279

**60-second demo** ([download the 1080p file](media/noor-demo.mp4)): Noor answers four passenger questions on the seat-back screen of a fictional flight (CL 204, New York JFK → Tokyo Haneda). Every answer shown is the real local app; flight details and the crew request are demo data.

A visual-novel-style in-flight assistant demo, with original character artwork.

## Assets

The `assets/` folder contains the master character sheet, turnaround, facial feature and expression sheets, acting poses, outfit details, color palette, and character consistency guide.

## Passenger knowledge

The `Documents/knowledge/` folder contains the allowlisted passenger guidance used by the application.

## Selected journeys

Explore destinations → See journeys → View journey → Meet Noor. The four sample JFK journeys are Tokyo (Nov 12), Paris (Nov 24), Dubai (Dec 4), and Rome (Dec 18), 2026. [journeys.mjs](prototype/journeys.mjs) supplies the display, model context and tools from one server-validated record.

## Prototype

The passenger demo uses Claude to answer questions about the selected fictional Noor International Airlines journey from JFK to Tokyo, Paris, Dubai, or Rome. A separate read-only Open-Meteo lookup supplies model weather for the selected airports or a named city. Arrival forecasts may be outside the provider window. Noor can also schedule a fixed arrival email to a verified passenger address when Resend is configured. The local demo now renders the native Live2D blink rig in the existing cabin scene. Static welcoming and thoughtful poses remain the loading/error fallback.

Follow the [setup instructions](prototype/README.md) to add your Anthropic key and start the local server. Open `http://127.0.0.1:4173` to chat; opening the HTML file directly does not connect to the server. The demo does not access live airline services, and its flight details are fictional.

## Local animated avatar

The loopback passenger demo loads the approved versioned model from `prototype/live2d/noor-v7/`. `prototype/avatar.js` combines native blink, gaze, smiling lids, mouth form, bounded head movement, breathing and restrained hair/scarf physics. The continuous idle uses the choreography approved on October 25. Conversation expressions remain native, including thoughtful; static PNG artwork is reserved for loading or runtime failure. Output audio drives mouth opening and resets it when playback stops. Reduced motion neutralizes optional motion and physics while retaining speech-mouth movement.

The build verifies the full runtime inventory, hashes, model/physics references and module imports. V6 remains in source for rollback; only V7 is packaged in fresh generated output. Editable rigs and the raw SDK remain private. Required Live2D notices are retained. This local integration does not imply that the deployed site has been updated. See [the prototype guide](prototype/README.md#live2d-avatar).

## Launch preparation

The prototype now includes public-origin and secure-cookie settings, per-browser and overall daily usage limits, structured request and Claude token logs, a health check, and retention cleanup. See [the prototype guide](prototype/README.md) for settings and privacy limits. The root [Dockerfile](Dockerfile) prepares a Linux server image; the [Supabase migration](supabase/migrations/20261011_noor_foundation.sql) and [daily cleanup job](supabase/cron.sql) are ready for a future project connection. The local server uses in-process conversation context and SQLite for local application tasks. Hosted chat uses Supabase-backed sessions and messages; provider availability and deployed behavior require separate verification.

## Tests

Run `npm test` for offline regression checks across local and hosted handlers, journey isolation, tool grounding, spending limits, voice controls, storage and avatar packaging. Run `npm run build` to verify the public bundle. Provider responses and hosted storage use test doubles; these checks do not establish live service or deployed behavior.
