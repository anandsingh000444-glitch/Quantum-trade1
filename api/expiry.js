// QUANTUM AI - Indian Market Expiry Engine
// Auto-detects correct expiry per NSE/BSE official schedule
// Sep 2025 revised: NIFTY=Tuesday, SENSEX=Thursday, BANKNIFTY/FINNIFTY/MIDCPNIFTY=monthly only

export const config = { runtime: 'nodejs' };

// Official NSE holidays 2026 (from NSE circular)
const NSE_HOLIDAYS_2026 = [
  '2026-01-26', // Republic Day
  '2026-02-26', // Mahashivratri
  '2026-03-20', // Holi
  '2026-04-02', // Ram Navami
  '2026-04-06', // Good Friday (tentative)
  '2026-04-14', // Dr. Ambedkar Jayanti
  '2026-05-01', // Maharashtra Day
  '2026-08-15', // Independence Day
  '2026-08-27', // Ganesh Chaturthi
  '2026-10-02', // Gandhi Jayanti
  '2026-10-23', // Diwali Laxmi Puja (Muhurat Trading)
  '2026-10-24', // Diwali Balipratipada
  '2026-11-04', // Gurunanak Jayanti
  '2026-12-25', // Christmas
];

// Check if date is NSE holiday or weekend
function isTradingHoliday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+05:30');
  const day = d.getDay();
  if (day === 0 || day === 6) return true; // weekend
  return NSE_HOLIDAYS_2026.includes(dateStr);
}

// Get previous trading day
function prevTradingDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+05:30');
  d.setDate(d.getDate() - 1);
  let prev = d.toISOString().slice(0, 10);
  while (isTradingHoliday(prev)) {
    const d2 = new Date(prev + 'T00:00:00+05:30');
    d2.setDate(d2.getDate() - 1);
    prev = d2.toISOString().slice(0, 10);
  }
  return prev;
}

// Get next trading day
function nextTradingDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+05:30');
  d.setDate(d.getDate() + 1);
  let next = d.toISOString().slice(0, 10);
  while (isTradingHoliday(next)) {
    const d2 = new Date(next + 'T00:00:00+05:30');
    d2.setDate(d2.getDate() + 1);
    next = d2.toISOString().slice(0, 10);
  }
  return next;
}

// Get all Tuesdays in a month
function getTuesdaysInMonth(year, month) {
  const tuesdays = [];
  const d = new Date(year, month - 1, 1);
  while (d.getDay() !== 2) d.setDate(d.getDate() + 1);
  while (d.getMonth() === month - 1) {
    tuesdays.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 7);
  }
  return tuesdays;
}

// Get all Thursdays in a month
function getThursdaysInMonth(year, month) {
  const thursdays = [];
  const d = new Date(year, month - 1, 1);
  while (d.getDay() !== 4) d.setDate(d.getDate() + 1);
  while (d.getMonth() === month - 1) {
    thursdays.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 7);
  }
  return thursdays;
}

// Holiday-adjusted expiry
function adjustForHoliday(dateStr) {
  if (isTradingHoliday(dateStr)) {
    return prevTradingDay(dateStr);
  }
  return dateStr;
}

// Get IST date info
function getIST() {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const year = ist.getFullYear();
  const month = ist.getMonth() + 1;
  const day = ist.getDate();
  const weekDay = ist.getDay(); // 0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat
  const hhmm = ist.getHours() * 60 + ist.getMinutes();
  const todayStr = ist.toISOString().slice(0, 10);
  const isMarketOpen = weekDay >= 1 && weekDay <= 5 && hhmm >= 555 && hhmm <= 930;
  return { year, month, day, weekDay, hhmm, todayStr, isMarketOpen, ist };
}

// NIFTY expiry engine (weekly Tuesday, monthly last Tuesday)
function getNIFTYExpiries(year, month) {
  const tuesdays = getTuesdaysInMonth(year, month);
  const weekly = tuesdays.map(t => adjustForHoliday(t));
  const monthly = adjustForHoliday(tuesdays[tuesdays.length - 1]);
  return { weekly, monthly, type: 'weekly+monthly', exchange: 'NSE', expireDay: 'Tuesday' };
}

// SENSEX expiry engine (weekly Thursday, monthly last Thursday)
function getSENSEXExpiries(year, month) {
  const thursdays = getThursdaysInMonth(year, month);
  const weekly = thursdays.map(t => adjustForHoliday(t));
  const monthly = adjustForHoliday(thursdays[thursdays.length - 1]);
  return { weekly, monthly, type: 'weekly+monthly', exchange: 'BSE', expireDay: 'Thursday' };
}

// BANKNIFTY, FINNIFTY, MIDCPNIFTY = monthly only (last Tuesday)
function getMonthlyOnlyExpiries(year, month) {
  const tuesdays = getTuesdaysInMonth(year, month);
  const monthly = adjustForHoliday(tuesdays[tuesdays.length - 1]);
  return { weekly: [], monthly, type: 'monthly-only', exchange: 'NSE', expireDay: 'Last Tuesday' };
}

// Get current + next expiry for a symbol
function getExpiry(sym, todayStr, year, month) {
  let engine;
  if (sym === 'NIFTY') engine = getNIFTYExpiries;
  else if (sym === 'SENSEX') engine = getSENSEXExpiries;
  else engine = getMonthlyOnlyExpiries; // BANKNIFTY, FINNIFTY, MIDCPNIFTY

  const thisMonth = engine(year, month);
  let nextMonth = month === 12 ? engine(year + 1, 1) : engine(year, month + 1);

  // All expiries (weekly + monthly combined, sorted, deduped)
  const allThisMonth = [...new Set([...thisMonth.weekly, thisMonth.monthly])].sort();
  const allNextMonth = [...new Set([...nextMonth.weekly, nextMonth.monthly])].sort();
  const allExpiries = [...allThisMonth, ...allNextMonth].sort();

  // Current = nearest upcoming expiry
  const upcoming = allExpiries.filter(e => e >= todayStr);
  const current = upcoming[0] || allExpiries[allExpiries.length - 1];
  const next = upcoming[1] || null;

  // Days to expiry
  const daysLeft = Math.ceil((new Date(current) - new Date(todayStr)) / 86400000);

  return {
    sym,
    current,
    next,
    monthly: thisMonth.monthly,
    nextMonthly: nextMonth.monthly,
    allUpcoming: upcoming.slice(0, 6),
    daysToExpiry: daysLeft,
    type: thisMonth.type,
    exchange: thisMonth.exchange,
    expireDay: thisMonth.expireDay,
    isExpiry: current === todayStr,
    rule: 'Holiday on expiry day → shifts to previous trading day'
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { year, month, todayStr, weekDay, hhmm, isMarketOpen, ist } = getIST();
  const sym = (req.query.sym || 'ALL').toUpperCase();

  // All symbols
  const SYMS = ['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY', 'MIDCPNIFTY'];
  const results = {};

  if (sym === 'ALL') {
    SYMS.forEach(s => { results[s] = getExpiry(s, todayStr, year, month); });
  } else {
    results[sym] = getExpiry(sym, todayStr, year, month);
  }

  // Today's expiries
  const todayExpiries = SYMS.filter(s => results[s]?.isExpiry || getExpiry(s, todayStr, year, month).isExpiry);
  
  // Market timing
  const marketOpen = isMarketOpen;
  const preOpen = weekDay >= 1 && weekDay <= 5 && hhmm >= 540 && hhmm < 555;
  const afterHours = weekDay >= 1 && weekDay <= 5 && hhmm >= 930;

  // Countdown to market open/close
  let countdown = null;
  if (marketOpen) {
    const minsLeft = 930 - hhmm;
    countdown = { to: 'Market Close', mins: minsLeft, label: `${Math.floor(minsLeft/60)}h ${minsLeft%60}m to close` };
  } else if (preOpen) {
    const minsLeft = 555 - hhmm;
    countdown = { to: 'Market Open', mins: minsLeft, label: `${minsLeft}m to open` };
  }

  res.setHeader('Cache-Control', 's-maxage=3600'); // cache 1 hour
  return res.json({
    today: todayStr,
    istTime: ist.toLocaleTimeString('en-IN', { hour12: false }),
    marketStatus: marketOpen ? 'OPEN' : preOpen ? 'PRE-OPEN' : afterHours ? 'CLOSED' : 'CLOSED',
    countdown,
    todayExpiries,
    expiries: sym === 'ALL' ? results : results[sym],
    holidays: NSE_HOLIDAYS_2026.filter(h => h >= todayStr).slice(0, 5),
    schedule: {
      NIFTY: 'Weekly Tuesday + Monthly last Tuesday (NSE)',
      SENSEX: 'Weekly Thursday + Monthly last Thursday (BSE)',
      BANKNIFTY: 'Monthly only - last Tuesday (NSE)',
      FINNIFTY: 'Monthly only - last Tuesday (NSE)',
      MIDCPNIFTY: 'Monthly only - last Tuesday (NSE)',
    },
    rule: 'If expiry day is holiday → previous trading day',
    effectiveFrom: '2025-09-01',
    source: 'NSE/BSE Official Circular',
    updatedAt: new Date().toISOString()
  });
}
