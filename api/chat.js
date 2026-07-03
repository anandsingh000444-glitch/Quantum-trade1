// api/chat.js - Claude x4 → Gemini x3 → Groq → Offline

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

  const nse = context.nseOpen ? 'OPEN (9:15-15:30 IST)' : 'CLOSED';
  const SYS = `You are TradeX Quantum AI — expert institutional trading assistant for Indian & global markets.

LIVE DATA:
NIFTY: ${context.nifty||'N/A'} | BANKNIFTY: ${context.banknifty||'N/A'} | SENSEX: ${context.sensex||'N/A'}
BTC: $${context.btc||'N/A'} | ETH: $${context.eth||'N/A'} | Gold: $${context.gold||'N/A'}
Fear & Greed: ${context.fg||'N/A'}/100 | NSE: ${nse} | Time: ${context.time||'N/A'} IST

EXPERTISE: SMC (FVG, Order Block, BOS, CHOCH, Liquidity Sweep, MSS, IFVG), NIFTY/BANKNIFTY F&O, Options Greeks, PCR, Max Pain, OI Analysis, Crypto, Forex, Risk Management.

EVERY RESPONSE FORMAT:
1. Market Analysis — exact price levels, structure
2. Trade Setup — Entry | SL | TP1 | TP2 | Lot size (1-2% risk rule)
3. Risk Note

Hinglish ok. Max 250 words. Be specific with numbers.`;

  const msgs = [
    ...history.slice(-6).map(m => ({ role: m.role==='ai'?'assistant':'user', content:(m.text||'').slice(0,800) })),
    { role:'user', content: message.slice(0,1500) }
  ];

  // CLAUDE ROTATION
  for (let i = 0; i < CLAUDE.length; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST',
        headers:{'Content-Type':'application/json','x-api-key':CLAUDE[i],'anthropic-version':'2023-06-01'},
        body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:700,system:SYS,messages:msgs}),
        signal:ctrl.signal
      });
      clearTimeout(t);
      if (r.status===429||r.status===401||r.status===403) { console.log(`Claude[${i+1}] skip:${r.status}`); continue; }
      if (r.ok) {
        const d = await r.json();
        const text = d.content?.map(c=>c.text||'').join('');
        if (text) return res.json({text, provider:'claude', key:i+1, status:'ok'});
      }
    } catch(e) { console.log(`Claude[${i+1}] err:${e.message}`); }
  }

  // GEMINI ROTATION
  for (let i = 0; i < GEMINI.length; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const parts = [{text:SYS+'\n\n'},...msgs.map(m=>({text:(m.role==='user'?'User: ':'Assistant: ')+m.content+'\n'}))];
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI[i]}`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({contents:[{parts}],generationConfig:{maxOutputTokens:700,temperature:0.7}}),
        signal:ctrl.signal
      });
      clearTimeout(t);
      if (r.status===429||r.status===400||r.status===403) { console.log(`Gemini[${i+1}] skip:${r.status}`); continue; }
      if (r.ok) {
        const d = await r.json();
        const text = d.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return res.json({text, provider:'gemini', key:i+1, status:'ok'});
      }
    } catch(e) { console.log(`Gemini[${i+1}] err:${e.message}`); }
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
        if (text) return res.json({text, provider:'groq', key:1, status:'ok'});
      }
    } catch(e) { console.log(`Groq err:${e.message}`); }
  }

  return res.status(503).json({error:'All AI providers failed. Check Vercel env vars.', status:'offline'});
}
