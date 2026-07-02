// api/market.js - Live NSE/market data via Yahoo Finance
// Server-side call = no CORS issue

const SYMBOLS = {
  NIFTY:'%5ENSEI', BANKNIFTY:'%5ENSEBANK', SENSEX:'%5EBSESN',
  FINNIFTY:'NIFTYFINSERVICE.NS', MIDCPNIFTY:'MIDCPNIFTY.NS',
  GOLD:'GC%3DF', SILVER:'SI%3DF', CRUDEOIL:'CL%3DF',
};

function isNSEOpen(){
  const ist=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Kolkata'}));
  const d=ist.getDay(),t=ist.getHours()*60+ist.getMinutes();
  return d>=1&&d<=5&&t>=555&&t<=930;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if(req.method==='OPTIONS')return res.status(200).end();

  const sym=(req.query.symbol||'NIFTY').toUpperCase();
  const yahoo=SYMBOLS[sym];
  if(!yahoo)return res.status(400).json({error:'Unknown symbol: '+sym});

  const nseOpen=isNSEOpen();
  const istTime=new Date().toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour12:false,hour:'2-digit',minute:'2-digit'});

  const urls=[
    `https://query1.finance.yahoo.com/v8/finance/chart/${yahoo}?interval=2m&range=1d`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${yahoo}?interval=2m&range=1d`,
  ];

  for(const url of urls){
    try{
      const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(7000)});
      if(!r.ok)continue;
      const d=await r.json();
      const m=d?.chart?.result?.[0]?.meta;
      if(m?.regularMarketPrice){
        const price=+m.regularMarketPrice;
        const prev=+(m.chartPreviousClose||price);
        const change=+(price-prev).toFixed(2);
        const changePct=+((change/prev)*100).toFixed(3);
        res.setHeader('Cache-Control',nseOpen?'s-maxage=15':'s-maxage=300');
        return res.json({symbol:sym,price,change,changePct,high:m.regularMarketDayHigh||0,low:m.regularMarketDayLow||0,prevClose:prev,nseOpen,istTime,source:'yahoo',updatedAt:new Date().toISOString()});
      }
    }catch(e){console.log('Yahoo fetch error:',e.message);}
  }

  return res.status(503).json({error:'Market data unavailable for '+sym,nseOpen,istTime});
                          }
