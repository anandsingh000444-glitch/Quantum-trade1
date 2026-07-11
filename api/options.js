export const config = { runtime: 'nodejs' };

const UPSTOX_TOKEN = process.env.UPSTOX_TOKEN || 'eyJ0eXAiOiJKV1QiLCJrZXlfaWQiOiJza192MS4wIiwiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiI3VkE4TUciLCJqdGkiOiI2YTRiM2NhYjgyMjE5YjVmOTFhNmNlNjEiLCJpc011bHRpQ2xpZW50IjpmYWxzZSwiaXNQbHVzUGxhbiI6ZmFsc2UsImlzRXh0ZW5kZWQiOnRydWUsImlhdCI6MTc4MzMxNTYyNywiaXNzIjoidWRhcGktZ2F0ZXdheS1zZXJ2aWNlIiwiZXhwIjoxODE0OTExMjAwfQ.PthbQKez4K2aOPB73VUtTCZR4ic5IdwrgNEal4vz51U';

const INSTR_MAP = {
  NIFTY:     'NSE_INDEX|Nifty 50',
  BANKNIFTY: 'NSE_INDEX|Nifty Bank',
  FINNIFTY:  'NSE_INDEX|Nifty Fin Service',
  MIDCPNIFTY:'NSE_INDEX|NIFTY MID SELECT',
  SENSEX:    'BSE_INDEX|SENSEX',
};

// Indian weekly expiry schedule:
// NIFTY     = Thursday
// BANKNIFTY = Wednesday
// FINNIFTY  = Tuesday
// SENSEX    = Friday
// MIDCPNIFTY= Monday
const EXPIRY_DAY = { NIFTY:4, BANKNIFTY:3, FINNIFTY:2, SENSEX:5, MIDCPNIFTY:1 };

async function getAvailableExpiries(instrKey) {
  const url = `https://api.upstox.com/v2/option/chain?instrument_key=${encodeURIComponent(instrKey)}`;
  const r = await fetch(url, {
    headers: { 'Authorization': `Bearer ${UPSTOX_TOKEN}`, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) throw new Error(`Upstox expiry list ${r.status}`);
  const d = await r.json();
  if (d.status !== 'success' || !d.data?.length) throw new Error('No expiry data');
  const expiries = [...new Set(d.data.map(x => x.expiry))].filter(Boolean).sort();
  return expiries;
}

function calcWeeklyExpiry(sym) {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const today = ist.getDay();
  const todayStr = ist.toISOString().slice(0, 10);
  const targetDay = EXPIRY_DAY[sym] || 4; // default Thursday
  let diff = (targetDay - today + 7) % 7;
  // If today is expiry day, check if market still open (before 15:30)
  if (diff === 0) {
    const hhmm = ist.getHours() * 60 + ist.getMinutes();
    if (hhmm < 910) diff = 0; // still today
    else diff = 7; // next week
  }
  ist.setDate(ist.getDate() + diff);
  return ist.toISOString().slice(0, 10);
}

function calcMaxPain(rows) {
  let mp = { s: 0, pain: Infinity };
  rows.forEach(row => {
    const pain = rows.reduce((sum, o) =>
      sum + Math.max(0, row.s - o.s) * o.ce.oi + Math.max(0, o.s - row.s) * o.pe.oi, 0);
    if (pain < mp.pain) mp = { s: row.s, pain };
  });
  return mp.s;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sym = (req.query.sym || 'NIFTY').toUpperCase();
  const instrKey = INSTR_MAP[sym];
  if (!instrKey) return res.status(400).json({ error: 'Unknown: ' + sym });

  try {
    // Step 1: Get real expiries from Upstox
    let expiry = req.query.expiry;
    let availableExpiries = [];

    if (!expiry) {
      try {
        availableExpiries = await getAvailableExpiries(instrKey);
        console.log(`${sym} expiries:`, availableExpiries.slice(0, 6));
        // Pick nearest weekly expiry
        const todayStr = new Date().toISOString().slice(0, 10);
        const upcoming = availableExpiries.filter(e => e >= todayStr);
        expiry = upcoming[0] || availableExpiries[availableExpiries.length - 1];
        console.log(`Selected expiry: ${expiry}`);
      } catch(e) {
        console.log('Expiry list failed, calculating:', e.message);
        expiry = calcWeeklyExpiry(sym);
      }
    }

    // Step 2: Fetch chain for expiry
    const url = `https://api.upstox.com/v2/option/chain?instrument_key=${encodeURIComponent(instrKey)}&expiry_date=${expiry}`;
    const r = await fetch(url, {
      headers: { 'Authorization': `Bearer ${UPSTOX_TOKEN}`, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(12000)
    });
    if (r.status === 401) return res.status(401).json({ error: 'Token expired. Update UPSTOX_TOKEN in Vercel.', sim: true });
    if (!r.ok) throw new Error(`Upstox ${r.status}`);
    const d = await r.json();
    if (d.status !== 'success' || !d.data?.length) throw new Error('No data: ' + (d.message||''));

    const rows = d.data
      .filter(x => x.call_options && x.put_options)
      .map(x => {
        const ce = x.call_options.market_data || {};
        const pe = x.put_options.market_data || {};
        const ceg = x.call_options.option_greeks || {};
        const peg = x.put_options.option_greeks || {};
        return {
          s: x.strike_price,
          ce: { oi: ce.oi||0, oiChg: (ce.oi||0)-(ce.prev_oi||0), ltp: +(ce.ltp||0).toFixed(2), iv: +(ceg.iv||0).toFixed(1), delta: +(ceg.delta||0).toFixed(3), gamma: +(ceg.gamma||0).toFixed(5) },
          pe: { oi: pe.oi||0, oiChg: (pe.oi||0)-(pe.prev_oi||0), ltp: +(pe.ltp||0).toFixed(2), iv: +(peg.iv||0).toFixed(1), delta: +(peg.delta||0).toFixed(3), gamma: +(peg.gamma||0).toFixed(5) }
        };
      })
      .sort((a, b) => a.s - b.s);

    const spot = d.data[0]?.underlying_spot_price || 0;
    const totCE = rows.reduce((a, r) => a + r.ce.oi, 0);
    const totPE = rows.reduce((a, r) => a + r.pe.oi, 0);
    const pcr = totCE > 0 ? (totPE / totCE).toFixed(3) : '0';
    const maxPain = calcMaxPain(rows);

    res.setHeader('Cache-Control', 's-maxage=30');
    return res.json({
      sym, spot, pcr, maxPain,
      totCeOI: totCE, totPeOI: totPE,
      expiry, availableExpiries: availableExpiries.slice(0, 8),
      rows, sim: false,
      updatedAt: new Date().toISOString()
    });

  } catch(e) {
    console.error('Options failed:', e.message);
    return res.status(503).json({ error: e.message, sym, sim: true });
  }
}
