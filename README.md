# Noor Sultana

A visual-novel-style in-flight assistant demo, with original character artwork and product notes.

## Assets

The `assets/` folder contains the master character sheet, turnaround, facial feature and expression sheets, acting poses, outfit details, color palette, and character consistency guide.

## Documents

The `Documents/` folder contains the Noor assistant PRD summary and a link to the source Google Doc.

## Prototype

The passenger demo uses Claude to answer questions about a fictional Cloudline Air flight from New York to Tokyo. A separate read-only Open-Meteo lookup supplies real public weather near JFK and Tokyo Haneda. Noor can also schedule a fixed arrival email to a verified passenger address when Resend is configured. Noor switches between welcoming and thoughtful poses in an airplane cabin scene.

Follow the [setup instructions](prototype/README.md) to add your Anthropic key and start the local server. Open `http://127.0.0.1:4173` to chat; opening the HTML file directly does not connect to the server. The demo does not access live airline services, and its flight details are fictional.
