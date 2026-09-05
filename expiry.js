// QUANTUM AI - Automatic Indian Market Expiry & Holiday Engine
// Fetches LIVE data from NSE/BSE official APIs
// NO hardcoded expiry dates - 100% automatic
// Self-healing: auto-updates on every request

export const config = { runtime: 'nodejs' };

// ── CACHE STORE ───────────────────────────────────────────────
const CACHE = {
  nseHolidays:    { data: null, ts: 0, ttl: 6 * 3600000 },
  bseHolidays:    { data: null, ts: 0, ttl: 6 * 3600000 },
  nseExpiries:    { data: null, ts: 0, ttl: 1800000 },
  bseExpiries:    { data: null, ts: 0, ttl: 1800000 },
  niftyChain:     { data: null, ts: 0, ttl: 1800000 },
  bankniftyChain: { data: null, ts: 0, ttl: 1800000 },
};

function cacheGet(key) {
  const c = CACHE[key];
  if (c.data && (Date.now() - c.ts) < c.ttl) return c.data;
  return null;
}

function cacheSet(key, data) {
  CACHE[key] = { ...CACHE[key], data, ts: Date.now() };
}

// ── IST UTILITIES ─────────────────────────────────────────────
function nowIST() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
}

function dateStr(d) {
  const ist = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  return ist.toISOString().slice(0, 10);
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function parseDate(str) {
  // Handle DD-MMM-YYYY or YYYY-MM-DD
  if (!str) return null;
  if (str.includes('-') && str.length === 10 && str[4] === '-') return new Date(str);
  const months = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
  const parts = str.split('-');
  if (parts.length === 3 && months[parts[1]] !== undefined) {
    return new Date(+parts[2], months[parts[1]], +parts[0]);
  }
  return new Date(str);
}

// ── FETCH WITH RETRY ──────────────────────────────────────────
async function safeFetch(url, options = {}, retries = 2) {
  const defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json, text/html, */*',
    'Accept-Language': 'en-IN,en;q=0.9',
    'Cache-Control': 'no-cache',
  };
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, {
        ...options,
        headers: { ...defaultHeaders, ...(options.headers || {}) },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r;
    } catch(e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// ── SOURCE 1: NSE HOLIDAY API ─────────────────────────────────
async function fetchNSEHolidays() {
  const cached = cacheGet('nseHolidays');
  if (cached) return cached;

  try {
    // NSE official holiday API
    const r = await safeFetch('https://www.nseindia.com/api/holiday-master?type=trading', {
      headers: { 'Referer': 'https://www.nseindia.com' }
    });
    const d = await r.json();
    const holidays = [];
    // CM = Capital Market segment
    const segments = ['CM', 'FO', 'CD'];
    segments.forEach(seg => {
      if (d[seg]) {
        d[seg].forEach(h => {
          const raw = h.tradingDate || h.trade_date || h.date || '';
          if (raw) {
            const parsed = parseDate(raw);
            if (parsed && !isNaN(parsed)) {
              holidays.push({
                date: parsed.toISOString().slice(0, 10),
                name: h.description || h.weekDay || 'Exchange Holiday',
                segment: seg,
                source: 'NSE'
              });
            }
          }
        });
      }
    });
    const unique = [...new Map(holidays.map(h => [h.date, h])).values()]
      .sort((a, b) => a.date.localeCompare(b.date));
    cacheSet('nseHolidays', unique);
    return unique;
  } catch(e) {
    console.log('NSE holiday API failed:', e.message);
    return null;
  }
}

// ── SOURCE 2: NSE OPTION CHAIN (real expiry dates) ───────────
async function fetchNSEExpiries(sym) {
  const cacheKey = sym === 'NIFTY' ? 'niftyChain' : 'bankniftyChain';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const url = `https://www.nseindia.com/api/option-chain-indices?symbol=${sym}`;
    const r = await safeFetch(url, {
      headers: { 'Referer': 'https://www.nseindia.com/option-chain' }
    });
    const d = await r.json();
    const expiries = d.records?.expiryDates || [];
    // Convert to YYYY-MM-DD
    const converted = expiries.map(e => {
      const parsed = parseDate(e);
      return parsed ? parsed.toISOString().slice(0, 10) : null;
    }).filter(Boolean).sort();
    cacheSet(cacheKey, converted);
    return converted;
  } catch(e) {
    console.log(`NSE ${sym} expiry fetch failed:`, e.message);
    return null;
  }
}

// ── SOURCE 3: UPSTOX OPTION CHAIN EXPIRIES ───────────────────
async function fetchUpstoxExpiries(sym) {
  const TOKEN = process.env.UPSTOX_TOKEN;
  if (!TOKEN) return null;

  const INSTR = {
    NIFTY: 'NSE_INDEX|Nifty 50',
    BANKNIFTY: 'NSE_INDEX|Nifty Bank',
    FINNIFTY: 'NSE_INDEX|Nifty Fin Service',
    MIDCPNIFTY: 'NSE_INDEX|NIFTY MID SELECT',
    SENSEX: 'BSE_INDEX|SENSEX',
  };
  const key = INSTR[sym];
  if (!key) return null;

  try {
    const r = await safeFetch(
      `https://api.upstox.com/v2/option/chain?instrument_key=${encodeURIComponent(key)}`,
      { headers: { 'Authorization': `Bearer ${TOKEN}`, 'Accept': 'application/json' } }
    );
    const d = await r.json();
    if (d.status !== 'success' || !d.data?.length) return null;
    const expiries = [...new Set(d.data.map(x => x.expiry).filter(Boolean))].sort();
    return expiries;
  } catch(e) {
    console.log(`Upstox ${sym} expiry failed:`, e.message);
    return null;
  }
}

// ── GET BEST EXPIRY DATES FOR SYMBOL ─────────────────────────
async function getExpiriesForSym(sym) {
  // Try NSE first (most accurate)
  const nseMap = { NIFTY: 'NIFTY', BANKNIFTY: 'BANKNIFTY' };
  if (nseMap[sym]) {
    const nseExpiries = await fetchNSEExpiries(nseMap[sym]);
    if (nseExpiries && nseExpiries.length > 0) {
      return { expiries: nseExpiries, source: 'NSE Official' };
    }
  }

  // Try Upstox
  const upstoxExpiries = await fetchUpstoxExpiries(sym);
  if (upstoxExpiries && upstoxExpiries.length > 0) {
    return { expiries: upstoxExpiries, source: 'Upstox' };
  }

  return { expiries: [], source: 'unavailable' };
}

// ── GET HOLIDAYS ──────────────────────────────────────────────
async function getHolidays() {
  const nse = await fetchNSEHolidays();
  if (nse && nse.length > 0) return { holidays: nse, source: 'NSE Official' };

  // Fallback: minimal known 2026 holidays
  const fallback = [
    { date:'2026-01-26', name:'Republic Day' },
    { date:'2026-03-20', name:'Holi' },
    { date:'2026-04-02', name:'Ram Navami' },
    { date:'2026-04-03', name:'Good Friday' },
    { date:'2026-04-14', name:'Dr. Ambedkar Jayanti' },
    { date:'2026-05-01', name:'Maharashtra Day' },
    { date:'2026-08-17', name:'Independence Day' },
    { date:'2026-10-02', name:'Gandhi Jayanti' },
    { date:'2026-11-11', name:'Diwali' },
    { date:'2026-12-25', name:'Christmas' },
  ];
  return { holidays: fallback, source: 'Fallback' };
}

// ── IS HOLIDAY CHECK ──────────────────────────────────────────
function isHoliday(d, holidays) {
  const day = d.getDay();
  if (day === 0 || day === 6) return { isHoliday: true, name: day === 0 ? 'Sunday' : 'Saturday' };
  const ds = d.toISOString().slice(0, 10);
  const h = holidays.find(x => x.date === ds);
  return h ? { isHoliday: true, name: h.name } : { isHoliday: false };
}

// ── PREV/NEXT TRADING DAY ─────────────────────────────────────
function prevTradingDay(d, holidays) {
  let r = new Date(d);
  r.setDate(r.getDate() - 1);
  while (isHoliday(r, holidays).isHoliday) r.setDate(r.getDate() - 1);
  return r;
}

function nextTradingDay(d, holidays) {
  let r = new Date(d);
  r.setDate(r.getDate() + 1);
  while (isHoliday(r, holidays).isHoliday) r.setDate(r.getDate() + 1);
  return r;
}

// ── GET CURRENT & NEXT EXPIRY FROM LIVE DATA ─────────────────
async function getExpiryData(sym) {
  const now = nowIST();
  const todayStr = now.toISOString().slice(0, 10);
  const istHHMM = now.getHours() * 60 + now.getMinutes();

  const { expiries, source } = await getExpiriesForSym(sym);
  const { holidays, source: holSource } = await getHolidays();

  let current = null, next = null, monthly = null, allExpiries = expiries;

  if (expiries.length > 0) {
    // Filter upcoming expiries
    const upcoming = expiries.filter(e => {
      if (e > todayStr) return true;
      if (e === todayStr && istHHMM < 930) return true; // Same day before 15:30
      return false;
    });

    current = upcoming[0] || null;
    next = upcoming[1] || null;

    // Monthly = last expiry of current month
    const currentMonth = todayStr.slice(0, 7);
    const monthExpiries = expiries.filter(e => e.startsWith(currentMonth));
    monthly = monthExpiries.length > 0 ? monthExpiries[monthExpiries.length - 1] : null;
  }

  // Verify if expiry is on holiday & get shift info
  function getExpiryInfo(dateStr2) {
    if (!dateStr2) return null;
    const d = new Date(dateStr2);
    const h = isHoliday(d, holidays);
    let shifted = false, shiftedTo = null;
    if (h.isHoliday) {
      const prev = prevTradingDay(d, holidays);
      shiftedTo = prev.toISOString().slice(0, 10);
      shifted = true;
    }
    const effective = shifted ? shiftedTo : dateStr2;
    const daysLeft = Math.ceil((new Date(effective) - now) / 86400000);
    const msLeft = new Date(effective + 'T15:30:00+05:30') - Date.now();
    const countdown = msLeft > 0 ? formatCountdown(msLeft) : 'Expired';
    return { date: effective, original: dateStr2, shifted, holidayName: h.name, daysLeft: Math.max(0, daysLeft), countdown };
  }

  function formatCountdown(ms) {
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  // Market countdown
  const openMs = new Date(todayStr + 'T09:15:00+05:30') - Date.now();
  const closeMs = new Date(todayStr + 'T15:30:00+05:30') - Date.now();
  const isOpen = openMs <= 0 && closeMs > 0 && !isHoliday(now, holidays).isHoliday;

  return {
    sym,
    today: todayStr,
    istTime: now.toLocaleTimeString('en-IN', { hour12: false }),
    istDate: now.toLocaleDateString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric' }),
    market: {
      isOpen,
      status: isHoliday(now, holidays).isHoliday ? 'HOLIDAY' : isOpen ? 'OPEN' : openMs > 0 ? 'PRE-MARKET' : 'CLOSED',
      reason: isHoliday(now, holidays).name || (isOpen ? 'Normal Trading' : openMs > 0 ? 'Opens at 09:15 IST' : 'After Market'),
      countdownToOpen: openMs > 0 ? formatCountdown(openMs) : null,
      countdownToClose: closeMs > 0 ? formatCountdown(closeMs) : null,
      prevTradingDay: prevTradingDay(now, holidays).toISOString().slice(0, 10),
      nextTradingDay: nextTradingDay(now, holidays).toISOString().slice(0, 10),
    },
    expiry: {
      current: getExpiryInfo(current),
      next: getExpiryInfo(next),
      monthly: getExpiryInfo(monthly),
      allUpcoming: allExpiries.filter(e => e >= todayStr).slice(0, 8),
    },
    holidays: {
      source: holSource,
      upcoming: holidays
        .filter(h => h.date >= todayStr)
        .slice(0, 10)
        .map(h => ({ ...h, daysLeft: Math.ceil((new Date(h.date) - now) / 86400000) })),
      total: holidays.length,
    },
    dataSource: {
      expiry: source,
      holidays: holSource,
      verified: source !== 'unavailable',
      status: source !== 'unavailable' ? 'LIVE' : 'VERIFICATION_PENDING',
    },
    syncInfo: {
      generatedAt: new Date().toISOString(),
      nextSyncAt: new Date(Date.now() + 1800000).toISOString(),
      autoRefresh: true,
    }
  };
}

// ── MAIN HANDLER ──────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sym  = (req.query.sym  || 'NIFTY').toUpperCase();
  const type = (req.query.type || 'all');

  try {
    const data = await getExpiryData(sym);

    // Cache 30 min
    res.setHeader('Cache-Control', 's-maxage=1800');

    // Specific endpoints
    if (type === 'weekly')   return res.json({ sym, ...data.expiry.current, market: data.market, source: data.dataSource });
    if (type === 'monthly')  return res.json({ sym, ...data.expiry.monthly, source: data.dataSource });
    if (type === 'status')   return res.json({ sym, market: data.market, today: data.today, holidays: data.holidays.upcoming.slice(0,3) });
    if (type === 'holidays') return res.json({ holidays: data.holidays.upcoming, total: data.holidays.total, source: data.holidays.source });
    if (type === 'all_expiries') return res.json({ sym, expiries: data.expiry.allUpcoming, source: data.dataSource });

    return res.json(data);

  } catch(e) {
    console.error('Expiry engine error:', e.message);
    return res.status(500).json({
      error: e.message,
      sym,
      status: 'VERIFICATION_PENDING',
      message: 'Data verification pending - please retry'
    });
  }
}
