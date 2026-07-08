// QUANTUM AI - Options Chain Engine
// Upstox primary with retry + detailed error logging

export const config = { runtime: 'nodejs' };

const UPSTOX_TOKEN = process.env.UPSTOX_TOKEN || 'eyJ0eXAiOiJKV1QiLCJrZXlfaWQiOiJza192MS4wIiwiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiI3VkE4TUciLCJqdGkiOiI2YTRiM2NhYjgyMjE5YjVmOTFhNmNlNjEiLCJpc011bHRpQ2xpZW50IjpmYWxzZSwiaXNQbHVzUGxhbiI6ZmFsc2UsImlzRXh0ZW5kZWQiOnRydWUsImlhdCI6MTc4MzMxNTYyNywiaXNzIjoidWRhcGktZ2F0ZXdheS1zZXJ2aWNlIiwiZXhwIjoxODE0OTExMjAwfQ.PthbQKez4K2aOPB73VUtTCZR4ic5IdwrgNEal4vz51U';

function getExpiry(sym) {
  const ist = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Kolkata'}));
  const day = ist.getDay();
  // NIFTY = Thursday(4), BANKNIFTY = Wednesday(3)
  const target = sym==='BANKNIFTY' ? 3 : 4;
  let diff = (target - day + 7) % 7;
  if (diff===0) diff=7;
  ist.setDate(ist.getDate()+diff);
  return ist.toISOString().slice(0,10);
}

function calcMaxPain(rows) {
  let mp = { s:0, pain:Infinity };
  rows.forEach(row => {
    const pain = rows.reduce((sum,o) =>
      sum + Math.max(0,row.s-o.s)*o.ce.oi + Math.max(0,o.s-row.s)*o.pe.oi, 0);
    if (pain<mp.pain) mp = {s:row.s, pain};
  });
  return mp.s;
}

async function withRetry(fn, retries=2) {
  for (let i=0; i<=retries; i++) {
    try { return await fn(); }
    catch(e) {
      if (i===retries) throw e;
      await new Promise(r=>setTimeout(r,1000*(i+1)));
      console.log(`Options retry ${i+1}: ${e.message}`);
    }
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if (req.method==='OPTIONS') return res.status(200).end();

  const sym = (req.query.sym||'NIFTY').toUpperCase();
  const instrKey = sym==='BANKNIFTY' ? 'NSE_INDEX|Nifty Bank' : 'NSE_INDEX|Nifty 50';
  const expiry = req.query.expiry || getExpiry(sym);

  try {
    const data = await withRetry(async () => {
      const url = `https://api.upstox.com/v2/option/chain?instrument_key=${encodeURIComponent(instrKey)}&expiry_date=${expiry}`;
      console.log('Fetching options:', url);
      const r = await fetch(url, {
        headers:{'Authorization':`Bearer ${UPSTOX_TOKEN}`,'Accept':'application/json'},
        signal:AbortSignal.timeout(12000)
      });
      console.log('Options response status:', r.status);
      if (r.status===401) throw new Error('Token expired - refresh UPSTOX_TOKEN in Vercel env');
      if (r.status===403) throw new Error('Upstox forbidden - check API permissions');
      if (!r.ok) throw new Error(`Upstox ${r.status}`);
      const d = await r.json();
      if (d.status!=='success') throw new Error('Upstox: '+(d.message||'unknown error'));
      if (!d.data?.length) throw new Error('No option chain data returned');
      return d;
    });

    const rows = data.data
      .filter(x=>x.call_options&&x.put_options)
      .map(x => {
        const ce=x.call_options.market_data||{};
        const pe=x.put_options.market_data||{};
        const ceg=x.call_options.option_greeks||{};
        const peg=x.put_options.option_greeks||{};
        return {
          s: x.strike_price,
          ce:{ oi:ce.oi||0, oiChg:(ce.oi||0)-(ce.prev_oi||0), ltp:+(ce.ltp||0).toFixed(2), iv:+(ceg.iv||0).toFixed(1), delta:+(ceg.delta||0).toFixed(3), gamma:+(ceg.gamma||0).toFixed(5) },
          pe:{ oi:pe.oi||0, oiChg:(pe.oi||0)-(pe.prev_oi||0), ltp:+(pe.ltp||0).toFixed(2), iv:+(peg.iv||0).toFixed(1), delta:+(peg.delta||0).toFixed(3), gamma:+(peg.gamma||0).toFixed(5) }
        };
      })
      .sort((a,b)=>a.s-b.s);

    const spot = data.data[0]?.underlying_spot_price || 0;
    const totCE = rows.reduce((a,r)=>a+r.ce.oi,0);
    const totPE = rows.reduce((a,r)=>a+r.pe.oi,0);
    const pcr = totCE>0 ? (totPE/totCE).toFixed(3) : '0';
    const maxPain = calcMaxPain(rows);

    res.setHeader('Cache-Control','s-maxage=30');
    return res.json({ sym, spot, pcr, maxPain, totCeOI:totCE, totPeOI:totPE, expiry, rows, sim:false, updatedAt:new Date().toISOString() });

  } catch(e) {
    console.error('Options chain failed:', e.message);
    return res.status(503).json({ error:e.message, sym, expiry, sim:true, hint:'Check UPSTOX_TOKEN in Vercel env vars' });
  }
}
