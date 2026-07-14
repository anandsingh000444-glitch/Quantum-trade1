export const config = { runtime: 'nodejs' };

const UPSTOX_TOKEN = process.env.UPSTOX_TOKEN || 'eyJ0eXAiOiJKV1QiLCJrZXlfaWQiOiJza192MS4wIiwiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiI3VkE4TUciLCJqdGkiOiI2YTRiM2NhYjgyMjE5YjVmOTFhNmNlNjEiLCJpc011bHRpQ2xpZW50IjpmYWxzZSwiaXNQbHVzUGxhbiI6ZmFsc2UsImlzRXh0ZW5kZWQiOnRydWUsImlhdCI6MTc4MzMxNTYyNywiaXNzIjoidWRhcGktZ2F0ZXdheS1zZXJ2aWNlIiwiZXhwIjoxODE0OTExMjAwfQ.PthbQKez4K2aOPB73VUtTCZR4ic5IdwrgNEal4vz51U';

const INSTR_MAP = {
  NIFTY:     'NSE_INDEX|Nifty 50',
  BANKNIFTY: 'NSE_INDEX|Nifty Bank',
  FINNIFTY:  'NSE_INDEX|Nifty Fin Service',
  MIDCPNIFTY:'NSE_INDEX|NIFTY MID SELECT',
  SENSEX:    'BSE_INDEX|SENSEX',
};

// NSE/BSE Official schedule (effective Sep 1, 2025)
const NSE_HOLIDAYS = [
  '2026-01-26','2026-02-26','2026-03-20','2026-04-02',
  '2026-04-06','2026-04-14','2026-05-01','2026-08-15',
  '2026-08-27','2026-10-02','2026-10-23','2026-10-24',
  '2026-11-04','2026-12-25'
];

function isHoliday(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay();
  if (day === 0 || day === 6) return true;
  return NSE_HOLIDAYS.includes(dateStr);
}

function prevTradingDay(dateStr) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - 1);
  let s = d.toISOString().slice(0, 10);
  while (isHoliday(s)) {
    const d2 = new Date(s); d2.setDate(d2.getDate() - 1);
    s = d2.toISOString().slice(0, 10);
  }
  return s;
}

function getWeeklyExpiry(sym) {
  const ist = new Date(new Date().toLocaleString('en-US', {timeZone:'Asia/Kolkata'}));
  const today = ist.toISOString().slice(0, 10);
  const weekDay = ist.getDay();

  // NIFTY = Tuesday(2), SENSEX = Thursday(4)
  // BANKNIFTY/FINNIFTY/MIDCPNIFTY = monthly only
  let targetDay;
  if (sym === 'SENSEX') targetDay = 4;
  else targetDay = 2; // NIFTY (and monthly for others)

  let diff = (targetDay - weekDay + 7) % 7;
  const hhmm = ist.getHours() * 60 + ist.getMinutes();

  // If today is expiry day and market still open → today
  // If today is expiry day and market closed → next week
  if (diff === 0 && hhmm >= 930) diff = 7;
  if (diff === 0 && hhmm < 930) diff = 0;

  const exp = new Date(ist);
  exp.setDate(exp.getDate() + diff);
  let expStr = exp.toISOString().slice(0, 10);

  // Holiday adjustment → previous trading day
  expStr = isHoliday(expStr) ? prevTradingDay(expStr) : expStr;
  return expStr;
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

  // Use provided expiry or auto-calculate
  let expiry = req.query.expiry || getWeeklyExpiry(sym);

  try {
    const url = `https://api.upstox.com/v2/option/chain?instrument_key=${encodeURIComponent(instrKey)}&expiry_date=${expiry}`;
    console.log(`Fetching ${sym} options expiry=${expiry}`);

    const r = await fetch(url, {
      headers: { 'Authorization': `Bearer ${UPSTOX_TOKEN}`, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(12000)
    });

    if (r.status === 401) return res.status(401).json({ error:'Token expired. Update UPSTOX_TOKEN in Vercel.', sim:true });
    if (!r.ok) throw new Error(`Upstox ${r.status}`);
    const d = await r.json();
    if (d.status !== 'success' || !d.data?.length) throw new Error('No data: '+(d.message||'empty'));

    // Extract available expiries from response
    const availableExpiries = [...new Set(d.data.map(x => x.expiry))].filter(Boolean).sort();

    const rows = d.data
      .filter(x => x.call_options && x.put_options)
      .map(x => {
        const ce = x.call_options.market_data || {};
        const pe = x.put_options.market_data || {};
        const ceg = x.call_options.option_greeks || {};
        const peg = x.put_options.option_greeks || {};
        return {
          s: x.strike_price,
          ce: { oi:ce.oi||0, oiChg:(ce.oi||0)-(ce.prev_oi||0), ltp:+(ce.ltp||0).toFixed(2), iv:+(ceg.iv||0).toFixed(1), delta:+(ceg.delta||0).toFixed(3), gamma:+(ceg.gamma||0).toFixed(5) },
          pe: { oi:pe.oi||0, oiChg:(pe.oi||0)-(pe.prev_oi||0), ltp:+(pe.ltp||0).toFixed(2), iv:+(peg.iv||0).toFixed(1), delta:+(peg.delta||0).toFixed(3), gamma:+(peg.gamma||0).toFixed(5) }
        };
      })
      .sort((a, b) => a.s - b.s);

    const spot = d.data[0]?.underlying_spot_price || 0;
    const totCE = rows.reduce((a,r) => a+r.ce.oi, 0);
    const totPE = rows.reduce((a,r) => a+r.pe.oi, 0);
    const pcr = totCE > 0 ? (totPE/totCE).toFixed(3) : '0';
    const maxPain = calcMaxPain(rows);

    // Expiry schedule info
    const scheduleInfo = sym === 'NIFTY' ? 'Weekly Tuesday (NSE)' :
      sym === 'SENSEX' ? 'Weekly Thursday (BSE)' :
      'Monthly only - last Tuesday (NSE)';

    res.setHeader('Cache-Control', 's-maxage=30');
    return res.json({
      sym, spot, pcr, maxPain, totCeOI:totCE, totPeOI:totPE,
      expiry, availableExpiries: availableExpiries.slice(0, 8),
      rows, sim:false, scheduleInfo,
      updatedAt: new Date().toISOString()
    });

  } catch(e) {
    console.error('Options failed:', e.message);
    return res.status(503).json({ error:e.message, sym, expiry, sim:true });
  }
}
