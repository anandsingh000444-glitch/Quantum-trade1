// QUANTUM AI - Market Data Engine
// Upstox → Yahoo Finance → Twelve Data → Alpha Vantage

export const config = { runtime: 'nodejs' };

const UPSTOX_TOKEN = process.env.UPSTOX_APP_TOKEN || process.env.UPSTOX_TOKEN || '';
const TWELVE_KEY  = process.env.TWELVE_DATA_KEY || '18d87171681a4adea4e95f4175c8294d';
const ALPHA_KEY   = process.env.ALPHA_VANTAGE_KEY || '9YWZWLNKRZS1DMTT';

const UPSTOX_MAP = {
  NIFTY:'NSE_INDEX|Nifty 50', BANKNIFTY:'NSE_INDEX|Nifty Bank',
  SENSEX:'BSE_INDEX|SENSEX', FINNIFTY:'NSE_INDEX|Nifty Fin Service',
  MIDCPNIFTY:'NSE_INDEX|NIFTY MID SELECT',
  GOLD:'MCX_FO|GOLD25AUGFUT', SILVER:'MCX_FO|SILVER25AUGFUT', CRUDEOIL:'MCX_FO|CRUDEOIL25AUGFUT'
};

const YAHOO_MAP = {
  NIFTY:'%5ENSEI', BANKNIFTY:'%5ENSEBANK', SENSEX:'%5EBSESN',
  FINNIFTY:'NIFTYFINSERVICE.NS', MIDCPNIFTY:'MIDCPNIFTY.NS',
  GOLD:'GC%3DF', SILVER:'SI%3DF', CRUDEOIL:'CL%3DF'
};

const TWELVE_MAP = {
  NIFTY:'NIFTY', BANKNIFTY:'BANKNIFTY', SENSEX:'SENSEX',
  GOLD:'XAU/USD', SILVER:'XAG/USD', CRUDEOIL:'CL1!'
};

function isNSEOpen() {
  const ist = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Kolkata'}));
  const d=ist.getDay(), t=ist.getHours()*60+ist.getMinutes();
  return d>=1&&d<=5&&t>=555&&t<=930;
}

async function withRetry(fn, retries=2) {
  for (let i=0; i<=retries; i++) {
    try { return await fn(); }
    catch(e) { if (i===retries) throw e; await new Promise(r=>setTimeout(r,500*(i+1))); }
  }
}

async function fromUpstox(sym) {
  const key = UPSTOX_MAP[sym];
  if (!key) throw new Error('No Upstox map for '+sym);
  return withRetry(async () => {
    const r = await fetch(`https://api.upstox.com/v2/market-quote/quotes?instrument_key=${encodeURIComponent(key)}`, {
      headers:{'Authorization':`Bearer ${UPSTOX_TOKEN}`,'Accept':'application/json'},
      signal:AbortSignal.timeout(8000)
    });
    if (r.status===401) throw new Error('Upstox token expired');
    if (!r.ok) throw new Error(`Upstox ${r.status}`);
    const d = await r.json();
    if (d.status!=='success') throw new Error('Upstox: '+d.message);
    const q = d.data && Object.values(d.data)[0];
    if (!q?.last_price) throw new Error('Upstox no price');
    const price=+q.last_price, prev=+(q.ohlc?.close||price);
    return { symbol:sym, price, change:+(price-prev).toFixed(2), changePct:+((price-prev)/prev*100).toFixed(3), high:+(q.ohlc?.high||0), low:+(q.ohlc?.low||0), prevClose:prev, source:'upstox', live:true };
  });
}

async function fromYahoo(sym) {
  const yahoo = YAHOO_MAP[sym];
  if (!yahoo) throw new Error('No Yahoo map for '+sym);
  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${yahoo}?interval=2m&range=1d`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${yahoo}?interval=2m&range=1d`
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers:{'User-Agent':'Mozilla/5.0'}, signal:AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const d = await r.json();
      const m = d?.chart?.result?.[0]?.meta;
      if (!m?.regularMarketPrice) continue;
      const price=+m.regularMarketPrice, prev=+(m.chartPreviousClose||price);
      return { symbol:sym, price, change:+(price-prev).toFixed(2), changePct:+((price-prev)/prev*100).toFixed(3), high:+(m.regularMarketDayHigh||0), low:+(m.regularMarketDayLow||0), prevClose:prev, source:'yahoo', live:true };
    } catch(e) { continue; }
  }
  throw new Error('Yahoo failed for '+sym);
}

async function fromTwelve(sym) {
  const s = TWELVE_MAP[sym];
  if (!s) throw new Error('No Twelve map for '+sym);
  const r = await fetch(`https://api.twelvedata.com/quote?symbol=${s}&apikey=${TWELVE_KEY}`, { signal:AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Twelve ${r.status}`);
  const d = await r.json();
  if (d.status==='error') throw new Error('Twelve: '+d.message);
  const price=+d.close, prev=+(d.previous_close||price);
  return { symbol:sym, price, change:+(price-prev).toFixed(2), changePct:+((price-prev)/prev*100).toFixed(3), high:+(d.high||0), low:+(d.low||0), prevClose:prev, source:'twelve', live:true };
}

export default async function handler(req, res) {
  // F&O stocks endpoint
  if(req.query.type==='stocks'){
    try{
      // Fetch Nifty 50 stocks from Yahoo Finance
      const symbols=['RELIANCE.NS','TCS.NS','HDFCBANK.NS','INFY.NS','ICICIBANK.NS',
        'SBIN.NS','BHARTIARTL.NS','ITC.NS','TATAMOTORS.NS','TATASTEEL.NS',
        'HINDALCO.NS','JSWSTEEL.NS','BAJFINANCE.NS','MARUTI.NS','SUNPHARMA.NS',
        'WIPRO.NS','HCLTECH.NS','AXISBANK.NS','KOTAKBANK.NS','LT.NS',
        'ADANIENT.NS','ADANIPORTS.NS','NTPC.NS','POWERGRID.NS','ONGC.NS',
        'COALINDIA.NS','GRASIM.NS','DRREDDY.NS','CIPLA.NS','ZOMATO.NS'];
      
      const stocks={};
      // Fetch in batches
      const yahooUrl='https://query1.finance.yahoo.com/v7/finance/quote?symbols='+symbols.slice(0,10).join(',');
      const r=await fetch(yahooUrl,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(8000)});
      if(r.ok){
        const d=await r.json();
        const quotes=d?.quoteResponse?.result||[];
        quotes.forEach(q=>{
          const sym=q.symbol.replace('.NS','');
          stocks[sym]={price:+(q.regularMarketPrice||0).toFixed(2),chg:+(q.regularMarketChangePercent||0).toFixed(2),sim:false};
        });
      }
      return res.json({stocks,updatedAt:new Date().toISOString()});
    }catch(e){
      return res.json({stocks:{},error:e.message});
    }
  }

  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if (req.method==='OPTIONS') return res.status(200).end();

  const sym = (req.query.symbol||'NIFTY').toUpperCase();
  const nseOpen = isNSEOpen();
  const istTime = new Date().toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour12:false,hour:'2-digit',minute:'2-digit'});
  const errors = [];

  // 1. Upstox
  try {
    const d = await fromUpstox(sym);
    res.setHeader('Cache-Control', nseOpen?'s-maxage=15':'s-maxage=300');
    return res.json({...d, nseOpen, istTime, updatedAt:new Date().toISOString()});
  } catch(e) { errors.push('Upstox: '+e.message); }

  // 2. Yahoo Finance
  try {
    const d = await fromYahoo(sym);
    res.setHeader('Cache-Control', nseOpen?'s-maxage=30':'s-maxage=300');
    return res.json({...d, nseOpen, istTime, updatedAt:new Date().toISOString()});
  } catch(e) { errors.push('Yahoo: '+e.message); }

  // 3. Twelve Data
  try {
    const d = await fromTwelve(sym);
    res.setHeader('Cache-Control', nseOpen?'s-maxage=30':'s-maxage=300');
    return res.json({...d, nseOpen, istTime, updatedAt:new Date().toISOString()});
  } catch(e) { errors.push('Twelve: '+e.message); }

  return res.status(503).json({ error:'All market data sources failed', errors, symbol:sym, nseOpen, istTime, live:false });
}
