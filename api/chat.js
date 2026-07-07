// QUANTUM AI - Multi-Agent AI Engine
// OpenRouter primary → Claude → Gemini → Groq → Together → Cohere → HF
// Agents: Market Analyst, Options Analyst, Risk Manager, News Analyst

export const config = { runtime: 'nodejs' };

// All providers via env vars
const OR_KEY      = process.env.OPENROUTER_API_KEY;
const CLAUDE_KEYS = [1,2,3,4].map(i => process.env[`ANTHROPIC_API_KEY_${i}`]).filter(Boolean);
const GEMINI_KEYS = [1,2,3].map(i => process.env[`GEMINI_API_KEY_${i}`]).filter(Boolean);
const GROQ_KEY    = process.env.GROQ_API_KEY;
const TOGETHER_KEY = process.env.TOGETHER_API_KEY;
const COHERE_KEY  = process.env.COHERE_API_KEY;
const HF_KEY      = process.env.HF_API_KEY;

// Agent definitions
const AGENTS = {
  market: {
    name: 'Market Analyst',
    model_or: 'anthropic/claude-haiku-4-5',
    focus: 'Technical analysis, price action, SMC, FVG, Order Blocks, BOS, CHOCH, VWAP, Volume Profile'
  },
  options: {
    name: 'Options Analyst', 
    model_or: 'google/gemini-2.0-flash',
    focus: 'Options Greeks, PCR, Max Pain, IV, OI analysis, options strategies'
  },
  risk: {
    name: 'Risk Manager',
    model_or: 'meta-llama/llama-3.1-8b-instruct',
    focus: 'Position sizing, 1-2% risk rule, SL/TP calculation, portfolio risk'
  },
  news: {
    name: 'News Analyst',
    model_or: 'google/gemini-flash-1.5',
    focus: 'Market moving news, FII/DII flows, economic events, sentiment'
  },
  general: {
    name: 'TradeX AI',
    model_or: 'anthropic/claude-haiku-4-5',
    focus: 'All trading topics'
  }
};

// Detect which agent to use
function detectAgent(msg) {
  const m = msg.toLowerCase();
  if (/option|chain|pcr|iv|greek|delta|gamma|theta|vega|strangle|straddle|pe|ce/.test(m)) return 'options';
  if (/risk|position size|lot|capital|stop loss|sl|1%|2%/.test(m)) return 'risk';
  if (/news|rbi|fed|fii|dii|inflation|gdp|nfp|event/.test(m)) return 'news';
  if (/chart|setup|fvg|ob|bos|choch|smc|ict|vwap|support|resistance/.test(m)) return 'market';
  return 'general';
}

function buildSystem(context, agentKey) {
  const agent = AGENTS[agentKey] || AGENTS.general;
  const nse = context.nseOpen ? 'OPEN' : 'CLOSED';
  return `You are ${agent.name} — part of TradeX Quantum AI institutional trading system.

LIVE MARKET DATA:
NIFTY: ${context.nifty||'N/A'} | BANKNIFTY: ${context.banknifty||'N/A'} | SENSEX: ${context.sensex||'N/A'}
FINNIFTY: ${context.finnifty||'N/A'} | MIDCPNIFTY: ${context.midcpnifty||'N/A'}
BTC: $${context.btc||'N/A'} | ETH: $${context.eth||'N/A'}
GOLD: $${context.gold||'N/A'} | SILVER: $${context.silver||'N/A'}
Fear & Greed: ${context.fg||'N/A'}/100 | NSE: ${nse} | IST: ${context.time||'N/A'}

YOUR EXPERTISE: ${agent.focus}

MANDATORY RESPONSE FORMAT:
1. ANALYSIS — exact price levels, what structure/data says
2. TRADE SETUP — Entry | SL | TP1 | TP2 | TP3 | Lot size (1-2% risk)
3. CONFIDENCE — X% with reasoning
4. RISK — position sizing advice

Be specific with exact numbers. Hinglish ok. Max 300 words.`;
}

// OpenRouter call
async function callOpenRouter(messages, system, modelId) {
  if (!OR_KEY) throw new Error('No OpenRouter key');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OR_KEY}`,
      'HTTP-Referer': 'https://quantum-trade1.vercel.app',
      'X-Title': 'TradeX Quantum AI'
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 800,
      messages: [{ role: 'system', content: system }, ...messages]
    }),
    signal: ctrl.signal
  });
  clearTimeout(t);
  if (!r.ok) throw new Error(`OpenRouter ${r.status}`);
  const d = await r.json();
  const text = d.choices?.[0]?.message?.content;
  if (!text) throw new Error('No content');
  return { text, provider: 'openrouter', model: modelId };
}

// Claude direct call
async function callClaude(messages, system) {
  for (const key of CLAUDE_KEYS) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 800, system, messages }),
        signal: ctrl.signal
      });
      clearTimeout(t);
      if (r.status === 429 || r.status === 401 || r.status === 403) continue;
      if (r.ok) {
        const d = await r.json();
        const text = d.content?.map(c => c.text || '').join('');
        if (text) return { text, provider: 'claude' };
      }
    } catch(e) { console.log('Claude err:', e.message); }
  }
  throw new Error('All Claude keys failed');
}

// Gemini direct call
async function callGemini(messages, system) {
  for (const key of GEMINI_KEYS) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const parts = [{ text: system + '\n\n' }, ...messages.map(m => ({ text: (m.role === 'user' ? 'User: ' : 'Assistant: ') + m.content + '\n' }))];
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { maxOutputTokens: 800 } }),
        signal: ctrl.signal
      });
      clearTimeout(t);
      if (r.status === 429 || r.status === 403) continue;
      if (r.ok) {
        const d = await r.json();
        const text = d.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return { text, provider: 'gemini' };
      }
    } catch(e) { console.log('Gemini err:', e.message); }
  }
  throw new Error('All Gemini keys failed');
}

// Groq call
async function callGroq(messages, system) {
  if (!GROQ_KEY) throw new Error('No Groq key');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({ model: 'llama-3.1-8b-instant', max_tokens: 800, messages: [{ role: 'system', content: system }, ...messages] }),
    signal: ctrl.signal
  });
  clearTimeout(t);
  if (!r.ok) throw new Error(`Groq ${r.status}`);
  const d = await r.json();
  const text = d.choices?.[0]?.message?.content;
  if (!text) throw new Error('No Groq content');
  return { text, provider: 'groq' };
}

// Together AI call
async function callTogether(messages, system) {
  if (!TOGETHER_KEY) throw new Error('No Together key');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  const r = await fetch('https://api.together.xyz/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOGETHER_KEY}` },
    body: JSON.stringify({ model: 'meta-llama/Llama-3-8b-chat-hf', max_tokens: 800, messages: [{ role: 'system', content: system }, ...messages] }),
    signal: ctrl.signal
  });
  clearTimeout(t);
  if (!r.ok) throw new Error(`Together ${r.status}`);
  const d = await r.json();
  const text = d.choices?.[0]?.message?.content;
  if (!text) throw new Error('No Together content');
  return { text, provider: 'together' };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { message, history = [], context = {}, agent: forceAgent } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });

  const agentKey = forceAgent || detectAgent(message);
  const agent = AGENTS[agentKey] || AGENTS.general;
  const system = buildSystem(context, agentKey);
  const msgs = [
    ...history.slice(-6).map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: (m.text || '').slice(0, 800) })),
    { role: 'user', content: message.slice(0, 1500) }
  ];

  const errors = [];

  // 1. OpenRouter (primary)
  try {
    const result = await callOpenRouter(msgs, system, agent.model_or);
    return res.json({ ...result, agent: agent.name, agentKey, status: 'ok' });
  } catch(e) { errors.push('OpenRouter: ' + e.message); }

  // 2. Claude direct
  try {
    const result = await callClaude(msgs, system);
    return res.json({ ...result, agent: agent.name, agentKey, status: 'ok' });
  } catch(e) { errors.push('Claude: ' + e.message); }

  // 3. Gemini direct
  try {
    const result = await callGemini(msgs, system);
    return res.json({ ...result, agent: agent.name, agentKey, status: 'ok' });
  } catch(e) { errors.push('Gemini: ' + e.message); }

  // 4. Groq
  try {
    const result = await callGroq(msgs, system);
    return res.json({ ...result, agent: agent.name, agentKey, status: 'ok' });
  } catch(e) { errors.push('Groq: ' + e.message); }

  // 5. Together AI
  try {
    const result = await callTogether(msgs, system);
    return res.json({ ...result, agent: agent.name, agentKey, status: 'ok' });
  } catch(e) { errors.push('Together: ' + e.message); }

  console.error('All AI providers failed:', errors);
  return res.status(503).json({ error: 'All providers failed. Check Vercel env vars.', errors, status: 'offline' });
}
