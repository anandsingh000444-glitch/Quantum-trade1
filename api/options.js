// api/options.js - Real Option Chain via Upstox backend
export const config = { runtime: 'nodejs' };

const UPSTOX_TOKEN = process.env.UPSTOX_TOKEN || 'eyJ0eXAiOiJKV1QiLCJrZXlfaWQiOiJza192MS4wIiwiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiI3VkE4TUciLCJqdGkiOiI2YTM5NjhlNGIzNzA2YTY3NzFhMDEzZTgiLCJpc011bHRpQ2xpZW50IjpmYWxzZSwiaXNQbHVzUGxhbiI6ZmFsc2UsImlzRXh0ZW5kZWQiOnRydWUsImlhdCI6MTc4MjE0NzMwMCwiaXNzIjoidWRhcGktZ2F0ZXdheS1zZXJ2aWNlIiwiZXhwIjoxODEzNzAxNjAwfQ.7ZbCuK5p4qVMMlGN0Gi26L213BOqOLjuA7NnZ2z5_j4';

function getExpiry(sym) {
  const ist = new Date(new Date().toLocaleString('en-US', {timeZone:'Asia/Kolkata'}));
  const day = ist.getDay();
  // NIFTY = Thursday, BANKNIFTY = Wednesday
  const target = sym === 'BANKNIFTY' ? 3 : 4;
  let diff = (target - day + 7) % 7;
  if (diff === 0) diff = 7;
  ist.setDate(ist.getDate() + diff);
  return ist.toISOString().slice(0, 10);
}

function calcMaxPain(rows) {
  let mp = { s: 0, pain: Infinity };
  rows.forEach(row => {
    const pain = rows.reduce((sum, o) => {
      return sum + Math.max(0, row.s - o.s) * o.ce.oi + Math.max(0, o.s - row.s) * o.pe.oi;
    }, 0);
    if (pain < mp.pain) mp = { s: row.s, pain };
  });
  return mp.s;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sym = (req.query.sym || 'NIFTY').toUpperCase();
  const instrKey = sym === 'BANKNIFTY' ? 'NSE_INDEX|Nifty Bank' : 'NSE_INDEX|Nifty 50';
  const expiry = req.query.expiry || getExpiry(sym);

  try {
    const url = `https://api.upstox.com/v2/option/chain?instrument_key=${encodeURIComponent(instrKey)}&expiry_date=${expiry}`;
    const r = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${UPSTOX_TOKEN}`,
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!r.ok) {
      return res.status(r.status).json({ error: `Upstox ${r.status}`, sim: true });
    }

    const d = await r.json();

    if (d.status !== 'success' || !d.data?.length) {
      return res.status(502).json({ error: 'No data from Upstox', sim: true });
    }

    const rows = d.data
      .filter(x => x.call_options && x.put_options)
      .map(x => {
        const ce = x.call_options.market_data || {};
        const pe = x.put_options.market_data || {};
        const ceg = x.call_options.option_greeks || {};
        const peg = x.put_options.option_greeks || {};
        return {
          s: x.strike_price,
          ce: {
            oi: ce.oi || 0,
            oiChg: (ce.oi || 0) - (ce.prev_oi || 0),
            ltp: +(ce.ltp || 0).toFixed(2),
            iv: +(ceg.iv || 0).toFixed(1),
            delta: +(ceg.delta || 0).toFixed(3),
            gamma: +(ceg.gamma || 0).toFixed(5)
          },
          pe: {
            oi: pe.oi || 0,
            oiChg: (pe.oi || 0) - (pe.prev_oi || 0),
            ltp: +(pe.ltp || 0).toFixed(2),
            iv: +(peg.iv || 0).toFixed(1),
            delta: +(peg.delta || 0).toFixed(3),
            gamma: +(peg.gamma || 0).toFixed(5)
          }
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
      expiry, rows, sim: false,
      updatedAt: new Date().toISOString()
    });

  } catch (e) {
    return res.status(503).json({ error: e.message, sim: true });
  }
}
