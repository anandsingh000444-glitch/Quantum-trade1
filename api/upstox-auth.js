// File location in your Vercel project: /api/upstox-auth.js
// This exchanges the OAuth "code" (from the login redirect) for a real access_token.
// Your API Secret stays here on the server — never sent to the browser.
//
// SETUP: In Vercel dashboard -> your project -> Settings -> Environment Variables, add:
//   UPSTOX_API_KEY    = your Upstox app's API Key
//   UPSTOX_API_SECRET = your Upstox app's API Secret
//   UPSTOX_REDIRECT_URI = the exact Redirect URL registered on your Upstox app
//     (e.g. https://quantum-trade1.vercel.app/api/upstox-auth)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const code = req.query.code;
  if (!code) {
    return res.status(400).send('Missing ?code= — this endpoint should be hit automatically after Upstox login redirects here.');
  }

  const apiKey = process.env.UPSTOX_API_KEY;
  const apiSecret = process.env.UPSTOX_API_SECRET;
  const redirectUri = process.env.UPSTOX_REDIRECT_URI;

  if (!apiKey || !apiSecret || !redirectUri) {
    return res.status(500).send('Server missing UPSTOX_API_KEY / UPSTOX_API_SECRET / UPSTOX_REDIRECT_URI environment variables.');
  }

  try {
    const params = new URLSearchParams();
    params.append('code', code);
    params.append('client_id', apiKey);
    params.append('client_secret', apiSecret);
    params.append('redirect_uri', redirectUri);
    params.append('grant_type', 'authorization_code');

    const tokenResp = await fetch('https://api.upstox.com/v2/login/authorization/token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const data = await tokenResp.json();

    if (!tokenResp.ok || !data.access_token) {
      return res.status(tokenResp.status).send(
        `<h3>Token exchange failed</h3><pre>${JSON.stringify(data, null, 2)}</pre>`
      );
    }

    // Show the token in a simple page so it can be copied into the calculator.
    return res.status(200).send(`
      <html><body style="font-family:monospace;background:#0A0D10;color:#DCE3E8;padding:30px;">
        <h2 style="color:#22C583;">✓ Access token generated</h2>
        <p>Ye token aaj raat tak valid hai. Isse copy karke calculator ke "Upstox Access Token" field mein paste karo.</p>
        <textarea style="width:100%;height:100px;background:#171C22;color:#E8A83C;border:1px solid #333;padding:10px;">${data.access_token}</textarea>
      </body></html>
    `);
  } catch (err) {
    return res.status(500).send('Error: ' + String(err));
  }
}
