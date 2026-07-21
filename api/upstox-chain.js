// File location in your Vercel project: /api/upstox-chain.js
// This runs on Vercel's server, so Upstox's CORS rules don't apply to it —
// only the browser-to-broker call was blocked, not server-to-broker.

export default async function handler(req, res) {
  // Allow the browser (your calculator page) to call this endpoint from anywhere
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { token, instrument_key, expiry_date } = req.query;

  if (!token || !instrument_key || !expiry_date) {
    return res.status(400).json({ error: 'Missing token, instrument_key, or expiry_date query param' });
  }

  try {
    const url = `https://api.upstox.com/v2/option/chain?instrument_key=${encodeURIComponent(instrument_key)}&expiry_date=${encodeURIComponent(expiry_date)}`;
    const upstreamResp = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await upstreamResp.json();
    return res.status(upstreamResp.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
