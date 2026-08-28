// api/options.js - Uses expiry engine for accurate dates
export const config = { runtime: 'nodejs' };

// Priority: UPSTOX_APP_TOKEN (your app's access token) > UPSTOX_TOKEN (analytics)
// To get app token: upstox.com/developer/apps -> your app -> Get Token
const UPSTOX_TOKEN = process.env.UPSTOX_APP_TOKEN || 
                     process.env.UPSTOX_TOKEN || 
                     'eyJ0eXAiOiJKV1QiLCJrZXlfaWQiOiJza192MS4wIiwiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiI3VkE4TUciLCJqdGkiOiI2YTRiM2NhYjgyMjE5YjVmOTFhNmNlNjEiLCJpc011bHRpQ2xpZW50IjpmYWxzZSwiaXNQbHVzUGxhbiI6ZmFsc2UsImlzRXh0ZW5kZWQiOnRydWUsImlhdCI6MTc4MzMxNTYyNywiaXNzIjoidWRhcGktZ2F0ZXdheS1zZXJ2aWNlIiwiZXhwIjoxODE0OTExMjAwfQ.PthbQKez4K2aOPB73VUtTCZR4ic5IdwrgNEal4vz51U';

const INSTR_MAP = {
  NIFTY:     'NSE_INDEX|Nifty 50',
  BANKNIFTY: 'NSE_INDEX|Nifty Bank',
  FINNIFTY:  'NSE_INDEX|Nifty Fin Service',
  MIDCPNIFTY:'NSE_INDEX|NIFTY MID SELECT',
  SENSEX:    'BSE_INDEX|SENSEX',
};

// Indian weekly expiry - verified schedule
// NIFTY=Thursday, BANKNIFTY=Wednesday, FINNIFTY=Tuesday
// MIDCPNIFTY=Monday, SENSEX=Friday
const EXPIRY_DAY = { NIFTY:4, BANKNIFTY:3, FINNIFTY:2, MIDCPNIFTY:1, SENSEX:5 };

const HOLIDAYS_2026 = [
  '2026-01-26','2026-03-20','2026-04-02','2026-04-03',
  '2026-04-14','2026-05-01','2026-08-17','2026-10-02',
  '2026-11-11','2026-12-25'
];

function isHoliday(d) {
  const day = d.getDay();
  if (day === 0 || day === 6) return true;
  return HOLIDAYS_2026.includes(d.toISOString().slice(0,10));
}

function prevTradingDay(d) {
  const r = new Date(d);
  r.setDate(r.getDate() - 1);
  while (isHoliday(r)) r.setDate(r.getDate() - 1);
  return r;
}

async function getExpiryFromEngine(sym) {
  try {
    const r = await fetch(`https://quantum-trade1.vercel.app/api/expiry?sym=${sym}&type=weekly`, {
      signal: AbortSignal.timeout(5000)
    });
    if (r.ok) {
      const d = await r.json();
      if (d.date) return d.date;
    }
  } catch(e) {}
  return null;
}

function calcExpiry(sym) {
  const ist = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Kolkata'}));
  const today = ist.getDay();
  const target = EXPIRY_DAY[sym] || 4;
  let diff = (target - today + 7) % 7;
  if (diff === 0) {
    const hhmm = ist.getHours()*60+ist.getMinutes();
    if (hhmm >= 930) diff = 7;
  }
  const expDate = new Date(ist);
  expDate.setDate(expDate.getDate() + diff);
  if (isHoliday(expDate)) {
    const prev = prevTradingDay(expDate);
    return prev.toISOString().slice(0,10);
  }
  return expDate.toISOString().slice(0,10);
}

function calcMaxPain(rows) {
  let mp = {s:0,pain:Infinity};
  rows.forEach(row=>{
    const pain=rows.reduce((sum,o)=>sum+Math.max(0,row.s-o.s)*o.ce.oi+Math.max(0,o.s-row.s)*o.pe.oi,0);
    if(pain<mp.pain)mp={s:row.s,pain};
  });
  return mp.s;
}

export default async function handler(req, res) {
  // Support dynamic token from frontend (localStorage)
  const headerToken = req.headers['x-upstox-token'];
  if (headerToken && headerToken.startsWith('eyJ')) {
    process.env.UPSTOX_TOKEN = headerToken;
  }
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if(req.method==='OPTIONS')return res.status(200).end();

  const sym=(req.query.sym||'NIFTY').toUpperCase();
  const instrKey=INSTR_MAP[sym];
  if(!instrKey)return res.status(400).json({error:'Unknown: '+sym});

  try {
    // Get expiry - try engine first, then calculate
    let expiry = req.query.expiry;
    if (!expiry) {
      expiry = await getExpiryFromEngine(sym) || calcExpiry(sym);
    }
    console.log(`${sym} expiry: ${expiry}`);

    const url=`https://api.upstox.com/v2/option/chain?instrument_key=${encodeURIComponent(instrKey)}&expiry_date=${expiry}`;
    const r=await fetch(url,{
      headers:{'Authorization':`Bearer ${UPSTOX_TOKEN}`,'Accept':'application/json'},
      signal:AbortSignal.timeout(12000)
    });
    if(r.status===401)return res.status(401).json({error:'Token expired',sim:true});
    if(!r.ok)throw new Error(`Upstox ${r.status}`);
    const d=await r.json();
    if(d.status!=='success'||!d.data?.length)throw new Error('No data: '+(d.message||''));

    const rows=d.data.filter(x=>x.call_options&&x.put_options).map(x=>{
      const ce=x.call_options.market_data||{};
      const pe=x.put_options.market_data||{};
      const ceg=x.call_options.option_greeks||{};
      const peg=x.put_options.option_greeks||{};
      return{
        s:x.strike_price,
        ce:{oi:ce.oi||0,oiChg:(ce.oi||0)-(ce.prev_oi||0),ltp:+(ce.ltp||0).toFixed(2),iv:+(ceg.iv||0).toFixed(1),delta:+(ceg.delta||0).toFixed(3),gamma:+(ceg.gamma||0).toFixed(5)},
        pe:{oi:pe.oi||0,oiChg:(pe.oi||0)-(pe.prev_oi||0),ltp:+(pe.ltp||0).toFixed(2),iv:+(peg.iv||0).toFixed(1),delta:+(peg.delta||0).toFixed(3),gamma:+(peg.gamma||0).toFixed(5)}
      };
    }).sort((a,b)=>a.s-b.s);

    const spot=d.data[0]?.underlying_spot_price||0;
    const totCE=rows.reduce((a,r)=>a+r.ce.oi,0);
    const totPE=rows.reduce((a,r)=>a+r.pe.oi,0);
    const pcr=totCE>0?(totPE/totCE).toFixed(3):'0';
    const maxPain=calcMaxPain(rows);

    res.setHeader('Cache-Control','s-maxage=30');
    return res.json({sym,spot,pcr,maxPain,totCeOI:totCE,totPeOI:totPE,expiry,rows,sim:false,updatedAt:new Date().toISOString()});
  } catch(e) {
    console.error('Options failed:',e.message);
    return res.status(503).json({error:e.message,sym,sim:true});
  }
}
