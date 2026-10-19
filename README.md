# Noor Sultana

A visual-novel-style in-flight assistant demo, with original character artwork and product notes.

## Assets

The `assets/` folder contains the master character sheet, turnaround, facial feature and expression sheets, acting poses, outfit details, color palette, and character consistency guide.

## Documents

The `Documents/` folder contains the Noor assistant PRD summary and a link to the source Google Doc.

## Prototype

The passenger demo uses Claude to answer questions about a fictional Cloudline Air flight from New York to Tokyo. A separate read-only Open-Meteo lookup supplies real public weather near JFK and Tokyo Haneda. Noor can also schedule a fixed arrival email to a verified passenger address when Resend is configured. The local demo now renders the native Live2D blink rig in the existing cabin scene. Static welcoming and thoughtful poses remain the loading/error fallback.

Follow the [setup instructions](prototype/README.md) to add your Anthropic key and start the local server. Open `http://127.0.0.1:4173` to chat; opening the HTML file directly does not connect to the server. The demo does not access live airline services, and its flight details are fictional.

## Local animated avatar

The loopback passenger demo at `http://127.0.0.1:4173/flight-demo.html` loads the same versioned application runtime as the deployed site from `prototype/live2d/noor-v6/`. `prototype/avatar.js` controls the native V6 rig: blinking, one mouth-open shape, small head tilt, brows, horizontal gaze, restrained body sway and a modest arm gesture. Conversation states ease between verified native poses. The speech controller measures Noor's output audio and resets the mouth when playback stops. Reduced-motion settings neutralize optional poses and automatic blinking while retaining speech-mouth movement. The PNG returns if assets or WebGL fail.

The fixed V6 application bundle is authorized for public Noor delivery and includes required Live2D notices. The build verifies every runtime asset and fails if files are missing or changed. Editable rigs, the raw SDK and historical `live2d-local/` exports remain private. Live2D license terms still apply. See [the prototype guide](prototype/README.md#live2d-avatar) for the current limits.

## Launch preparation

The prototype now includes public-origin and secure-cookie settings, per-browser and overall daily usage limits, structured request and Claude token logs, a health check, and retention cleanup. See [the prototype guide](prototype/README.md) for settings and privacy limits. The root [Dockerfile](Dockerfile) prepares a Linux server image; the [Supabase migration](supabase/migrations/20261011_noor_foundation.sql) and [daily cleanup job](supabase/cron.sql) are ready for a future project connection. The live app still uses one local SQLite-backed server until that connection is built and tested.

## Local artwork workspace

The enclosing local Noor-Sultana folder holds artwork, planning and authoring tools. The user accepted `../artwork/working/noor-likeness-v10b-materials.kra` for animation. The local native V6 rig has verified two-eye blinking, a single mouth-open shape, head tilts, brows, horizontal gaze and a modest left-arm gesture. Speaking uses timed gestures and holds; thinking uses the retained static hand-to-chin drawing. Phoneme mouth shapes and larger arm poses remain unfinished. The fixed V6 runtime is included in Git and hosted builds; private editable rigs and authoring tools remain outside the repository. See the local [project plan](../planning/PROJECT-PLAN.md), [workspace instructions](../AGENTS.md), and [file inventory](../planning/FILES.md). These local workspace links are not part of the remote repository.
