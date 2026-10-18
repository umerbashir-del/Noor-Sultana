# FR24 sandbox demo

Sign in at https://fr24api.flightradar24.com/ and open Key management to find the sandbox API key. Add FR24_SANDBOX_API_KEY to prototype/.env.local, then restart the local server. For Vercel, set the same server environment variable and redeploy. Never use a production token for this demo.

Ask: Where is my flight? or Track the demo flight. The server retrieves a fixed sample and displays its actual flight identifier and sample timestamp. Sandbox filters are ignored, so this never represents fictional CL 204 or a requested real flight. No Claude call is needed for this structured reply. Weather requests retain their existing route.

Reference: https://fr24api.flightradar24.com/docs/sandbox-environment
