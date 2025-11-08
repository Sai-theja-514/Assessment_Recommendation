SHL Assessment Recommendation - Vercel Proxy + Local Fallback

What I added
- `api/proxy.js` - a minimal Vercel-compatible serverless function that forwards requests to the Gemini API using an environment variable `GEMINI_API_KEY`. Includes a simple in-memory per-IP rate limiter for demos.
- Updated `index.html` - the client now POSTs the RAG payload to `/api/proxy` and will gracefully fall back to a local recommender (no external API calls) if the proxy is not configured or fails.

Why
- Never put production API keys in client-side code. The proxy keeps the key secret and centralizes quota/cost controls.
- The local fallback lets you demo the UI without any external API usage or keys.

Quick deploy (Vercel) - PowerShell
1. Install Vercel CLI (optional) and login:

```powershell
npm i -g vercel
vercel login
```

2. From the project root (`f:\SHL`) deploy the site. Vercel will detect the `api/` folder and deploy functions:

```powershell
cd f:\SHL
vercel --prod
```

3. Add environment variables in the Vercel dashboard or via CLI. At minimum set the API key and optionally model:

```powershell
vercel env add GEMINI_API_KEY production
vercel env add GEMINI_MODEL production
```

When prompted, paste your Gemini API key. Recommended model: `gemini-2.5-flash` or `gemini-2.5-flash-lite` for cost efficiency.

Security & production notes
- Do NOT add a production API key directly to `index.html`.
- Replace the in-memory rate limiter with a persistent store (Redis) for production.
- Add authentication (JWT/session) on the proxy to identify callers and enforce per-user quotas.
- Add logging, alerts, and a hard spend-limit that will stop the proxy if costs grow unexpectedly.

Local testing
- You can test the proxy locally with `vercel dev` or `npx vercel dev` after setting local env vars with `vercel env pull` or by setting them in your shell.

Express server (alternative to serverless proxy)
1. The `server/` folder contains an Express-based proxy if you prefer an always-on service (good for more control and easier integration with Redis).

2. To run locally:

```powershell
cd f:\SHL\server
npm install
# create a .env file (or copy .env.example)
# set GEMINI_API_KEY and API_TOKEN (or set NO_AUTH=1 for local testing without auth)
node index.js
```

3. To run the test harness (after starting the server or against a deployed URL):

```powershell
cd f:\SHL\server
# set PROXY_URL if the server is remote
setx PROXY_URL "http://127.0.0.1:3000/proxy"
setx API_TOKEN "your_token_here"
npm run test
```

Production hardening notes
- Use a managed Redis (or other durable store) for rate limiting and daily counters; the Express server will use REDIS_URL when provided.
- Use `API_TOKEN` for simple auth; for multi-user systems issue per-user short-lived tokens and require authentication on the static site.
- Implement a cost budget monitor that sums estimated tokens (or counts requests) and disables the proxy when a MAX_SPEND or MAX_DAILY_REQUESTS threshold is reached.
- Replace the local in-memory state with persistent stores and ensure the server is deployed in a multi-instance aware way.
- Use a deployment provider that supports environment variables and secrets (Vercel, Render, Cloud Run, or similar). If deploying Express to Vercel you can use the "Serverless Functions" approach or deploy the Express server on Render / Heroku / Cloud Run for an always-on process.

If you want, I can:
- Create a small Redis-backed example using Docker Compose for local testing.
- Add a small admin endpoint to read current counters and flip the proxy off when spending limit is reached.
- Create CI steps to run the test-harness automatically in GitHub Actions.

Questions / next steps
- I can wire a simple Node Express server instead of a serverless function if you prefer an always-on service (good for more control).
- I can add a small auth token mechanism so the browser must include a short-lived token to call the proxy.
- I can replace the in-memory rate limiter with an example Redis-backed limiter.

