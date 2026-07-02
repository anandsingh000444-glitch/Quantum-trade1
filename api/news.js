// api/news.js - Multi-source news
// NewsAPI → GNews → Offline

const CATS = {
  india:  {news:'NIFTY OR NSE OR RBI OR Sensex OR "India stock"', gnews:'NSE NIFTY India stock'},
  crypto: {news:'Bitcoin OR Ethereum OR crypto OR BTC', gnews:'Bitcoin crypto BTC'},
  forex:  {news:'forex OR dollar OR "Federal Reserve" OR EURUSD', gnews:'forex dollar Fed'},
  global: {news:'"stock market" OR inflation OR recession', gnews:'stock market global'},
  gold:   {news:'gold price OR XAUUSD OR silver', gnews:'gold price silver'},
};

function ago(iso){
  try{const d=Math.floor((Date.now()-new Date(iso).getTime())/1000);if(d<60)return d+'s ago';if(d<3600)return Math.floor(d/60)+'m ago';if(d<86400)return Math.floor(d/3600)+'h ago';return Math.floor(d/86400)+'d ago';}catch{return 'recent';}
}
function impact(t,d){const s=((t||'')+(d||'')).toLowerCase();if(/rbi|fed rate|gdp|crash|nfp|fomc|recession|war|crisis/i.test(s))return'HIGH';if(/earnings|ipo|fii|quarterly|merger/i.test(s))return'MED';return'LOW';}
function asset(t,d){const s=((t||'')+(d||'')).toLowerCase();if(/nifty|nse|bse|rbi|sensex/i.test(s))return'NIFTY';if(/bitcoin|btc|crypto|ethereum/i.test(s))return'BTC';if(/gold|xauusd|silver/i.test(s))return'GOLD';if(/forex|dollar|eurusd/i.test(s))return'FOREX';return'MARKET';}
function fmt(articles,cat){
  return articles.filter(a=>a.title&&a.title!=='[Removed]'&&a.title.length>10).slice(0,12).map((a,i)=>({
    id:`${cat}_${i}_${Date.now()}`,
    title:a.title||'',
    desc:(a.description||a.content||'').slice(0,250),
    time:ago(a.publishedAt||a.published||new Date().toISOString()),
    src:(a.source&&a.source.name)||a.source||'News',
    url:a.url||a.link||'#',
    impact:impact(a.title,a.description),
    asset:asset(a.title,a.description)
  }));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if(req.method==='OPTIONS')return res.status(200).end();

  const cat=(req.query.category||'india').toLowerCase();
  const conf=CATS[cat]||CATS.india;
  const NEWS_KEY=process.env.NEWS_API_KEY;
  const GNEWS_KEY=process.env.GNEWS_API_KEY;

  // NewsAPI
  if(NEWS_KEY){
    try{
      const r=await fetch(`https://newsapi.org/v2/everything?q=${encodeURIComponent(conf.news)}&language=en&sortBy=publishedAt&pageSize=15&apiKey=${NEWS_KEY}`,{signal:AbortSignal.timeout(9000)});
      if(r.ok){const d=await r.json();if(d.articles?.length){res.setHeader('Cache-Control','s-maxage=120');return res.json({articles:fmt(d.articles,cat),source:'newsapi',count:d.articles.length});}}
    }catch(e){console.log('NewsAPI:',e.message);}
  }

  // GNews
  if(GNEWS_KEY){
    try{
      const r=await fetch(`https://gnews.io/api/v4/search?q=${encodeURIComponent(conf.gnews)}&lang=en&max=15&sortby=publishedAt&apikey=${GNEWS_KEY}`,{signal:AbortSignal.timeout(9000)});
      if(r.ok){const d=await r.json();if(d.articles?.length){res.setHeader('Cache-Control','s-maxage=120');return res.json({articles:fmt(d.articles,cat),source:'gnews',count:d.articles.length});}}
    }catch(e){console.log('GNews:',e.message);}
  }

  return res.status(503).json({articles:[],source:'offline',error:'All news sources failed. Set NEWS_API_KEY + GNEWS_API_KEY in Vercel env vars.'});
}
