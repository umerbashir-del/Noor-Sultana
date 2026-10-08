# Noor flight assistant demo

This is a small local prototype. It uses fictional Cloudline Air CL 204 flight details and sends passenger chat to Claude. It does not check real flight, airport, weather, or cabin-service data.

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
