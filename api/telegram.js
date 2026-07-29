export const config = { runtime: 'nodejs' };

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { message, chatId, type = 'signal' } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });
  if (!BOT_TOKEN) return res.status(503).json({ error: 'TELEGRAM_BOT_TOKEN not set in Vercel' });

  const targetId = chatId || CHAT_ID;
  if (!targetId) return res.status(503).json({ error: 'TELEGRAM_CHAT_ID not set in Vercel' });

  const icons = { signal: '📊', alert: '🚨', news: '📰', risk: '⚠️', arth: '🌡️' };
  const icon = icons[type] || '📊';
  const text = icon + ' *TradeX Quantum AI*

' + message + '

_' + new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST_';

  try {
    const r = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: targetId, text, parse_mode: 'Markdown' }),
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) throw new Error('Telegram API: ' + r.status);
    const d = await r.json();
    return res.json({ ok: true, messageId: d.result?.message_id });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
