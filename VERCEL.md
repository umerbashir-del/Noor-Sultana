# Noor on Vercel

The root `vercel.json` builds the existing prototype interface into `public/` and deploys a small request-based API. This Vercel preview supports text chat with Claude, current JFK/Tokyo weather, the sample arrival forecast while it remains in the future, and the seven draft passenger guidance pages.

The Vercel app needs two **Secret** environment variables in both Preview and Production: `NOOR_SESSION_SECRET` (32 random bytes encoded as 64 hex characters) and `ANTHROPIC_API_KEY`. An optional `ANTHROPIC_MODEL` selects the Claude model. Configure secrets in Vercel; never commit them. Redeploy after changing environment variables.

Sessions and up to three recent exchanges are encrypted in an HttpOnly cookie. They expire after 15 minutes idle or two hours total. This provides limited demo conversation context without a database. The per-conversation question limit is not a global spending limit because a visitor can start a new conversation. Keep the deployment protected and set an Anthropic workspace spending cap before sharing it broadly. Durable sessions and usage limits require a shared store such as Supabase.

This Vercel preview intentionally hides the Chatterbox voice, microphone transcription, and scheduled email controls. The main local/server Docker build still contains those features. Vercel functions do not keep the Python workers or SQLite email scheduler running between requests. Do not present the fixed email note as sent or scheduled.

Run `npm run build` and `npm run test:vercel` from the repository root to check the Vercel build and API flow locally. The generated `public/` directory is ignored by Git.
