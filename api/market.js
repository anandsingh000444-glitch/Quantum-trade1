export const config = { runtime: 'nodejs' };

const UPSTOX_TOKEN = 'eyJ0eXAiOiJKV1QiLCJrZXlfaWQiOiJza192MS4wIiwiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiI3VkE4TUciLCJqdGkiOiI2YTRiM2NhYjgyMjE5YjVmOTFhNmNlNjEiLCJpc011bHRpQ2xpZW50IjpmYWxzZSwiaXNQbHVzUGxhbiI6ZmFsc2UsImlzRXh0ZW5kZWQiOnRydWUsImlhdCI6MTc4MzMxNTYyNywiaXNzIjoidWRhcGktZ2F0ZXdheS1zZXJ2aWNlIiwiZXhwIjoxODE0OTExMjAwfQ.PthbQKez4K2aOPB73VUtTCZR4ic5IdwrgNEal4vz51U';

const UPSTOX_KEYS = {
  NIFTY:'NSE_INDEX|Nifty 50', BANKNIFTY:'NSE_INDEX|Nifty Bank',
  SENSEX:'BSE_INDEX|SENSEX', FINNIFTY:'NSE_INDEX|Nifty Fin Service',
  MIDCPNIFTY:'NSE_INDEX|NIFTY MID SELECT',
  GOLD:'MCX_FO|GOLD25JUNFUT', SILVER:'MCX_FO|SILVER25JUNFUT',
  CRUDEOIL:'MCX_FO|CRUDEOIL25JUNFUT',
};

const YAHOO_SYMS = {
  NIFTY:'%5ENSEI', BANKNIFTY:'%5ENSEBANK', SENSEX:'%5EBSESN',
  FINNIFTY:'NIFTYFINSERVICE.NS', MIDCPNIFTY:'MIDCPNIFTY.NS',
  GOLD:'GC%3DF', SILVER:'SI%3DF', CRUDEOIL:'CL%3DF',
};

const TWELVE_KEY = '18d87171681a4adea4e95f4175c8294d';
const ALPHA_KEY  = '9YWZWLNKRZS1DMTT';

function isNSEOpen(){
  const ist=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Kolkata'}));
  const d=ist.getDay(),t=ist.getHours()*60+ist.getMinutes();
  return d>=1&&d<=5&&t>=555&&t<=930;
}

async function fromUpstox(sym){
  const key=UPSTOX_KEYS[sym];
  if(!key)throw new Error('No Upstox key');
  const r=await fetch(`https://api.upstox.com/v2/market-quote/quotes?instrument_key=${encodeURIComponent(key)}`,{
    headers:{'Authorization':'Bearer '+UPSTOX_TOKEN,'Accept':'application/json'},
    signal:AbortSignal.timeout(7000)
  });
  if(!r.ok)throw new Error('Upstox '+r.status);
  const d=await r.json();
  if(d.status!=='success')throw new Error('Upstox: '+d.message);
  const q=d.data&&Object.values(d.data)[0];
  if(!q?.last_price)throw new Error('No data');
  const price=+q.last_price, prev=+(q.ohlc?.close||price);
  return{symbol:sym,price,change:+(price-prev).toFixed(2),changePct:+((price-prev)/prev*100).toFixed(3),high:+(q.ohlc?.high||0),low:+(q.ohlc?.low||0),prevClose:prev,source:'upstox',live:true};
}

async function fromYahoo(sym){
  const yahoo=YAHOO_SYMS[sym];
  if(!yahoo)throw new Error('No Yahoo sym');
  for(const base of [`https://query1.finance.yahoo.com/v8/finance/chart/${yahoo}?interval=2m&range=1d`,`https://query2.finance.yahoo.com/v8/finance/chart/${yahoo}?interval=2m&range=1d`]){
    try{
      const r=await fetch(base,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(7000)});
      if(!r.ok)continue;
      const d=await r.json();
      const m=d?.chart?.result?.[0]?.meta;
      if(m?.regularMarketPrice){
        const price=+m.regularMarketPrice,prev=+(m.chartPreviousClose||price);
        return{symbol:sym,price,change:+(price-prev).toFixed(2),changePct:+((price-prev)/prev*100).toFixed(3),high:+(m.regularMarketDayHigh||0),low:+(m.regularMarketDayLow||0),prevClose:prev,source:'yahoo',live:true};
      }
    }catch(e){continue;}
  }
  throw new Error('Yahoo failed');
}

async function fromTwelve(sym){
  const MAP={NIFTY:'NIFTY',BANKNIFTY:'BANKNIFTY',SENSEX:'SENSEX',GOLD:'XAU/USD',SILVER:'XAG/USD'};
  const s=MAP[sym];if(!s)throw new Error('No Twelve sym');
  const r=await fetch(`https://api.twelvedata.com/quote?symbol=${s}&apikey=${TWELVE_KEY}`,{signal:AbortSignal.timeout(7000)});
  if(!r.ok)throw new Error('Twelve '+r.status);
  const d=await r.json();
  if(d.status==='error')throw new Error(d.message);
  const price=+d.close,prev=+d.previous_close||price;
  return{symbol:sym,price,change:+(price-prev).toFixed(2),changePct:+((price-prev)/prev*100).toFixed(3),high:+d.high||0,low:+d.low||0,prevClose:prev,source:'twelve',live:true};
}

export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if(req.method==='OPTIONS')return res.status(200).end();

  const sym=(req.query.symbol||'NIFTY').toUpperCase();
  const nseOpen=isNSEOpen();
  const istTime=new Date().toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour12:false,hour:'2-digit',minute:'2-digit'});

  // 1. Upstox
  try{const d=await fromUpstox(sym);res.setHeader('Cache-Control',nseOpen?'s-maxage=15':'s-maxage=300');return res.json({...d,nseOpen,istTime,updatedAt:new Date().toISOString()});}
  catch(e){console.log('Upstox:',e.message);}

  // 2. Yahoo Finance
  try{const d=await fromYahoo(sym);res.setHeader('Cache-Control',nseOpen?'s-maxage=30':'s-maxage=300');return res.json({...d,nseOpen,istTime,updatedAt:new Date().toISOString()});}
  catch(e){console.log('Yahoo:',e.message);}

  // 3. Twelve Data
  try{const d=await fromTwelve(sym);res.setHeader('Cache-Control',nseOpen?'s-maxage=30':'s-maxage=300');return res.json({...d,nseOpen,istTime,updatedAt:new Date().toISOString()});}
  catch(e){console.log('Twelve:',e.message);}

  return res.status(503).json({error:'All sources failed for '+sym,nseOpen,istTime,live:false});
}
