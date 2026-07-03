// api/news.js - NewsAPI → GNews → Offline

export const config = { runtime: 'nodejs' };

const CATS = {
  india:  {news:'NIFTY OR NSE OR RBI OR Sensex OR "India stock"', gnews:'NSE NIFTY India stock market'},
  crypto: {news:'Bitcoin OR Ethereum OR crypto OR BTC OR altcoin', gnews:'Bitcoin crypto BTC price'},
  forex:  {news:'forex OR dollar OR "Federal Reserve" OR EURUSD OR Fed', gnews:'forex dollar Fed rate'},
  global: {news:'"stock market" OR inflation OR recession OR earnings', gnews:'global stock market'},
  gold:   {news:'gold price OR XAUUSD OR silver OR commodity', gnews:'gold price XAUUSD'},
};

function timeAgo(iso){
  try{
    const d=Math.floor((Date.now()-new Date(iso).getTime())/1000);
    if(d<60)return d+'s ago';
    if(d<3600)return Math.floor(d/60)+'m ago';
    if(d<86400)return Math.floor(d/3600)+'h ago';
    return Math.floor(d/86400)+'d ago';
  }catch{return 'recent';}
}

function classifyImpact(t,d){
  const s=((t||'')+(d||'')).toLowerCase();
  if(/rbi|fed rate|gdp|crash|nfp|fomc|recession|war|crisis|rate cut|rate hike/i.test(s))return'HIGH';
  if(/earnings|ipo|fii|quarterly|merger|results|profit|listing/i.test(s))return'MED';
  return'LOW';
}

function classifyAsset(t,d){
  const s=((t||'')+(d||'')).toLowerCase();
  if(/nifty|nse|bse|rbi|sensex|rupee/i.test(s))return'NIFTY';
  if(/bitcoin|btc|crypto|ethereum|eth/i.test(s))return'BTC';
  if(/gold|xauusd|silver/i.test(s))return'GOLD';
  if(/forex|dollar|eurusd|gbpusd|fed/i.test(s))return'FOREX';
  return'MARKET';
}

function formatArticles(articles, cat){
  return articles
    .filter(a=>a.title&&a.title!=='[Removed]'&&a.title.length>10)
    .slice(0,12)
    .map((a,i)=>({
      id:`${cat}_${i}_${Date.now()}`,
      title:a.title||'',
      desc:(a.description||a.content||'').slice(0,280),
      time:timeAgo(a.publishedAt||a.published||new Date().toISOString()),
      src:(a.source&&a.source.name)||a.source||'News',
      url:a.url||a.link||'#',
      impact:classifyImpact(a.title,a.description),
      asset:classifyAsset(a.title,a.description)
    }));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if(req.method==='OPTIONS')return res.status(200).end();

  const cat=(req.query.category||'india').toLowerCase();
  const conf=CATS[cat]||CATS.india;

  const NEWS_KEY = process.env.NEWS_API_KEY;
  const GNEWS_KEY = process.env.GNEWS_API_KEY;

  // NewsAPI
  if(NEWS_KEY){
    try{
      const url=`https://newsapi.org/v2/everything?q=${encodeURIComponent(conf.news)}&language=en&sortBy=publishedAt&pageSize=15&apiKey=${NEWS_KEY}`;
      const r=await fetch(url,{signal:AbortSignal.timeout(9000)});
      if(r.ok){
        const d=await r.json();
        if(d.status!=='error'&&d.articles?.length){
          res.setHeader('Cache-Control','s-maxage=120');
          return res.json({articles:formatArticles(d.articles,cat),source:'newsapi',count:d.articles.length});
        }
      }
    }catch(e){console.log('NewsAPI err:',e.message);}
  }

  // GNews
  if(GNEWS_KEY){
    try{
      const url=`https://gnews.io/api/v4/search?q=${encodeURIComponent(conf.gnews)}&lang=en&max=15&sortby=publishedAt&apikey=${GNEWS_KEY}`;
      const r=await fetch(url,{signal:AbortSignal.timeout(9000)});
      if(r.ok){
        const d=await r.json();
        if(d.articles?.length){
          res.setHeader('Cache-Control','s-maxage=120');
          return res.json({articles:formatArticles(d.articles,cat),source:'gnews',count:d.articles.length});
        }
      }
    }catch(e){console.log('GNews err:',e.message);}
  }

  return res.status(503).json({articles:[],source:'offline',error:'News APIs failed. Check NEWS_API_KEY + GNEWS_API_KEY in Vercel env vars.'});
}
