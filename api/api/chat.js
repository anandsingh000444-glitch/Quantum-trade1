// QUANTUM AI - Chat API using centralized router
// Phase 4: Full market context injection

export const config = { runtime: 'nodejs' };

const AGENTS = {
  market:  { name:'Market Analyst',   task:'smart',   focus:'SMC, FVG, OB, BOS, CHOCH, VWAP, Volume' },
  options: { name:'Options Analyst',  task:'options', focus:'Greeks, PCR, Max Pain, IV, OI, Straddle, Strangle' },
  risk:    { name:'Risk Manager',     task:'fast',    focus:'1-2% risk rule, position sizing, SL/TP' },
  news:    { name:'News Analyst',     task:'news',    focus:'Market news, FII/DII, economic events, sentiment' },
  code:    { name:'Coding Assistant', task:'code',    focus:'Trading algorithms, Pine Script, Python, APIs' },
  general: { name:'TradeX AI',        task:'smart',   focus:'All trading topics, market analysis' }
};

function detectAgent(msg) {
  const m = msg.toLowerCase();
  if (/option|chain|pcr|iv|greek|delta|gamma|theta|vega|pe|ce|straddle/.test(m)) return 'options';
  if (/risk|position size|lot|1%|2%|stop loss|capital/.test(m)) return 'risk';
  if (/news|rbi|fed|fii|dii|inflation|gdp|nfp|fomc/.test(m)) return 'news';
  if (/code|script|pine|python|function|algorithm|implement/.test(m)) return 'code';
  if (/fvg|ob|bos|choch|smc|ict|vwap|liquidity|structure/.test(m)) return 'market';
  return 'general';
}

function buildSystem(ctx, agent) {
  const nse = ctx.nseOpen ? 'OPEN (9:15-15:30 IST)' : 'CLOSED';
  return `You are ${agent.name} — TradeX Quantum AI institutional trading system.

LIVE MARKET DATA (injected automatically):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NIFTY:      ${ctx.nifty||'N/A'} (${ctx.niftyChg||'0'}%)
BANKNIFTY:  ${ctx.banknifty||'N/A'} (${ctx.bankniftyChg||'0'}%)
SENSEX:     ${ctx.sensex||'N/A'}
FINNIFTY:   ${ctx.finnifty||'N/A'}
BTC:        $${ctx.btc||'N/A'} (${ctx.btcChg||'0'}%)
ETH:        $${ctx.eth||'N/A'}
GOLD:       $${ctx.gold||'N/A'}
SILVER:     $${ctx.silver||'N/A'}
Fear&Greed: ${ctx.fg||'N/A'}/100
NSE Market: ${nse}
IST Time:   ${ctx.time||'N/A'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

YOUR SPECIALIZATION: ${agent.focus}

MANDATORY RESPONSE FORMAT:
1. MARKET CONTEXT — what prices say right now
2. ANALYSIS — structure, levels, bias
3. TRADE SETUP:
   • Entry: [exact price]
   • Stop Loss: [exact price]
   • Target 1: [exact price]
   • Target 2: [exact price]
   • Lot Size: [based on 1-2% risk]
   • Risk:Reward: [ratio]
4. CONFIDENCE: [X]%
5. INVALIDATION: [what cancels this setup]

Hinglish ok. Be precise. Max 300 words.`;
}

const OPENROUTER_MODELS = {
  options: 'google/gemini-2.0-flash',
  code:    'anthropic/claude-haiku-4-5',
  smart:   'anthropic/claude-haiku-4-5',
  fast:    'meta-llama/llama-3.1-8b-instruct:free',
  news:    'meta-llama/llama-3.1-8b-instruct:free',
  reason:  'google/gemini-2.0-flash'
};

async function withRetry(fn, retries=2, delay=800) {
  for (let i=0; i<=retries; i++) {
    try { return await fn(); }
    catch(e) {
      if (i===retries) throw e;
      await new Promise(r=>setTimeout(r, delay*(i+1)));
      console.log(`Retry ${i+1} after: ${e.message}`);
    }
  }
}

async function callOpenRouter(messages, system, task) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('No OpenRouter key');
  const model = OPENROUTER_MODELS[task] || OPENROUTER_MODELS.smart;
  return withRetry(async () => {
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), 25000);
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':`Bearer ${key}`,
        'HTTP-Referer':'https://quantum-trade1.vercel.app',
        'X-Title':'TradeX Quantum AI'
      },
      body:JSON.stringify({ model, max_tokens:900, temperature:0.7, messages:[{role:'system',content:system},...messages] }),
      signal:ctrl.signal
    });
    clearTimeout(t);
    if (r.status===429) throw new Error('OR rate limit');
    if (r.status===401) throw new Error('OR auth failed');
    if (!r.ok) throw new Error(`OR ${r.status}`);
    const d = await r.json();
    if (d.error) throw new Error('OR error: '+d.error.message);
    const text = d.choices?.[0]?.message?.content;
    if (!text) throw new Error('OR empty response');
    return { text, provider:'openrouter', model, task };
  }, 2, 800);
}

async function callClaude(messages, system) {
  const keys = [1,2,3,4].map(i=>process.env[`ANTHROPIC_API_KEY_${i}`]).filter(Boolean);
  if (!keys.length) throw new Error('No Claude keys');
  for (const key of keys) {
    try {
      return await withRetry(async () => {
        const ctrl = new AbortController();
        const t = setTimeout(()=>ctrl.abort(), 22000);
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method:'POST',
          headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},
          body:JSON.stringify({ model:'claude-haiku-4-5-20251001', max_tokens:900, system, messages }),
          signal:ctrl.signal
        });
        clearTimeout(t);
        if (r.status===429||r.status===401||r.status===403) throw new Error(`Claude ${r.status}`);
        if (!r.ok) throw new Error(`Claude ${r.status}`);
        const d = await r.json();
        const text = d.content?.map(c=>c.text||'').join('');
        if (!text) throw new Error('Claude empty');
        return { text, provider:'claude', model:'claude-haiku-4-5' };
      }, 1, 1000);
    } catch(e) { console.log(`Claude key failed: ${e.message}`); }
  }
  throw new Error('All Claude keys exhausted');
}

async function callGemini(messages, system) {
  const keys = [1,2,3].map(i=>process.env[`GEMINI_API_KEY_${i}`]).filter(Boolean);
  if (!keys.length) throw new Error('No Gemini keys');
  for (const key of keys) {
    try {
      return await withRetry(async () => {
        const ctrl = new AbortController();
        const t = setTimeout(()=>ctrl.abort(), 18000);
        const parts = [{text:system+'\n\n'},...messages.map(m=>({text:(m.role==='user'?'User: ':'Asst: ')+m.content+'\n'}))];
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({ contents:[{parts}], generationConfig:{maxOutputTokens:900,temperature:0.7} }),
          signal:ctrl.signal
        });
        clearTimeout(t);
        if (r.status===429||r.status===403) throw new Error(`Gemini ${r.status}`);
        if (!r.ok) throw new Error(`Gemini ${r.status}`);
        const d = await r.json();
        const text = d.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('Gemini empty');
        return { text, provider:'gemini', model:'gemini-2.0-flash' };
      }, 1, 800);
    } catch(e) { console.log(`Gemini key failed: ${e.message}`); }
  }
  throw new Error('All Gemini keys exhausted');
}

async function callGroq(messages, system) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('No Groq key');
  return withRetry(async () => {
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), 15000);
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
      body:JSON.stringify({ model:'llama-3.1-8b-instant', max_tokens:900, messages:[{role:'system',content:system},...messages] }),
      signal:ctrl.signal
    });
    clearTimeout(t);
    if (!r.ok) throw new Error(`Groq ${r.status}`);
    const d = await r.json();
    const text = d.choices?.[0]?.message?.content;
    if (!text) throw new Error('Groq empty');
    return { text, provider:'groq', model:'llama-3.1-8b' };
  }, 1, 500);
}

async function callTogether(messages, system) {
  const key = process.env.TOGETHER_API_KEY;
  if (!key) throw new Error('No Together key');
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), 15000);
  const r = await fetch('https://api.together.xyz/v1/chat/completions', {
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
    body:JSON.stringify({ model:'meta-llama/Llama-3-8b-chat-hf', max_tokens:900, messages:[{role:'system',content:system},...messages] }),
    signal:ctrl.signal
  });
  clearTimeout(t);
  if (!r.ok) throw new Error(`Together ${r.status}`);
  const d = await r.json();
  const text = d.choices?.[0]?.message?.content;
  if (!text) throw new Error('Together empty');
  return { text, provider:'together' };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method==='OPTIONS') return res.status(200).end();
  if (req.method!=='POST') return res.status(405).json({error:'POST only'});

  const { message, history=[], context={} } = req.body||{};
  if (!message) return res.status(400).json({error:'message required'});

  const agentKey = detectAgent(message);
  const agent = AGENTS[agentKey];
  const system = buildSystem(context, agent);
  const msgs = [
    ...history.slice(-6).map(m=>({role:m.role==='ai'?'assistant':'user',content:(m.text||'').slice(0,800)})),
    {role:'user',content:message.slice(0,1500)}
  ];

  const errors = [];
  const start = Date.now();

  // Provider chain: OR → Claude → Gemini → Groq → Together
  const chain = [
    ()=>callOpenRouter(msgs, system, agent.task),
    ()=>callClaude(msgs, system),
    ()=>callGemini(msgs, system),
    ()=>callGroq(msgs, system),
    ()=>callTogether(msgs, system),
  ];

  for (const fn of chain) {
    try {
      const result = await fn();
      return res.json({
        ...result,
        agent: agent.name,
        agentKey,
        latency: Date.now()-start,
        status:'ok'
      });
    } catch(e) {
      errors.push(e.message);
      console.log('Provider failed, next:', e.message);
    }
  }

  return res.status(503).json({
    error:'All AI providers failed',
    errors,
    agent: agent.name,
    status:'offline',
    hint:'Check OPENROUTER_API_KEY, ANTHROPIC_API_KEY_1..4, GEMINI_API_KEY_1..3, GROQ_API_KEY in Vercel env vars'
  });
}
