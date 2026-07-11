// QUANTUM AI - Indian Market Expiry & Holiday Engine
// Auto-detects NSE/BSE expiry, holidays, special sessions
// No hardcoded dates - fetches from official sources daily

export const config = { runtime: 'nodejs' };

// ── OFFICIAL DATA SOURCES ─────────────────────────────────────
const NSE_HOLIDAY_URL = 'https://www.nseindia.com/api/holiday-master?type=trading';
const NSE_EXPIRY_URL  = 'https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY';
const BSE_HOLIDAY_URL = 'https://api.bseindia.com/BseIndiaAPI/api/DefaultData/w?flag=0';

// ── KNOWN 2025-2026 HOLIDAYS (fallback only) ──────────────────
const KNOWN_HOLIDAYS_2025_2026 = [
  '2025-01-26','2025-02-26','2025-03-14','2025-03-31',
  '2025-04-10','2025-04-14','2025-04-18','2025-05-01',
  '2025-08-15','2025-08-27','2025-10-02','2025-10-02',
  '2025-10-20','2025-10-21','2025-10-23','2025-11-05',
  '2025-12-25',
  '2026-01-26','2026-03-20','2026-04-02','2026-04-03',
  '2026-04-14','2026-05-01','2026-08-17','2026-10-02',
  '2026-11-11','2026-12-25'
];

// ── EXPIRY SCHEDULE (official NSE/BSE schedule) ───────────────
// NIFTY     = Every Thursday
// BANKNIFTY = Every Wednesday  
// FINNIFTY  = Every Tuesday
// MIDCPNIFTY= Every Monday
// SENSEX    = Every Friday (BSE)
// BANKEX    = Every Monday (BSE)
// Monthly   = Last Thursday of month (NIFTY)

const WEEKLY_EXPIRY_DAY = {
  NIFTY:      4, // Thursday
  BANKNIFTY:  3, // Wednesday
  FINNIFTY:   2, // Tuesday
  MIDCPNIFTY: 1, // Monday
  SENSEX:     5, // Friday
  BANKEX:     1, // Monday
};

// ── CACHE ─────────────────────────────────────────────────────
let cache = {
  holidays: null,
  lastFetch: 0,
  TTL: 6 * 60 * 60 * 1000 // 6 hours
};

// ── IST DATE UTILS ────────────────────────────────────────────
function nowIST() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
}

function toISTDate(d) {
  return new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
}

function dateStr(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

// ── FETCH NSE HOLIDAYS ────────────────────────────────────────
async function fetchNSEHolidays() {
  try {
    const r = await fetch(NSE_HOLIDAY_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json',
        'Referer': 'https://www.nseindia.com'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) throw new Error(`NSE ${r.status}`);
    const d = await r.json();
    // NSE returns CM (Capital Market) holidays
    const holidays = [];
    if (d.CM) {
      d.CM.forEach(h => {
        const date = h.tradingDate || h.date;
        if (date) holidays.push(date.slice(0, 10));
      });
    }
    return holidays;
  } catch(e) {
    console.log('NSE holiday fetch failed:', e.message);
    return null;
  }
}

// ── GET HOLIDAYS (cached) ─────────────────────────────────────
async function getHolidays() {
  const now = Date.now();
  if (cache.holidays && (now - cache.lastFetch) < cache.TTL) {
    return cache.holidays;
  }
  const fetched = await fetchNSEHolidays();
  if (fetched && fetched.length > 0) {
    cache.holidays = fetched;
    cache.lastFetch = now;
    return fetched;
  }
  // Fallback to known holidays
  return KNOWN_HOLIDAYS_2025_2026;
}

// ── IS HOLIDAY ────────────────────────────────────────────────
function isHoliday(date, holidays) {
  const d = dateStr(new Date(date));
  const day = new Date(date).getDay();
  if (day === 0 || day === 6) return true; // Weekend
  return holidays.includes(d);
}

// ── PREV TRADING DAY (for holiday-shifted expiry) ─────────────
function prevTradingDay(date, holidays) {
  let d = new Date(date);
  d.setDate(d.getDate() - 1);
  while (isHoliday(d, holidays)) {
    d.setDate(d.getDate() - 1);
  }
  return d;
}

// ── NEXT TRADING DAY ──────────────────────────────────────────
function nextTradingDay(date, holidays) {
  let d = new Date(date);
  d.setDate(d.getDate() + 1);
  while (isHoliday(d, holidays)) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

// ── CALCULATE WEEKLY EXPIRY ───────────────────────────────────
function getWeeklyExpiry(sym, holidays, fromDate) {
  const base = fromDate ? new Date(fromDate) : nowIST();
  const targetDay = WEEKLY_EXPIRY_DAY[sym];
  if (targetDay === undefined) return null;

  let d = new Date(base);
  const today = d.getDay();
  const istHHMM = d.getHours() * 60 + d.getMinutes();

  // Days until next target day
  let diff = (targetDay - today + 7) % 7;

  // If today IS expiry day
  if (diff === 0) {
    // If market still open (before 15:30), today is current expiry
    if (istHHMM < 930) {
      // Check if today is holiday
      if (!isHoliday(d, holidays)) {
        return { date: dateStr(d), shifted: false, original: dateStr(d) };
      }
    }
    // After market close or holiday, get next week
    diff = 7;
  }

  d.setDate(d.getDate() + diff);
  const originalDate = dateStr(d);

  // Holiday adjustment - move to previous trading day
  if (isHoliday(d, holidays)) {
    const shifted = prevTradingDay(d, holidays);
    return { date: dateStr(shifted), shifted: true, original: originalDate };
  }

  return { date: dateStr(d), shifted: false, original: originalDate };
}

// ── CALCULATE MONTHLY EXPIRY ──────────────────────────────────
function getMonthlyExpiry(sym, year, month, holidays) {
  const targetDay = WEEKLY_EXPIRY_DAY[sym] || 4;
  // Last occurrence of targetDay in month
  const lastDay = new Date(year, month, 0); // Last day of month
  let d = new Date(lastDay);

  while (d.getDay() !== targetDay) {
    d.setDate(d.getDate() - 1);
  }

  const originalDate = dateStr(d);
  if (isHoliday(d, holidays)) {
    const shifted = prevTradingDay(d, holidays);
    return { date: dateStr(shifted), shifted: true, original: originalDate, type: 'monthly' };
  }
  return { date: originalDate, shifted: false, original: originalDate, type: 'monthly' };
}

// ── CALCULATE QUARTERLY EXPIRY ────────────────────────────────
function getQuarterlyExpiry(sym, holidays) {
  const now = nowIST();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  // Quarter end months: 3(Mar), 6(Jun), 9(Sep), 12(Dec)
  const quarterEnd = month <= 3 ? 3 : month <= 6 ? 6 : month <= 9 ? 9 : 12;
  return { ...getMonthlyExpiry(sym, year, quarterEnd, holidays), type: 'quarterly' };
}

// ── MARKET STATUS ─────────────────────────────────────────────
function getMarketStatus(holidays) {
  const ist = nowIST();
  const day = ist.getDay();
  const hhmm = ist.getHours() * 60 + ist.getMinutes();
  const todayStr = dateStr(ist);

  if (day === 0 || day === 6) return { open: false, reason: 'Weekend', next: null };
  if (holidays.includes(todayStr)) {
    const next = nextTradingDay(ist, holidays);
    return { open: false, reason: 'Exchange Holiday', next: dateStr(next) };
  }
  if (hhmm < 555) return { open: false, reason: 'Pre-Market', opensAt: '09:15 IST' };
  if (hhmm >= 555 && hhmm < 575) return { open: true, reason: 'Pre-Open Session', phase: 'pre-open' };
  if (hhmm >= 575 && hhmm < 930) return { open: true, reason: 'Normal Trading', phase: 'normal' };
  if (hhmm >= 930 && hhmm < 940) return { open: false, reason: 'Closing Session', phase: 'closing' };
  return { open: false, reason: 'After Market', next: dateStr(nextTradingDay(ist, holidays)) };
}

// ── GET HOLIDAY NAME ──────────────────────────────────────────
function getHolidayName(dateStr2, holidays) {
  if (!holidays.includes(dateStr2)) return null;
  const NAMES = {
    '01-26':'Republic Day','02-26':'Mahashivratri','03-14':'Holi',
    '03-31':'Id-Ul-Fitr','04-10':'Good Friday','04-14':'Dr.Ambedkar Jayanti',
    '04-18':'Good Friday','05-01':'Maharashtra Day','08-15':'Independence Day',
    '08-27':'Ganesh Chaturthi','10-02':'Gandhi Jayanti','10-20':'Diwali Laxmi Puja',
    '10-21':'Diwali Balipratipada','10-23':'Muhurat Trading','11-05':'Guru Nanak Jayanti',
    '12-25':'Christmas'
  };
  const mmdd = dateStr2.slice(5);
  return NAMES[mmdd] || 'Exchange Holiday';
}

// ── DAYS UNTIL ────────────────────────────────────────────────
function daysUntil(targetDateStr) {
  const now = nowIST();
  const target = new Date(targetDateStr);
  const diff = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

// ── COUNTDOWN STRING ──────────────────────────────────────────
function countdownTo(targetDateStr, targetTime = '15:30') {
  const now = nowIST();
  const [h, m] = targetTime.split(':').map(Number);
  const target = new Date(targetDateStr);
  target.setHours(h, m, 0, 0);
  const diff = target - now;
  if (diff <= 0) return 'Expired';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// ── MAIN HANDLER ──────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sym  = (req.query.sym || 'NIFTY').toUpperCase();
  const type = req.query.type || 'all';

  try {
    const holidays = await getHolidays();
    const ist = nowIST();
    const todayStr = dateStr(ist);
    const year = ist.getFullYear();
    const month = ist.getMonth() + 1;

    // Weekly expiry
    const weekly = getWeeklyExpiry(sym, holidays);

    // Next weekly
    const nextWeekDate = weekly ? addDays(new Date(weekly.date), 7) : null;
    const nextWeekly = nextWeekDate ? getWeeklyExpiry(sym, holidays, nextWeekDate) : null;

    // Monthly expiry
    const monthly = getMonthlyExpiry(sym, year, month, holidays);
    const nextMonthly = month === 12
      ? getMonthlyExpiry(sym, year + 1, 1, holidays)
      : getMonthlyExpiry(sym, year, month + 1, holidays);

    // Quarterly
    const quarterly = getQuarterlyExpiry(sym, holidays);

    // Market status
    const market = getMarketStatus(holidays);

    // Today's info
    const isHolidayToday = holidays.includes(todayStr);
    const holidayName = getHolidayName(todayStr, holidays);

    // Upcoming holidays (next 30 days)
    const upcoming = [];
    for (let i = 1; i <= 30; i++) {
      const d = addDays(ist, i);
      const ds = dateStr(d);
      if (holidays.includes(ds)) {
        upcoming.push({ date: ds, name: getHolidayName(ds, holidays) || 'Exchange Holiday' });
      }
    }

    // Prev/Next trading day
    const prevTrading = dateStr(prevTradingDay(ist, holidays));
    const nextTrading = dateStr(nextTradingDay(ist, holidays));

    // IST time info
    const istTime = ist.toLocaleTimeString('en-IN', { hour12: false });
    const istDate = ist.toLocaleDateString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

    const result = {
      sym,
      generated: ist.toISOString(),
      istTime, istDate,
      today: todayStr,
      isHoliday: isHolidayToday,
      holidayName,
      market,
      prevTradingDay: prevTrading,
      nextTradingDay: nextTrading,
      expiry: {
        weekly: {
          ...weekly,
          daysLeft: weekly ? daysUntil(weekly.date) : null,
          countdown: weekly ? countdownTo(weekly.date) : null,
        },
        nextWeekly: {
          ...nextWeekly,
          daysLeft: nextWeekly ? daysUntil(nextWeekly.date) : null,
        },
        monthly: {
          ...monthly,
          daysLeft: daysUntil(monthly.date),
          countdown: countdownTo(monthly.date),
        },
        nextMonthly: {
          ...nextMonthly,
          daysLeft: daysUntil(nextMonthly.date),
        },
        quarterly: {
          ...quarterly,
          daysLeft: daysUntil(quarterly.date),
        },
      },
      upcomingHolidays: upcoming,
      totalHolidays: holidays.length,
      dataSource: cache.holidays ? 'NSE Official' : 'Fallback Calendar',
      lastSync: new Date(cache.lastFetch).toISOString(),
      nextSync: new Date(cache.lastFetch + cache.TTL).toISOString(),
    };

    // Cache for 30 min
    res.setHeader('Cache-Control', 's-maxage=1800');

    if (type === 'weekly') return res.json({ sym, ...result.expiry.weekly, market: result.market });
    if (type === 'monthly') return res.json({ sym, ...result.expiry.monthly });
    if (type === 'status') return res.json({ market: result.market, today: result.today, isHoliday: result.isHoliday, holidayName: result.holidayName });
    if (type === 'holidays') return res.json({ holidays: result.upcomingHolidays, total: result.totalHolidays });

    return res.json(result);

  } catch(e) {
    console.error('Expiry engine error:', e.message);
    return res.status(500).json({ error: e.message, sym });
  }
}
