// Vercel serverless function to proxy Gemini requests securely.
// - Reads GEMINI_API_KEY and optional GEMINI_MODEL from environment variables
// - Accepts POST requests with the same payload shape the frontend previously used
// - Forwards the request to the Gemini API and attempts to parse the model output JSON
// - Implements a simple in-memory rate limiter per-IP (small projects / demo only)

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 60;
const ipCounters = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method Not Allowed');
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(403).json({ error: 'GEMINI_API_KEY not configured on server. Please set the environment variable.' });
  }

  // Basic per-IP rate limiting (in-memory). Good for demos; replace with a persistent store for production.
  const forwardedFor = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const ip = String(forwardedFor).split(',')[0].trim();
  const now = Date.now();
  const entry = ipCounters.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_LIMIT_WINDOW_MS) {
    entry.count = 0;
    entry.start = now;
  }
  entry.count += 1;
  ipCounters.set(ip, entry);
  if (entry.count > MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({ error: 'Rate limit exceeded. Try again later.' });
  }

  // Build target URL
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-09-2025';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  let body = req.body;
  // If body is empty, try to read raw JSON (some platforms may not parse automatically)
  if (!body || Object.keys(body).length === 0) {
    try {
      body = JSON.parse(req.rawBody || '{}');
    } catch (e) {
      // leave body as-is
    }
  }

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const text = await r.text();
    if (!r.ok) {
      // Forward error text
      return res.status(r.status).send(text);
    }

    const json = JSON.parse(text);

    // Try to extract and parse the model's first candidate text as JSON recommendations
    const candidate = json.candidates?.[0];
    if (candidate && candidate.content?.parts?.[0]?.text) {
      const textPart = candidate.content.parts[0].text;
      try {
        const recommendations = JSON.parse(textPart);
        return res.status(200).json({ recommendations });
      } catch (parseError) {
        // Return the raw model response for debugging
        return res.status(200).json({ candidates: json.candidates });
      }
    }

    // If structure is unexpected, return full JSON
    return res.status(200).json(json);

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: 'Proxy encountered an internal error.' });
  }
}

// Note: This serverless file is intended for Vercel/Netlify-style serverless functions.
// For production use:
// - Store GEMINI_API_KEY in the platform's environment variables (Vercel dashboard, Netlify, etc.)
// - Replace the in-memory rate limiter with a persistent/shared store (Redis, etc.)
// - Add authentication, request auditing, and cost-controls to prevent runaway usage.
