// QUANTUM AI - Centralized AI Router
// Phase 2+3: OpenRouter primary, retry, model switching, logging

export const config = { runtime: 'nodejs' };

const PROVIDERS = {
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    key: () => process.env.OPENROUTER_API_KEY,
    models: {
      fast:     'meta-llama/llama-3.1-8b-instruct:free',
      smart:    'anthropic/claude-haiku-4-5',
      reason:   'google/gemini-2.0-flash',
      code:     'anthropic/claude-haiku-4-5',
      options:  'google/gemini-2.0-flash',
      news:     'meta-llama/llama-3.1-8b-instruct:free',
    }
  },
  claude: {
    url: 'https://api.anthropic.com/v1/messages',
    keys: () => [1,2,3,4].map(i=>process.env[`ANTHROPIC_API_KEY_${i}`]).filter(Boolean),
    model: 'claude-haiku-4-5-20251001'
  },
  gemini: {
    url: (k) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${k}`,
    keys: () => [1,2,3].map(i=>process.env[`GEMINI_API_KEY_${i}`]).filter(Boolean)
  },
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    key: () => process.env.GROQ_API_KEY,
    model: 'llama-3.1-8b-instant'
  },
  together: {
    url: 'https://api.together.xyz/v1/chat/completions',
    key: () => process.env.TOGETHER_API_KEY,
    model: 'meta-llama/Llama-3-8b-chat-hf'
  }
};

// Task detection
function detectTask(msg) {
  const m = msg.toLowerCase();
  if (/option|pcr|iv|greek|delta|gamma|theta|straddle|strangle|ce|pe/.test(m)) return 'options';
  if (/code|function|implement|debug|error|fix|write/.test(m)) return 'code';
  if (/news|rbi|fed|fomc|fii|dii|inflation|gdp|event/.test(m)) return 'news';
  if (/why|reason|explain|analyze|compare|difference/.test(m)) return 'reason';
  if (/quick|fast|what is|define|price|current/.test(m)) return 'fast';
  return 'smart';
}

// Retry wrapper
async function withRetry(fn, retries=2, delay=1000) {
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch(e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, delay * (i+1)));
    }
  }
}

async function callOR(messages, system, task) {
  const key = PROVIDERS.openrouter.key();
  if (!key) throw new Error('No OpenRouter key');
  const model = PROVIDERS.openrouter.models[task] || PROVIDERS.openrouter.models.smart;
  return withRetry(async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000);
    const r = await fetch(PROVIDERS.openrouter.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'HTTP-Referer': 'https://quantum-trade1.vercel.app',
        'X-Title': 'TradeX Quantum AI'
      },
      body: JSON.stringify({ model, max_tokens: 800, messages: [{ role:'system', content:system }, ...messages] }),
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (r.status === 429) throw new Error('Rate limit');
    if (!r.ok) throw new Error(`OR ${r.status}`);
    const d = await r.json();
    const text = d.choices?.[0]?.message?.content;
    if (!text) throw new Error('No OR content');
    return { text, provider:'openrouter', model, task };
  }, 2, 800);
}

async function callClaude(messages, system) {
  const keys = PROVIDERS.claude.keys();
  for (const key of keys) {
    try {
      return await withRetry(async () => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 22000);
        const r = await fetch(PROVIDERS.claude.url, {
          method: 'POST',
          headers: { 'Content-Type':'application/json', 'x-api-key':key, 'anthropic-version':'2023-06-01' },
          body: JSON.stringify({ model: PROVIDERS.claude.model, max_tokens:800, system, messages }),
          signal: ctrl.signal
        });
        clearTimeout(t);
        if (r.status === 429 || r.status === 401) throw new Error(`Claude ${r.status}`);
        if (!r.ok) throw new Error(`Claude ${r.status}`);
        const d = await r.json();
        const text = d.content?.map(c=>c.text||'').join('');
        if (!text) throw new Error('No Claude content');
        return { text, provider:'claude', model:PROVIDERS.claude.model };
      }, 1, 1000);
    } catch(e) { console.log(`Claude key failed: ${e.message}`); }
  }
  throw new Error('All Claude keys failed');
}

async function callGemini(messages, system) {
  const keys = PROVIDERS.gemini.keys();
  for (const key of keys) {
    try {
      return await withRetry(async () => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 18000);
        const parts = [{ text: system+'\n\n' }, ...messages.map(m=>({ text:(m.role==='user'?'User: ':'Asst: ')+m.content+'\n' }))];
        const r = await fetch(PROVIDERS.gemini.url(key), {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ contents:[{parts}], generationConfig:{ maxOutputTokens:800, temperature:0.7 } }),
          signal: ctrl.signal
        });
        clearTimeout(t);
        if (r.status === 429 || r.status === 403) throw new Error(`Gemini ${r.status}`);
        if (!r.ok) throw new Error(`Gemini ${r.status}`);
        const d = await r.json();
        const text = d.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('No Gemini content');
        return { text, provider:'gemini' };
      }, 1, 1000);
    } catch(e) { console.log(`Gemini key failed: ${e.message}`); }
  }
  throw new Error('All Gemini keys failed');
}

async function callGroq(messages, system) {
  const key = PROVIDERS.groq.key();
  if (!key) throw new Error('No Groq key');
  return withRetry(async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(PROVIDERS.groq.url, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${key}` },
      body: JSON.stringify({ model:PROVIDERS.groq.model, max_tokens:800, messages:[{role:'system',content:system},...messages] }),
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (!r.ok) throw new Error(`Groq ${r.status}`);
    const d = await r.json();
    const text = d.choices?.[0]?.message?.content;
    if (!text) throw new Error('No Groq content');
    return { text, provider:'groq', model:PROVIDERS.groq.model };
  }, 1, 500);
}

async function callTogether(messages, system) {
  const key = PROVIDERS.together.key();
  if (!key) throw new Error('No Together key');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  const r = await fetch(PROVIDERS.together.url, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${key}` },
    body: JSON.stringify({ model:PROVIDERS.together.model, max_tokens:800, messages:[{role:'system',content:system},...messages] }),
    signal: ctrl.signal
  });
  clearTimeout(t);
  if (!r.ok) throw new Error(`Together ${r.status}`);
  const d = await r.json();
  const text = d.choices?.[0]?.message?.content;
  if (!text) throw new Error('No Together content');
  return { text, provider:'together' };
}

// Main router - exported for use by other API files
export async function routeAI(messages, system, task='smart') {
  const errors = [];
  const start = Date.now();

  const providers = [
    async () => callOR(messages, system, task),
    async () => callClaude(messages, system),
    async () => callGemini(messages, system),
    async () => callGroq(messages, system),
    async () => callTogether(messages, system),
  ];

  for (const fn of providers) {
    try {
      const result = await fn();
      result.latency = Date.now() - start;
      result.task = task;
      return result;
    } catch(e) {
      errors.push(e.message);
      console.log('Provider failed, trying next:', e.message);
    }
  }

  throw new Error('All providers failed: ' + errors.join(' | '));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Health check
  if (req.method === 'GET') {
    const keys = {
      openrouter: !!process.env.OPENROUTER_API_KEY,
      claude: !![1,2,3,4].find(i=>process.env[`ANTHROPIC_API_KEY_${i}`]),
      gemini: !![1,2,3].find(i=>process.env[`GEMINI_API_KEY_${i}`]),
      groq: !!process.env.GROQ_API_KEY,
      together: !!process.env.TOGETHER_API_KEY,
      upstox: !!process.env.UPSTOX_TOKEN,
      newsapi: !!process.env.NEWS_API_KEY,
    };
    const active = Object.values(keys).filter(Boolean).length;
    return res.json({ status:'ok', keys, active, total:Object.keys(keys).length });
  }

  if (req.method !== 'POST') return res.status(405).json({ error:'POST only' });

  const { message, history=[], context={}, task } = req.body || {};
  if (!message) return res.status(400).json({ error:'message required' });

  const detectedTask = task || detectTask(message);
  const msgs = [
    ...history.slice(-6).map(m=>({ role:m.role==='ai'?'assistant':'user', content:(m.text||'').slice(0,800) })),
    { role:'user', content:message.slice(0,1500) }
  ];
  const system = `You are TradeX Quantum AI — institutional trading assistant.
LIVE: NIFTY:${context.nifty||'N/A'} BNK:${context.banknifty||'N/A'} BTC:$${context.btc||'N/A'} GOLD:$${context.gold||'N/A'} F&G:${context.fg||'N/A'} NSE:${context.nseOpen?'OPEN':'CLOSED'} IST:${context.time||'N/A'}
Task: ${detectedTask}. Be specific with numbers. Give Entry|SL|TP1|TP2. Hinglish ok. Max 250 words.`;

  try {
    const result = await routeAI(msgs, system, detectedTask);
    return res.json({ ...result, status:'ok' });
  } catch(e) {
    return res.status(503).json({ error:e.message, status:'offline' });
  }
}
