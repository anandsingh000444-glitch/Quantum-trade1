// api/chart.js - Real OHLCV: Upstox primary → Yahoo fallback
export const config = { runtime: 'nodejs' };

const UPSTOX_TOKEN = process.env.UPSTOX_APP_TOKEN || process.env.UPSTOX_TOKEN || '';

const UPSTOX_MAP = {
  NIFTY:      'NSE_INDEX|Nifty 50',
  BANKNIFTY:  'NSE_INDEX|Nifty Bank',
  SENSEX:     'BSE_INDEX|SENSEX',
  FINNIFTY:   'NSE_INDEX|Nifty Fin Service',
  MIDCPNIFTY: 'NSE_INDEX|NIFTY MID SELECT',
};

const YAHOO_MAP = {
  NIFTY:'%5ENSEI', BANKNIFTY:'%5ENSEBANK', SENSEX:'%5EBSESN',
  FINNIFTY:'NIFTYFINSERVICE.NS', MIDCPNIFTY:'MIDCPNIFTY.NS',
  BTC:'BTC-USD', ETH:'ETH-USD', GOLD:'GC%3DF',
  SILVER:'SI%3DF', SOL:'SOL-USD', CRUDEOIL:'CL%3DF',
};

// Upstox interval mapping
const UP_TF = {
  '1m':'1minute','3m':'3minute','5m':'5minute','10m':'10minute',
  '15m':'15minute','30m':'30minute','1h':'60minute',
};

// Yahoo interval mapping
const YH_TF = {
  '1m':{i:'1m',r:'1d'},'3m':{i:'2m',r:'5d'},'5m':{i:'5m',r:'5d'},
  '10m':{i:'5m',r:'5d'},'15m':{i:'15m',r:'5d'},'30m':{i:'30m',r:'1mo'},
  '45m':{i:'30m',r:'1mo'},'1h':{i:'60m',r:'1mo'},'2h':{i:'60m',r:'3mo'},
  '4h':{i:'60m',r:'3mo'},'D':{i:'1d',r:'1y'},'W':{i:'1wk',r:'5y'},
};

function getDateRange(tf) {
  const now = new Date();
  const to = now.toISOString().slice(0,10);
  const from = new Date(now);
  if (tf==='1m'||tf==='3m'||tf==='5m'||tf==='10m') from.setDate(from.getDate()-1);
  else if (tf==='15m'||tf==='30m'||tf==='45m') from.setDate(from.getDate()-5);
  else if (tf==='1h'||tf==='2h'||tf==='4h') from.setMonth(from.getMonth()-1);
  else if (tf==='D') from.setFullYear(from.getFullYear()-1);
  else from.setFullYear(from.getFullYear()-5);
  return { from: from.toISOString().slice(0,10), to };
}

async function fromUpstox(sym, tf) {
  const instrKey = UPSTOX_MAP[sym];
  if (!instrKey) throw new Error('No Upstox map for '+sym);

  let url, candles;

  // Intraday (today's data)
  if (['1m','3m','5m','10m','15m','30m'].includes(tf)) {
    const interval = UP_TF[tf] || '5minute';
    url = `https://api.upstox.com/v2/historical-candle/intraday/${encodeURIComponent(instrKey)}/${interval}`;
  } else {
    // Historical
    const { from, to } = getDateRange(tf);
    const interval = tf==='1h'||tf==='2h'||tf==='4h' ? '60minute' : tf==='D' ? 'day' : 'week';
    url = `https://api.upstox.com/v2/historical-candle/${encodeURIComponent(instrKey)}/${interval}/${to}/${from}`;
  }

  const r = await fetch(url, {
    headers: { 'Authorization': `Bearer ${UPSTOX_TOKEN}`, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(10000)
  });
  if (r.status===401) throw new Error('Upstox token expired');
  if (!r.ok) throw new Error(`Upstox ${r.status}`);
  const d = await r.json();
  if (d.status!=='success') throw new Error('Upstox: '+d.message);

  const raw = d.data?.candles || [];
  if (!raw.length) throw new Error('No candles from Upstox');

  // Upstox format: [timestamp, open, high, low, close, volume, oi]
  candles = raw.map(c => ({
    time:   Math.floor(new Date(c[0]).getTime()/1000),
    open:   +c[1].toFixed(2),
    high:   +c[2].toFixed(2),
    low:    +c[3].toFixed(2),
    close:  +c[4].toFixed(2),
    volume: c[5]||0
  })).sort((a,b)=>a.time-b.time);

  return { candles, source:'upstox' };
}

async function fromYahoo(sym, tf) {
  const yahoo = YAHOO_MAP[sym];
  if (!yahoo) throw new Error('No Yahoo map for '+sym);
  const { i: interval, r: range } = YH_TF[tf] || YH_TF['5m'];

  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${yahoo}?interval=${interval}&range=${range}&includePrePost=false`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${yahoo}?interval=${interval}&range=${range}&includePrePost=false`,
  ];

  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(10000)
      });
      if (!r.ok) continue;
      const d = await r.json();
      const result = d?.chart?.result?.[0];
      if (!result) continue;
      const times = result.timestamp||[];
      const q = result.indicators?.quote?.[0]||{};
      const candles = [];
      for (let i=0; i<times.length; i++) {
        if (!q.close?.[i]||!q.open?.[i]) continue;
        candles.push({
          time:  times[i],
          open:  +q.open[i].toFixed(2),
          high:  +q.high[i].toFixed(2),
          low:   +q.low[i].toFixed(2),
          close: +q.close[i].toFixed(2),
          volume: q.volume?.[i]||0
        });
      }
      if (candles.length < 5) continue;
      const meta = result.meta||{};
      return {
        candles,
        source: 'yahoo',
        meta: { price: meta.regularMarketPrice||0, prevClose: meta.chartPreviousClose||0 }
      };
    } catch(e) { continue; }
  }
  throw new Error('Yahoo failed for '+sym);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if (req.method==='OPTIONS') return res.status(200).end();

  const sym = (req.query.sym||'NIFTY').toUpperCase();
  const tf  = req.query.tf||'5m';
  const isNSE = ['NIFTY','BANKNIFTY','SENSEX','FINNIFTY','MIDCPNIFTY'].includes(sym);

  // Try Upstox first for NSE indices
  if (isNSE) {
    try {
      const d = await fromUpstox(sym, tf);
      res.setHeader('Cache-Control','s-maxage=30');
      return res.json({ sym, tf, ...d, count: d.candles.length, updatedAt: new Date().toISOString() });
    } catch(e) {
      console.log('Upstox chart failed:', e.message, '- trying Yahoo');
    }
  }

  // Yahoo fallback
  try {
    const d = await fromYahoo(sym, tf);
    res.setHeader('Cache-Control','s-maxage=30');
    return res.json({ sym, tf, ...d, count: d.candles.length, updatedAt: new Date().toISOString() });
  } catch(e) {
    return res.status(503).json({ error: e.message, sym, tf });
  }
}
