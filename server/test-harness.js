// Simple test harness to call the local Express proxy and print the response
const fetch = globalThis.fetch || require('node-fetch');

async function run() {
  const url = process.env.PROXY_URL || 'http://127.0.0.1:3000/proxy';
  const token = process.env.API_TOKEN || '';

  const samplePayload = {
    contents: [{ parts: [{ text: 'Here is the product catalog: []\n\nHere is the user query:\n"Test query"\n\nReturn JSON array.' }] }],
    systemInstruction: { parts: [{ text: 'Return ONLY a JSON array' }] }
  };

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'X-API-TOKEN': token } : {})
      },
      body: JSON.stringify(samplePayload)
    });
    const text = await r.text();
    console.log('Status:', r.status);
    console.log('Response:', text);
  } catch (err) {
    console.error('Error calling proxy:', err);
  }
}

run();
