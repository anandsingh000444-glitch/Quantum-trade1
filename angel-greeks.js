// File location in your Vercel project: /api/angel-greeks.js
// This runs on Vercel's server, so Angel One's CORS rules don't apply to it —
// only the browser-to-broker call was blocked, not server-to-broker.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { jwt, apiKey, name, expirydate, publicIp } = req.query;

  if (!jwt || !apiKey || !name || !expirydate) {
    return res.status(400).json({ error: 'Missing jwt, apiKey, name, or expirydate query param' });
  }

  try {
    const upstreamResp = await fetch('https://apiconnect.angelone.in/rest/secure/angelbroking/marketData/v1/optionGreek', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${jwt}`,
        'X-PrivateKey': apiKey,
        'X-UserType': 'USER',
        'X-SourceID': 'WEB',
        'X-ClientLocalIP': '127.0.0.1',
        'X-ClientPublicIP': publicIp || '106.51.1.1',
        'X-MACAddress': '00:00:00:00:00:00'
      },
      body: JSON.stringify({ name, expirydate })
    });
    const data = await upstreamResp.json();
    return res.status(upstreamResp.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
