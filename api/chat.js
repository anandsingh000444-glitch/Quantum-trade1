export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { message, history = [], context = {} } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });

  const CLAUDE = [
    process.env.ANTHROPIC_API_KEY_1,
    process.env.ANTHROPIC_API_KEY_2,
    process.env.ANTHROPIC_API_KEY_3,
    process.env.ANTHROPIC_API_KEY_4,
  ].filter(Boolean);

  const GEMINI = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
  ].filter(Boolean);

  const GROQ = process.env.GROQ_API_KEY;

  const SYS = `You are TradeX Quantum AI — expert institutional trading assistant.

LIVE DATA: NIFTY:${context.nifty||'N/A'} BANKNIFTY:${context.banknifty||'N/A'} SENSEX:${context.sensex||'N/A'} BTC:$${context.btc||'N/A'} GOLD:$${context.gold||'N/A'} SILVER:$${context.silver||'N/A'} F&G:${context.fg||'N/A'}/100 NSE:${context.nseOpen?'OPEN':'CLOSED'} IST:${context.time||'N/A'}

EXPERTISE: SMC (FVG, Order Block, BOS, CHOCH, Liquidity), NIFTY/BANKNIFTY F&O, Options Greeks, PCR, Max Pain, Crypto, Gold/Silver, Forex, Risk Management.

EVERY REPLY:
1. Analysis — exact price levels
2. Trade Setup — Entry | SL | TP1 | TP2 | Lot size (1-2% risk)
3. Risk Note

Hinglish ok. Max 250 words.`;

  const msgs = [
    ...history.slice(-6).map(m => ({ role: m.role==='ai'?'assistant':'user', content:(m.text||'').slice(0,800) })),
    { role:'user', content: message.slice(0,1500) }
  ];

  // CLAUDE ROTATION
  for (const key of CLAUDE) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST',
        headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},
        body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:700,system:SYS,messages:msgs}),
        signal:ctrl.signal
      });
      clearTimeout(t);
      if (r.status===429||r.status===401||r.status===403) { console.log('Claude skip:',r.status); continue; }
      if (r.ok) {
        const d = await r.json();
        const text = d.content?.map(c=>c.text||'').join('');
        if (text) return res.json({text, provider:'claude', status:'ok'});
      }
    } catch(e) { console.log('Claude err:',e.message); }
  }

  // GEMINI ROTATION
  for (const key of GEMINI) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const parts = [{text:SYS+'\n\n'},...msgs.map(m=>({text:(m.role==='user'?'User: ':'Assistant: ')+m.content+'\n'}))];
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,{
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({contents:[{parts}],generationConfig:{maxOutputTokens:700}}),
        signal:ctrl.signal
      });
      clearTimeout(t);
      if (r.status===429||r.status===400||r.status===403) { console.log('Gemini skip:',r.status); continue; }
      if (r.ok) {
        const d = await r.json();
        const text = d.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return res.json({text, provider:'gemini', status:'ok'});
      }
    } catch(e) { console.log('Gemini err:',e.message); }
  }

  // GROQ
  if (GROQ) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${GROQ}`},
        body:JSON.stringify({model:'llama-3.1-8b-instant',max_tokens:700,messages:[{role:'system',content:SYS},...msgs]}),
        signal:ctrl.signal
      });
      clearTimeout(t);
      if (r.ok) {
        const d = await r.json();
        const text = d.choices?.[0]?.message?.content;
        if (text) return res.json({text, provider:'groq', status:'ok'});
      }
    } catch(e) { console.log('Groq err:',e.message); }
  }

  return res.status(503).json({error:'All AI providers failed. Check Vercel env vars.', status:'offline'});
}
