// QUANTUM AI - AI Decision Engine
// Generates institutional-grade trade signals

export const config = { runtime: 'nodejs' };

const OR_KEY = process.env.OPENROUTER_API_KEY;
const CLAUDE_KEYS = [1,2,3,4].map(i => process.env[`ANTHROPIC_API_KEY_${i}`]).filter(Boolean);
const GEMINI_KEYS = [1,2,3].map(i => process.env[`GEMINI_API_KEY_${i}`]).filter(Boolean);

async function getAIDecision(prompt, system) {
  // Try OpenRouter first
  if (OR_KEY) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OR_KEY}`, 'HTTP-Referer': 'https://quantum-trade1.vercel.app' },
        body: JSON.stringify({ model: 'anthropic/claude-haiku-4-5', max_tokens: 1000, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(20000)
      });
      if (r.ok) {
        const d = await r.json();
        return d.choices?.[0]?.message?.content;
      }
    } catch(e) {}
  }
  // Claude fallback
  for (const key of CLAUDE_KEYS) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1000, system, messages: [{ role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(20000)
      });
      if (r.ok) {
        const d = await r.json();
        return d.content?.map(c => c.text || '').join('');
      }
    } catch(e) {}
  }
  // Gemini fallback
  for (const key of GEMINI_KEYS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: system + '\n\n' + prompt }] }], generationConfig: { maxOutputTokens: 1000 } }),
        signal: AbortSignal.timeout(15000)
      });
      if (r.ok) {
        const d = await r.json();
        return d.candidates?.[0]?.content?.parts?.[0]?.text;
      }
    } catch(e) {}
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { sym = 'NIFTY', price, context = {} } = req.body || {};

  const system = `You are an institutional AI trading signal generator. 
You MUST respond ONLY with valid JSON. No markdown, no explanation outside JSON.

Generate a complete trade signal with this exact structure:
{
  "signal": "BUY" or "SELL" or "WAIT" or "AVOID",
  "confidence": 0-100,
  "regime": "TRENDING_UP" or "TRENDING_DOWN" or "RANGING" or "HIGH_VOLATILITY",
  "entry": number,
  "sl": number,
  "tp1": number,
  "tp2": number,
  "tp3": number,
  "risk_reward": "X:1",
  "inst_score": 0-100,
  "probability": 0-100,
  "reasoning": "brief analysis",
  "invalidation": "what would invalidate this setup",
  "lot_size": number,
  "risk_pct": 1
}`;

  const prompt = `Generate institutional trade signal for ${sym}.
Current price: ${price || 'N/A'}
NIFTY: ${context.nifty || 'N/A'} | BANKNIFTY: ${context.banknifty || 'N/A'}
BTC: $${context.btc || 'N/A'} | Fear & Greed: ${context.fg || 'N/A'}/100
NSE: ${context.nseOpen ? 'OPEN' : 'CLOSED'} | Time: ${context.time || 'N/A'}

Analyze market structure, SMC zones, OI data and generate signal.`;

  try {
    const raw = await getAIDecision(prompt, system);
    if (!raw) return res.status(503).json({ error: 'AI unavailable' });

    // Parse JSON from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Invalid AI response', raw });
    const signal = JSON.parse(jsonMatch[0]);
    signal.sym = sym;
    signal.generatedAt = new Date().toISOString();
    res.setHeader('Cache-Control', 's-maxage=30');
    return res.json(signal);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
