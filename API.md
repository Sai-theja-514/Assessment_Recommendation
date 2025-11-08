# API — /api/proxy

This document describes the simple HTTP API endpoint used by the frontend to request assessment recommendations from the server proxy.

Base URL
- Local dev (example): http://localhost:3000
- Endpoint path: POST /api/proxy

Purpose
- Accepts a text-based query (or full RAG prompt) from the frontend, forwards it to the LLM (server-side), and returns structured JSON recommendations.
- The proxy keeps API keys on the server, enforces rate-limits, and returns a stable JSON contract the UI can consume.

Request (recommended)
- Method: POST
- Headers:
  - Content-Type: application/json
  - Authorization: Optional — e.g. `Bearer <API_TOKEN>` (server may require this in production)
- Body (example shape used by this project):

```json
{
  "contents": [
    { "parts": [{ "text": "I need a senior Java developer who can collaborate with product and business stakeholders." }] }
  ],
  "systemInstruction": { "parts": [{ "text": "<system prompt controlling the LLM's behavior>" }] }
}
```

Notes
- The frontend builds a small RAG-style prompt and sends it in `contents` plus an optional `systemInstruction` (your `systemPrompt` string).
- Use POST when queries may be long. For simple searches a GET with URL query is possible but not recommended for long prompts.

Responses
1) Preferred (proxy returns parsed recommendations):

- Status: 200 OK
- Body:

```json
{
  "recommendations": [
    {
      "name": "Java (New)",
      "url": "https://www.shl.com/solutions/products/product-catalog/view/java-new/",
      "adaptive_support": "No",
      "description": "Multi-choice test that measures the knowledge of Java programming...",
      "duration": 20,
      "remote_support": "Yes",
      "test_type": ["Knowledge & Skills"]
    }
    // ... 4-9 more items
  ]
}
```

2) Alternate/raw model output (LLM returned text containing JSON array):

- Status: 200 OK
- Body example (LLM raw 'candidates' format):

```json
{
  "candidates": [
    {
      "content": {
        "parts": [
          { "text": "[{\"name\": \"Java (New)\", ...}, {...}]" }
        ]
      }
    }
  ]
}
```

The frontend in this project checks for `recommendations` first, then attempts to parse `candidates[0].content.parts[0].text` as JSON if present.

Error responses
- 400 Bad Request — malformed JSON or missing body.
- 401 Unauthorized / 403 Forbidden — missing/invalid API token (production proxy should check auth).
- 429 Too Many Requests — rate limit exceeded.
- 500 Internal Server Error — server or upstream LLM error.

Client-side examples

Curl (unix / WSL):

```bash
curl -X POST http://localhost:3000/api/proxy \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{ "parts": [{ "text": "I need a mid-level Python dev who can work with analytics teams." }] }],
    "systemInstruction": { "parts": [{ "text": "<system prompt>" }] }
  }'
```

PowerShell (Invoke-RestMethod):

```powershell
$body = @{
  contents = @(@{ parts = @(@{ text = 'I need a senior Java developer who is strong at collaboration.' }) })
  systemInstruction = @{ parts = @(@{ text = '<system prompt>' }) }
} | ConvertTo-Json -Depth 6

Invoke-RestMethod -Uri http://localhost:3000/api/proxy -Method Post -ContentType 'application/json' -Body $body
```

JavaScript (browser / node with fetch):

```javascript
const resp = await fetch('/api/proxy', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: [{ parts: [{ text: 'Senior Java developer, collaboration with business.' }] }],
    systemInstruction: { parts: [{ text: '<system prompt>' }] }
  })
});
const json = await resp.json();
console.log(json);
```

Security & production notes
- Never embed upstream LLM API keys in client-side JavaScript. Keep them on the server.
- Protect the proxy with an API token, per-user auth, or session auth.
- Apply rate limiting (per-IP and per-account) and hard daily/monthly caps to control cost.
- Use HTTPS in production.
- Log requests & costs (but do not log raw sensitive user data or full prompts in permanent logs).

Local dev notes (this repo)
- If the Express server is run with `DEMO_PROXY=1` and no LLM key, it returns canned demo recommendations (useful for offline demo).
- The frontend will fallback to a local recommender (`localRecommend`) if the proxy is unreachable.

Troubleshooting
- If you see `401`/`403`, check `API_TOKEN` / `NO_AUTH` settings in `.env` or server options.
- If push fails with `429` or large delays, add exponential backoff on the client or reduce frequency.

Contact / Ownership
- File maintained in this repo. Update this doc if you change the request/response contract or add new features (pagination, user-scoped tokens, etc.).
