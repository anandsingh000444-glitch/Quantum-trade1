// api/market.js
// Priority: Upstox (1st) → Angel One (2nd) → Yahoo Finance (3rd)

export const config = { runtime: 'nodejs' };

const UPSTOX_TOKEN = 'eyJ0eXAiOiJKV1QiLCJrZXlfaWQiOiJza192MS4wIiwiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiI3VkE4TUciLCJqdGkiOiI2YTM5NjhlNGIzNzA2YTY3NzFhMDEzZTgiLCJpc011bHRpQ2xpZW50IjpmYWxzZSwiaXNQbHVzUGxhbiI6ZmFsc2UsImlzRXh0ZW5kZWQiOnRydWUsImlhdCI6MTc4MjE0NzMwMCwiaXNzIjoidWRhcGktZ2F0ZXdheS1zZXJ2aWNlIiwiZXhwIjoxODEzNzAxNjAwfQ.7ZbCuK5p4qVMMlGN0Gi26L213BOqOLjuA7NnZ2z5_j4';

const ANGEL_KEY   = 'lKz7zLNq';
const ANGEL_ID    = 'AABS523966';
const ANGEL_PIN   = '9431';
const ANGEL_TOTP  = '7PBMKSGB3H5JHYGUNVOKIIJ2GU';

// Upstox instrument keys
const UPSTOX_KEYS = {
  NIFTY:      'NSE_INDEX|Nifty 50',
  BANKNIFTY:  'NSE_INDEX|Nifty Bank',
  SENSEX:     'BSE_INDEX|SENSEX',
  FINNIFTY:   'NSE_INDEX|Nifty Fin Service',
  MIDCPNIFTY: 'NSE_INDEX|NIFTY MID SELECT',
  GOLD:       'MCX_FO|GOLD25JUNFUT',
  SILVER:     'MCX_FO|SILVER25JUNFUT',
  CRUDEOIL:   'MCX_FO|CRUDEOIL25JUNFUT',
};

// Angel One tokens
const ANGEL_TOKENS = {
  NIFTY:     '99926000',
  BANKNIFTY: '99926009',
  SENSEX:    '99919000',
  FINNIFTY:  '99926037',
  GOLD:      '234230',
  SILVER:    '234235',
  CRUDEOIL:  '234219',
};

// Yahoo Finance symbols
const YAHOO_SYMS = {
  NIFTY:'%5ENSEI', BANKNIFTY:'%5ENSEBANK', SENSEX:'%5EBSESN',
  GOLD:'GC%3DF', SILVER:'SI%3DF', CRUDEOIL:'CL%3DF',
};

function isNSEOpen(){
  const ist = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Kolkata'}));
  const d = ist.getDay(), t = ist.getHours()*60+ist.getMinutes();
  return d>=1 && d<=5 && t>=555 && t<=930;
}

// ── SOURCE 1: UPSTOX ─────────────────────────────────────────
async function fromUpstox(sym) {
  const key = UPSTOX_KEYS[sym];
  if (!key) throw new Error('No Upstox key for '+sym);
  const url = `https://api.upstox.com/v2/market-quote/quotes?instrument_key=${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    headers: { 'Authorization': 'Bearer '+UPSTOX_TOKEN, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(7000)
  });
  if (!r.ok) throw new Error('Upstox '+r.status);
  const d = await r.json();
  if (d.status !== 'success') throw new Error('Upstox error: '+d.message);
  const q = d.data && Object.values(d.data)[0];
  if (!q || !q.last_price) throw new Error('Upstox no data');
  const price = +q.last_price;
  const prev  = +(q.ohlc?.close || price);
  return {
    symbol: sym, price, change: +(price-prev).toFixed(2),
    changePct: +((price-prev)/prev*100).toFixed(3),
    high: +(q.ohlc?.high||0), low: +(q.ohlc?.low||0),
    prevClose: prev, source: 'upstox', live: true
  };
}

// ── SOURCE 2: ANGEL ONE ───────────────────────────────────────
let angelToken = null;
let angelTokenTime = 0;

async function getAngelToken() {
  // Token valid for 1 hour
  if (angelToken && Date.now() - angelTokenTime < 3500000) return angelToken;
  try {
    // Generate TOTP
    const { authenticator } = await import('otplib').catch(() => null) || {};
    let totp = '';
    if (authenticator) {
      totp = authenticator.generate(ANGEL_TOTP);
    }
    const r = await fetch('https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-UserType': 'USER',
        'X-SourceID': 'WEB',
        'X-ClientLocalIP': '127.0.0.1',
        'X-ClientPublicIP': '127.0.0.1',
        'X-MACAddress': '00:00:00:00:00:00',
        'X-PrivateKey': ANGEL_KEY
      },
      body: JSON.stringify({ clientcode: ANGEL_ID, password: ANGEL_PIN, totp }),
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) throw new Error('Angel login '+r.status);
    const d = await r.json();
    if (d.status && d.data?.jwtToken) {
      angelToken = d.data.jwtToken;
      angelTokenTime = Date.now();
      return angelToken;
    }
    throw new Error('Angel login failed: '+d.message);
  } catch(e) {
    throw new Error('Angel auth: '+e.message);
  }
}

async function fromAngel(sym) {
  const token2 = ANGEL_TOKENS[sym];
  if (!token2) throw new Error('No Angel token for '+sym);
  const jwt = await getAngelToken();
  const r = await fetch('https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': 'Bearer '+jwt,
      'X-PrivateKey': ANGEL_KEY,
      'X-UserType': 'USER',
      'X-SourceID': 'WEB'
    },
    body: JSON.stringify({ mode: 'FULL', exchangeTokens: { 'NSE': [token2] } }),
    signal: AbortSignal.timeout(7000)
  });
  if (!r.ok) throw new Error('Angel quote '+r.status);
  const d = await r.json();
  const q = d.data?.fetched?.[0];
  if (!q || !q.ltp) throw new Error('Angel no data');
  const price = +q.ltp;
  const prev  = +(q.close || price);
  return {
    symbol: sym, price, change: +(price-prev).toFixed(2),
    changePct: +((price-prev)/prev*100).toFixed(3),
    high: +(q.high||0), low: +(q.low||0),
    prevClose: prev, source: 'angel', live: true
  };
}

// ── SOURCE 3: YAHOO FINANCE ───────────────────────────────────
async function fromYahoo(sym) {
  const yahoo = YAHOO_SYMS[sym];
  if (!yahoo) throw new Error('No Yahoo sym for '+sym);
  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${yahoo}?interval=2m&range=1d`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${yahoo}?interval=2m&range=1d`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: {'User-Agent':'Mozilla/5.0 (compatible)'},
        signal: AbortSignal.timeout(7000)
      });
      if (!r.ok) continue;
      const d = await r.json();
      const m = d?.chart?.result?.[0]?.meta;
      if (m?.regularMarketPrice) {
        const price = +m.regularMarketPrice;
        const prev  = +(m.chartPreviousClose||price);
        return {
          symbol: sym, price, change: +(price-prev).toFixed(2),
          changePct: +((price-prev)/prev*100).toFixed(3),
          high: +(m.regularMarketDayHigh||0), low: +(m.regularMarketDayLow||0),
          prevClose: prev, source: 'yahoo', live: true
        };
      }
    } catch(e) { continue; }
  }
  throw new Error('Yahoo failed for '+sym);
}

// ── MAIN HANDLER ─────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if (req.method==='OPTIONS') return res.status(200).end();

  const sym = (req.query.symbol||'NIFTY').toUpperCase();
  const nseOpen = isNSEOpen();
  const istTime = new Date().toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour12:false,hour:'2-digit',minute:'2-digit'});

  const errors = [];

  // 1. Upstox
  try {
    const data = await fromUpstox(sym);
    res.setHeader('Cache-Control', nseOpen?'s-maxage=15':'s-maxage=300');
    return res.json({...data, nseOpen, istTime, updatedAt: new Date().toISOString()});
  } catch(e) { errors.push('Upstox: '+e.message); }

  // 2. Angel One
  try {
    const data = await fromAngel(sym);
    res.setHeader('Cache-Control', nseOpen?'s-maxage=15':'s-maxage=300');
    return res.json({...data, nseOpen, istTime, updatedAt: new Date().toISOString()});
  } catch(e) { errors.push('Angel: '+e.message); }

  // 3. Yahoo Finance
  try {
    const data = await fromYahoo(sym);
    res.setHeader('Cache-Control', nseOpen?'s-maxage=30':'s-maxage=300');
    return res.json({...data, nseOpen, istTime, updatedAt: new Date().toISOString()});
  } catch(e) { errors.push('Yahoo: '+e.message); }

  return res.status(503).json({error:'All sources failed for '+sym, errors, nseOpen, istTime, live:false});
}
