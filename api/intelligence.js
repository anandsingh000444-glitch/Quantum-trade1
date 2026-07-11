// QUANTUM AI - Market Intelligence Engine
// FII/DII, Economic Calendar, Sentiment, VIX

export const config = { runtime: 'nodejs' };

const ALPHA_KEY = process.env.ALPHA_VANTAGE_KEY || '9YWZWLNKRZS1DMTT';
const NEWS_KEY  = process.env.NEWS_API_KEY || 'fe0d4657c95f46f78ebf47bb142800a0';
const GNEWS_KEY = process.env.GNEWS_API_KEY || '5310e9c32bdce7269bc9e1377b9fd21f';
const TWELVE_KEY = process.env.TWELVE_DATA_KEY || '18d87171681a4adea4e95f4175c8294d';
const FG_URL = 'https://api.alternative.me/fng/?limit=7';

async function getFearGreed() {
  try {
    const r = await fetch(FG_URL, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error('FG API failed');
    const d = await r.json();
    return {
      current: +d.data[0].value,
      label: d.data[0].value_classification,
      history: d.data.map(x => ({ value: +x.value, label: x.value_classification, date: x.timestamp }))
    };
  } catch(e) {
    return { current: 50, label: 'Neutral', history: [] };
  }
}

async function getVIX() {
  try {
    const r = await fetch(`https://api.twelvedata.com/quote?symbol=VIX&apikey=${TWELVE_KEY}`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error('VIX failed');
    const d = await r.json();
    return { value: +d.close, change: +d.percent_change, high: +d.high, low: +d.low };
  } catch(e) {
    return { value: 13.5, change: 0, high: 14, low: 13 };
  }
}

async function getSentimentNews() {
  try {
    const q = 'NIFTY OR NSE OR "India stock" OR RBI OR Sensex';
    const r = await fetch(`https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=en&sortBy=publishedAt&pageSize=5&apiKey=${NEWS_KEY}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('News failed');
    const d = await r.json();
    const articles = (d.articles || []).slice(0, 5).map(a => ({
      title: a.title,
      source: a.source?.name,
      time: a.publishedAt
    }));
    // Simple sentiment
    const bullish = articles.filter(a => /rise|surge|rally|gain|bull|up|high|positive|growth/i.test(a.title)).length;
    const bearish = articles.filter(a => /fall|drop|crash|decline|bear|down|low|negative|loss/i.test(a.title)).length;
    const sentiment = bullish > bearish ? 'BULLISH' : bearish > bullish ? 'BEARISH' : 'NEUTRAL';
    return { articles, sentiment, bullish, bearish };
  } catch(e) {
    return { articles: [], sentiment: 'NEUTRAL', bullish: 0, bearish: 0 };
  }
}

// Economic calendar events (static but structured)
function getEconomicCalendar() {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay();
  const events = [];

  // Weekly recurring events
  if (day === 1) events.push({ event: 'Weekly Options Expiry Watch', impact: 'HIGH', time: '09:15 IST', asset: 'NIFTY/BANKNIFTY' });
  if (day === 4) events.push({ event: 'NIFTY Weekly Expiry', impact: 'HIGH', time: '15:30 IST', asset: 'NIFTY' });
  if (day === 3) events.push({ event: 'BANKNIFTY Weekly Expiry', impact: 'HIGH', time: '15:30 IST', asset: 'BANKNIFTY' });

  // Always show
  events.push({ event: 'NSE Market Open', impact: 'MED', time: '09:15 IST', asset: 'All' });
  events.push({ event: 'NSE Market Close', impact: 'MED', time: '15:30 IST', asset: 'All' });
  events.push({ event: 'US Market Open', impact: 'MED', time: '19:00 IST', asset: 'Global' });

  return events;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const type = req.query.type || 'all';

  try {
    if (type === 'fg') {
      const fg = await getFearGreed();
      return res.json(fg);
    }
    if (type === 'vix') {
      const vix = await getVIX();
      return res.json(vix);
    }
    if (type === 'sentiment') {
      const s = await getSentimentNews();
      return res.json(s);
    }
    if (type === 'calendar') {
      return res.json({ events: getEconomicCalendar() });
    }

    // All data parallel
    const [fg, vix, sentiment] = await Promise.allSettled([getFearGreed(), getVIX(), getSentimentNews()]);
    res.setHeader('Cache-Control', 's-maxage=60');
    return res.json({
      fearGreed: fg.value || { current: 50, label: 'Neutral' },
      vix: vix.value || { value: 13.5 },
      sentiment: sentiment.value || { sentiment: 'NEUTRAL' },
      calendar: getEconomicCalendar(),
      updatedAt: new Date().toISOString()
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
