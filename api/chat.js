// api/chat.js - Multi-key auto-rotation
// Claude(4 keys) → Gemini(3 keys) → Groq(1 key) → Offline

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { message, history = [], context = {} } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });

  const CLAUDE_KEYS = [
    process.env.ANTHROPIC_API_KEY_1,
    process.env.ANTHROPIC_API_KEY_2,
    process.env.ANTHROPIC_API_KEY_3,
    process.env.ANTHROPIC_API_KEY_4,
  ].filter(Boolean);

  const GEMINI_KEYS = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
  ].filter(Boolean);

  const GROQ_KEY = process.env.GROQ_API_KEY;

  const nse = context.nseOpen ? 'OPEN (9:15-15:30 IST)' : 'CLOSED';
  const SYS = `You are TradeX Quantum AI — institutional trading assistant.

LIVE DATA: NIFTY:${context.nifty||'N/A'} BANKNIFTY:${context.banknifty||'N/A'} SENSEX:${context.sensex||'N/A'} BTC:$${context.btc||'N/A'} ETH:$${context.eth||'N/A'} Gold:$${context.gold||'N/A'} F&G:${context.fg||'N/A'}/100 NSE:${nse} IST:${context.time||'N/A'}

For EVERY reply give:
1. Analysis — exact price levels and market structure
2. Trade Setup — Entry | SL | TP1 | TP2 | Lot size (1-2% risk rule)
3. Risk note

Hinglish ok. Max 250 words. Be specific with numbers.`;

  const msgs = [
    ...history.slice(-6).map(m => ({ role: m.role==='ai'?'assistant':'user', content:(m.text||'').slice(0,800) })),
    { role: 'user', content: message.slice(0,1500) }
  ];

  // CLAUDE ROTATION
  for (let i = 0; i < CLAUDE_KEYS.length; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 18000);
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST',
        headers:{'Content-Type':'application/json','x-api-key':CLAUDE_KEYS[i],'anthropic-version':'2023-06-01'},
        body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:600,system:SYS,messages:msgs}),
        signal:ctrl.signal
      });
      clearTimeout(t);
      if (r.status===429||r.status===401||r.status===403) { console.log(`Claude key${i+1} skip:${r.status}`); continue; }
      if (r.ok) {
        const d = await r.json();
        const text = d.content?.map(c=>c.text||'').join('');
        if (text) return res.json({text, provider:'claude', key:i+1, status:'ok'});
      }
    } catch(e) { console.log(`Claude key${i+1}:${e.message}`); }
  }

  // GEMINI ROTATION
  for (let i = 0; i < GEMINI_KEYS.length; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const parts = [{text:SYS+'\n\n'},...msgs.map(m=>({text:(m.role==='user'?'User: ':'Assistant: ')+m.content+'\n'}))];
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEYS[i]}`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({contents:[{parts}],generationConfig:{maxOutputTokens:600,temperature:0.7}}),
        signal:ctrl.signal
      });
      clearTimeout(t);
      if (r.status===429||r.status===400||r.status===403) { console.log(`Gemini key${i+1} skip:${r.status}`); continue; }
      if (r.ok) {
        const d = await r.json();
        const text = d.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return res.json({text, provider:'gemini', key:i+1, status:'ok'});
      }
    } catch(e) { console.log(`Gemini key${i+1}:${e.message}`); }
  }

  // GROQ FALLBACK
  if (GROQ_KEY) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${GROQ_KEY}`},
        body:JSON.stringify({model:'llama-3.1-8b-instant',max_tokens:600,messages:[{role:'system',content:SYS},...msgs]}),
        signal:ctrl.signal
      });
      clearTimeout(t);
      if (r.ok) {
        const d = await r.json();
        const text = d.choices?.[0]?.message?.content;
        if (text) return res.json({text, provider:'groq', key:1, status:'ok'});
      }
    } catch(e) { console.log(`Groq:${e.message}`); }
  }

  return res.status(503).json({error:'All AI providers failed. Check Vercel env vars.', status:'offline'});
         }
                            
