// Express proxy for Gemini API
// Features:
// - Auth via API token (X-API-TOKEN) or disabled in dev via NO_AUTH=1
// - Redis-backed rate limiting and daily counters when REDIS_URL is provided
// - In-memory fallback limiter for local testing
// - Daily request/cost cap via MAX_DAILY_REQUESTS
// - Forwards request to Gemini API and attempts to parse the model candidate text as JSON

require('dotenv').config();
const express = require('express');
// Use global fetch on Node 18+, otherwise fallback to undici
let fetch = globalThis.fetch;
try {
  if (!fetch) fetch = require('undici').fetch;
} catch (e) {
  // fetch may be unavailable; the server will error if fetch is not present
}
const Redis = require('ioredis');
const bodyParser = require('body-parser');
const path = require('path');
const app = express();
app.use(bodyParser.json({ limit: '1mb' }));

// Serve the static frontend (index.html) from project root
app.use(express.static(path.join(__dirname, '..')));

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-09-2025';
const API_TOKEN = process.env.API_TOKEN || null; // token required in header X-API-TOKEN
const NO_AUTH = process.env.NO_AUTH === '1';

// Rate limiting / counters
const REDIS_URL = process.env.REDIS_URL || null;
const MAX_REQUESTS_PER_MIN = parseInt(process.env.MAX_REQUESTS_PER_MIN || '60', 10);
const MAX_DAILY_REQUESTS = parseInt(process.env.MAX_DAILY_REQUESTS || '10000', 10);

let redis = null;
if (REDIS_URL) {
  redis = new Redis(REDIS_URL);
  redis.on('error', (e) => console.error('Redis error', e));
}

// Simple in-memory fallback limiter (only for single-process demos)
const ipMap = new Map();

function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

async function checkRateLimit(clientId) {
  const now = Math.floor(Date.now() / 1000);
  const minuteKey = `rl:${clientId}:${Math.floor(now/60)}`;
  const dayKey = `daily:${clientId}:${new Date().toISOString().slice(0,10)}`;

  if (redis) {
    const minute = await redis.incr(minuteKey);
    if (minute === 1) await redis.expire(minuteKey, 65);
    if (minute > MAX_REQUESTS_PER_MIN) return { ok: false, reason: 'minute_limit' };

    const daily = await redis.incr(dayKey);
    if (daily === 1) await redis.expire(dayKey, 86400 + 60);
    if (daily > MAX_DAILY_REQUESTS) return { ok: false, reason: 'daily_limit' };

    return { ok: true };
  }

  // in-memory
  const nowMin = Math.floor(Date.now()/60000);
  const entry = ipMap.get(clientId) || { minute: nowMin, count: 0, day: new Date().toISOString().slice(0,10), dayCount: 0 };
  if (entry.minute !== nowMin) {
    entry.minute = nowMin; entry.count = 0;
  }
  entry.count += 1; entry.dayCount += 1;
  ipMap.set(clientId, entry);
  if (entry.count > MAX_REQUESTS_PER_MIN) return { ok: false, reason: 'minute_limit' };
  if (entry.dayCount > MAX_DAILY_REQUESTS) return { ok: false, reason: 'daily_limit' };
  return { ok: true };
}

// Auth middleware
app.use(async (req, res, next) => {
  if (NO_AUTH) return next();
  const token = req.headers['x-api-token'];
  if (!API_TOKEN) return res.status(403).json({ error: 'Server misconfigured: API_TOKEN not set' });
  if (!token || token !== API_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  return next();
});

// Proxy endpoint
app.post('/proxy', async (req, res) => {
  // Demo mode: when GEMINI_API_KEY is not configured but DEMO_PROXY=1 is set,
  // return a canned recommendations response so the frontend can demo without the API.
  if (!GEMINI_API_KEY) {
    if (process.env.DEMO_PROXY === '1') {
      const demoRecommendations = [
        {
          name: "Java (New)",
          url: "https://www.shl.com/solutions/products/product-catalog/view/java-new/",
          adaptive_support: "No",
          description: "Multi-choice test that measures the knowledge of Java programming, including core concepts, data structures, and OOP principles.",
          duration: 20,
          remote_support: "Yes",
          test_type: ["Knowledge & Skills"]
        },
        {
          name: "Teamwork & Collaboration (SJT)",
          url: "https://www.shl.com/solutions/products/product-catalog/view/teamwork-collaboration-sjt/",
          adaptive_support: "No",
          description: "A Situational Judgement Test (SJT) that assesses how an individual collaborates in a team environment.",
          duration: 20,
          remote_support: "Yes",
          test_type: ["Biodata & Situational Judgement", "Personality & Behavior"]
        },
        {
          name: "Cognitive Ability (General)",
          url: "https://www.shl.com/solutions/products/product-catalog/view/cognitive-ability-general/",
          adaptive_support: "Yes",
          description: "Measures verbal, numerical, and abstract reasoning. Good for analyst roles.",
          duration: 30,
          remote_support: "Yes",
          test_type: ["Ability & Aptitude"]
        },
        {
          name: "Numerical Reasoning",
          url: "https://www.shl.com/solutions/products/product-catalog/view/numerical-reasoning/",
          adaptive_support: "Yes",
          description: "Assesses the ability to work with and interpret numerical data, such as graphs, charts, and tables.",
          duration: 25,
          remote_support: "Yes",
          test_type: ["Ability & Aptitude"]
        },
        {
          name: "Technology Professional 8.8 Job Focused Assessment",
          url: "https://www.shl.com/solutions/products/product-catalog/view/technology-professional-8-8-job-focused-assessment/",
          adaptive_support: "No",
          description: "The Technology Job Focused Assessment assesses key behavioral attributes required for success in fast-paced roles.",
          duration: 16,
          remote_support: "Yes",
          test_type: ["Competencies", "Personality & Behavior"]
        }
      ];
      return res.json({ recommendations: demoRecommendations });
    }
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
  }

  const client = getClientIp(req);
  const rate = await checkRateLimit(client);
  if (!rate.ok) {
    return res.status(429).json({ error: 'Rate limit exceeded', reason: rate.reason });
  }

  const payload = req.body || {};

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await r.text();
    if (!r.ok) {
      return res.status(r.status).send(text);
    }
    const json = JSON.parse(text);

    // Try to parse candidate content
    const candidate = json.candidates?.[0];
    if (candidate && candidate.content?.parts?.[0]?.text) {
      const t = candidate.content.parts[0].text;
      try {
        const recommendations = JSON.parse(t);
        return res.json({ recommendations });
      } catch (e) {
        // Return raw candidates if parsing fails
        return res.json({ candidates: json.candidates });
      }
    }

    return res.json(json);
  } catch (err) {
    console.error('Proxy error', err);
    return res.status(500).json({ error: 'Proxy internal error' });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Proxy server listening on port ${PORT}`));

// Note: For production you should:
// - Run behind HTTPS and a reverse proxy
// - Use a persistent Redis instance and a stable key for rate limiting
// - Add logging, monitoring and alerting for cost thresholds
// - Optionally compute token usage from responses and stop calls when spend limit reached
