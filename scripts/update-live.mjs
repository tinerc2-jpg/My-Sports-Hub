// Fetches live data for every team in index.html's DB and writes out/live.json.
// Runs in GitHub Actions (no browser CORS limits); the app falls back to this
// snapshot when it can't reach the sports APIs directly.
// Reuses the app's own fetchers: the code between the live-data markers in index.html.
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";

const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const start=html.indexOf("// ── Live data (auto-updating results)");
const end=html.indexOf("// ── end live data fetchers");
if(start<0||end<0)throw new Error("live-data markers not found in index.html");
const adds=html.split("\n").filter(l=>/^add\(\[/.test(l)).join("\n");

const mem={};
globalThis.localStorage={getItem:k=>k in mem?mem[k]:null,setItem:(k,v)=>{mem[k]=String(v);}};
// Wikimedia asks API clients to identify themselves.
const UA="MySportsHub/1.0 (+https://github.com/tinerc2-jpg/My-Sports-Hub)";
const rawFetch=globalThis.fetch;
globalThis.fetch=(url,opts={})=>rawFetch(url,{...opts,headers:{"User-Agent":UA,...(opts.headers||{})}});
const api=new Function(`const DB={};function add(keys,d){keys.forEach(k=>DB[k.toLowerCase()]=d);}
${adds}
${html.slice(start,end)}
return {DB,fetchTeamLive,_liveLog,teamAliases,nameMatch,norm};`)();

// Previous snapshot: lets us reuse API-Sports standings so we stay within the free quota.
let prev={};
try{
  const r=await fetch(`https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY||"tinerc2-jpg/My-Sports-Hub"}/live-data/live.json`);
  if(r.ok)prev=(await r.json()).teams||{};
}catch(e){}

// ── API-Sports handball standings (key in the APISPORTS_KEY repo secret; never shipped to the app) ──
// Free plan: 100 requests/day. We refresh at most hourly (2 requests: leagues + standings) ≈ 48/day.
const APISPORTS_KEY=process.env.APISPORTS_KEY;
const HB_API="https://v1.handball.api-sports.io";
const HB_TTL=60*60*1000;
async function apiSports(path){
  const r=await fetch(HB_API+path,{headers:{"x-apisports-key":APISPORTS_KEY}});
  const j=await r.json();
  const errs=j.errors?(Array.isArray(j.errors)?j.errors:Object.values(j.errors)):[];
  if(errs.length)throw new Error(errs.join("; "));
  return j.response||[];
}
let hbTable=null,hbError=null;
async function hbTableLoad(){
  if(hbTable)return hbTable;
  if(hbError)throw hbError; // one failed attempt per run is enough (quota)
  try{return await hbTableFetch();}catch(e){hbError=e;throw e;}
}
async function hbTableFetch(){
  const leagues=await apiSports("/leagues?country=Denmark");
  console.log("    API-Sports leagues in Denmark:",leagues.map(l=>`${l.id} ${l.name} (${l.type})`).join(" | ")||"none");
  const men=leagues.filter(l=>!/kvinde|women|dame|female|cup|pokal|1\.|div/i.test(l.name));
  const lg=men.find(l=>/herre|h[aå]ndbold\s*liga|handbold\s*liga/i.test(l.name))||men.find(l=>/liga/i.test(l.name));
  if(!lg)throw new Error("no Danish men's league found");
  const seasons=lg.seasons||[];
  const cur=seasons.find(s=>s.current)||seasons[seasons.length-1];
  if(!cur)throw new Error("no season for "+lg.name);
  const groups=await apiSports(`/standings?league=${lg.id}&season=${encodeURIComponent(cur.season)}`);
  hbTable={league:lg.name,season:cur.season,rows:groups.flat()};
  console.log(`    API-Sports table ${lg.name} ${cur.season}: ${hbTable.rows.length} rows`);
  return hbTable;
}
// Returns {standing, ts, triedTs} or null. Reuses the last snapshot's values within HB_TTL.
async function hbStanding(team){
  const p=prev[team.name]&&prev[team.name].data,now=Date.now();
  if(p&&p.standingFrom==="API-Sports"&&p.standing&&now-(p.standingTs||0)<HB_TTL)
    return{standing:p.standing,ts:p.standingTs,triedTs:p.standingTriedTs};
  if(p&&now-(p.standingTriedTs||0)<HB_TTL) // tried recently and failed: don't burn quota
    return p.standingFrom==="API-Sports"&&p.standing?{standing:p.standing,ts:p.standingTs,triedTs:p.standingTriedTs}:{standing:null,triedTs:p.standingTriedTs};
  try{
    const t=await hbTableLoad(),al=api.teamAliases(team);
    const row=t.rows.find(r=>api.nameMatch(al,[r.team&&r.team.name])===2)||t.rows.find(r=>api.nameMatch(al,[r.team&&r.team.name])>0);
    if(!row){console.log("    API-Sports: team not in table:",t.rows.map(r=>r.team&&r.team.name).join(", "));return{standing:null,triedTs:now};}
    const g=row.games||{},tot=x=>x&&x.total!=null?+x.total:null;
    return{standing:{rank:+row.position,points:row.points!=null?+row.points:null,wins:tot(g.win),draws:tot(g.draw),losses:tot(g.lose)},ts:now,triedTs:now};
  }catch(e){console.log("    API-Sports:",e.message);return{standing:null,triedTs:now};}
}

// ── Danish men's handball table from public web pages (no free API covers the current season) ──
// Tried in order; each page is loaded at most once per run and shared by all teams.
// A row is only used if it adds up: wins+draws+losses = played and points = 2·wins + draws.
const TV2_LEAGUE="Håndboldligaen";
const TABLE_PAGES=[
  {name:"Top Håndbold",url:"https://tophaandbold.dk/stillinger/herreligaen"}, // the league's own site
  {name:"TV 2",url:"https://sport.tv2.dk/haandbold/herreligaen"},
  {name:"GOG",url:"https://www.gog.dk/"},
];
const _pages={};
function tv2Load(page){
  if(_pages[page.url])return _pages[page.url];
  return _pages[page.url]=(async()=>{
    const r=await fetch(page.url,{headers:{"Accept":"text/html","Accept-Language":"da-DK,da;q=0.9"}});
    const html=await r.text();
    // Text from the rendered HTML plus any JSON-ish strings in scripts (e.g. Next.js __next_f payloads).
    const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
    const decoded=scripts.map(s=>s.replace(/\\u([0-9a-f]{4})/gi,(m,h)=>String.fromCharCode(parseInt(h,16))).replace(/\\"/g,'"').replace(/\\n/g," "));
    const strip=s=>s.replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/g," ").replace(/&amp;/g,"&").replace(/[",:{}\[\]]/g," ");
    const text=strip(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g," "))+" "+decoded.map(strip).join(" ");
    const json=[];
    scripts.forEach(s=>{const t=s.trim();if(/^[\[{]/.test(t)){try{json.push(JSON.parse(t));}catch(e){}}});
    const hints=[...new Set((html.match(/https?:\/\/[^"'\s]*(?:stand|tabel|stilling|table)[^"'\s]*/gi)||[]))].slice(0,8);
    console.log(`    ${page.name}: HTTP ${r.status}, ${html.length} bytes, ${scripts.length} scripts, ${json.length} JSON blocks`+(hints.length?", table-ish URLs: "+hints.join(" "):""));
    if(!r.ok)throw new Error("HTTP "+r.status);
    return{text,tokens:text.split(/\s+/).filter(Boolean),json};
  })();
}
function hbValid(r){return r&&[r.played,r.wins,r.draws,r.losses,r.points].every(n=>Number.isInteger(n)&&n>=0)&&r.wins+r.draws+r.losses===r.played&&r.points===2*r.wins+r.draws;}
// Structured: any object in embedded JSON with a matching team name and W/D/L/points-like keys.
function tv2FromJson(json,al){
  const pick=(o,re)=>{const k=Object.keys(o).find(k=>re.test(k));const v=k!=null?o[k]:null;return v&&typeof v==="object"&&"total" in v?+v.total:v!=null&&v!==""?+v:null;};
  let found=null;
  const walk=o=>{
    if(found||!o||typeof o!=="object")return;
    if(Array.isArray(o)){o.forEach(walk);return;}
    const names=Object.values(o).filter(v=>typeof v==="string").concat(Object.values(o).filter(v=>v&&typeof v==="object"&&!Array.isArray(v)).flatMap(v=>Object.values(v).filter(x=>typeof x==="string")));
    if(names.length&&api.nameMatch(al,names)===2){
      const r={rank:pick(o,/^(position|rank|placement|place|pos|placering)$/i),played:pick(o,/^(played|matches|games|kampe|gamesPlayed)$/i),
        wins:pick(o,/^(wins?|won|vundne|vundet)$/i),draws:pick(o,/^(draws?|drawn|ties|uafgjort)$/i),losses:pick(o,/^(loss(es)?|lost|tabte|tabt)$/i),points:pick(o,/^(points|pts|point)$/i)};
      if(hbValid(r)&&r.rank>0){found=r;return;}
    }
    Object.values(o).forEach(walk);
  };
  walk(json);
  return found;
}
// Text: "<rank> <team…> <played> <W> <D> <L> [goals] [diff] <points>" as rendered in the table.
function tv2FromTokens(tokens,al){
  const num=t=>/^[+-]?\d+\.?$/.test(t)?parseInt(t,10):null;
  const seen=[];
  for(let i=0;i<tokens.length;i++){
    const one=api.norm(tokens[i]),two=api.norm(tokens[i]+" "+(tokens[i+1]||""));
    if(!(al.includes(one)||al.includes(two)))continue;
    if(seen.length<3)seen.push(tokens.slice(Math.max(0,i-3),i+14).join(" "));
    let rank=null;for(let k=i-1;k>=Math.max(0,i-3);k--){const n=num(tokens[k]);if(n!=null&&n>0&&n<=20){rank=n;break;}}
    let j=i+1;while(j<tokens.length&&j<i+4&&num(tokens[j])==null)j++;
    const nums=[];
    for(;j<tokens.length&&nums.length<10;j++){
      const t=tokens[j];
      if(/^\d+[-–:]\d+$/.test(t))continue; // goals for–against
      const n=num(t);if(n==null)break;nums.push(n);
    }
    if(nums.length<5)continue;
    const [played,wins,draws,losses]=nums;
    const points=nums.slice(4).find(p=>p===2*wins+draws);
    const r={rank,played,wins,draws,losses,points};
    if(rank&&hbValid(r))return{r,seen};
  }
  return{r:null,seen};
}
// Returns {standing, from} from the first page with a valid row, or null.
async function tv2Standing(team){
  const al=api.teamAliases(team);
  for(const page of TABLE_PAGES){
    try{
      const p=await tv2Load(page);
      let r=null,how="JSON";
      for(const j of p.json){r=tv2FromJson(j,al);if(r)break;}
      if(!r){const t=tv2FromTokens(p.tokens,al);r=t.r;how="text";
        if(!r)console.log(`    ${page.name}: no valid row for ${team.shortName}`+(t.seen.length?" · seen: "+t.seen.map(s=>"«"+s+"»").join(" "):" · name not on page"));}
      if(!r)continue;
      console.log(`    ${page.name} (${how}): #${r.rank} ${r.played} played ${r.wins}-${r.draws}-${r.losses} ${r.points} pts`);
      return{standing:{rank:r.rank,points:r.points,wins:r.wins,draws:r.draws,losses:r.losses},from:page.name};
    }catch(e){console.log(`    ${page.name}:`,e.message);}
  }
  return null;
}

// ── News: Google News RSS search per team (no key). Danish teams get Danish news. ──
// Refreshed at most hourly per team; otherwise the previous snapshot's news is reused.
const NEWS_TTL=60*60*1000;
const SPORT_WORDS={Football:["fodbold","football"],Handball:["håndbold","handball"],Tennis:["tennis","tennis"],Basketball:["basketball","NBA"],
  Golf:["golf","golf"],Cycling:["cykling","cycling"],"Formula 1":["Formel 1","F1"],"Ice Hockey":["ishockey","NHL"],"Am. Football":["NFL","NFL"],
  Rugby:["rugby","rugby"],Baseball:["baseball","MLB"],Volleyball:["volleyball","volleyball"]};
function xmlText(s){
  return String(s||"").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/<[^>]+>/g,"")
    .replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'")
    .replace(/&#(\d+);/g,(m,n)=>String.fromCharCode(+n)).replace(/&amp;/g,"&").trim();
}
async function teamNews(team){
  const p=prev[team.name]&&prev[team.name].data,now=Date.now();
  if(p&&p.news&&p.news.length&&now-(p.newsTs||0)<NEWS_TTL)return{news:p.news,ts:p.newsTs};
  const dk=team.country==="🇩🇰",w=SPORT_WORDS[team.sport]||["",""];
  const names=[...new Set([team.name,team.shortName])].filter(n=>!/\./.test(n)).map(n=>`"${n}"`); // skip "N. Hojgaard"-style short names
  const who=names.length>1?"("+names.join(" OR ")+")":names[0];
  // Google News has no Danish edition (a DK query returns nothing), so Danish teams use Bing News da-DK first.
  const tries=dk
    ?[{name:"Bing da-DK",q:`${who} ${w[0]}`,url:q=>`https://www.bing.com/news/search?format=rss&mkt=da-DK&setlang=da&q=${encodeURIComponent(q)}`},
      {name:"Google en-GB",q:`${who} ${w[0]}`,url:q=>`https://news.google.com/rss/search?hl=en-GB&gl=GB&ceid=GB:en&q=${encodeURIComponent(q+" when:30d")}`}]
    :[{name:"Google en-GB",q:`${who} ${w[1]}`,url:q=>`https://news.google.com/rss/search?hl=en-GB&gl=GB&ceid=GB:en&q=${encodeURIComponent(q+" when:30d")}`}];
  for(const t of tries){
    try{
      const r=await fetch(t.url(t.q),{headers:{"Accept":"application/rss+xml, application/xml, text/xml"}});
      if(!r.ok)throw new Error("HTTP "+r.status);
      const news=parseRss(await r.text());
      console.log(`    news (${t.name}): ${news.length} items for ${t.q}`);
      if(news.length)return{news,ts:now};
    }catch(e){console.log(`    news (${t.name}):`,e.message);}
  }
  return p&&p.news?{news:p.news,ts:p.newsTs}:null;
}
// RSS from Google News (<source>) or Bing News (<News:Source>, links wrapped in a bing.com redirect).
function parseRss(xml){
  const seenT=new Set(),monthAgo=Date.now()-30*864e5;
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m=>{
    const it=m[1],tag=t=>xmlText((it.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`,"i"))||[])[1]);
    const src=tag("source")||tag("News:Source");let title=tag("title"),url=tag("link");
    if(src&&title.endsWith(" - "+src))title=title.slice(0,-(src.length+3));
    if(/bing\.com/.test(url)){try{const u=new URL(url).searchParams.get("url");if(u)url=u;}catch(e){}}
    return{title,url,ts:Date.parse(tag("pubDate"))||null,src};
  }).filter(n=>n.title&&n.ts&&n.ts>monthAgo&&!seenT.has(n.title.toLowerCase())&&seenT.add(n.title.toLowerCase()))
    .sort((a,b)=>b.ts-a.ts).slice(0,5);
}

const teams={},seen=new Set();let ok=0,failed=0;
for(const t of Object.values(api.DB)){
  if(seen.has(t.name))continue;seen.add(t.name);
  api._liveLog.length=0;
  try{
    const data=await api.fetchTeamLive(t);
    if(data&&t.sport==="Handball"){
      if(!APISPORTS_KEY)console.log("    API-Sports: no APISPORTS_KEY secret set");
      else{
        const hb=await hbStanding(t);
        if(hb){
          data.standingTriedTs=hb.triedTs;
          if(hb.standing){
            data.standing=hb.standing;data.standingFrom="API-Sports";data.standingTs=hb.ts;
            data.source=data.source.replace(" + Wikipedia","")+" + API-Sports";
          }
        }
      }
      if(!data.standing&&t.league===TV2_LEAGUE){
        const s=await tv2Standing(t);
        if(s){data.standing=s.standing;data.standingFrom=s.from;data.standingTs=Date.now();data.source=data.source.replace(" + Wikipedia","")+" + "+s.from;}
      }
    }
    const nw=await teamNews(t);
    if(data){
      if(nw){data.news=nw.news;data.newsTs=nw.ts;}
      teams[t.name]={ts:Date.now(),data};ok++;
      const s=data.standing;
      console.log("✓",t.name,"·",data.source,"·",s&&s.rank?"#"+s.rank+(s.points!=null?" "+s.points+" pts":""):"no table");
    }else if(nw){
      teams[t.name]={ts:Date.now(),data:{newsOnly:true,source:"Google News",news:nw.news,newsTs:nw.ts}};
      console.log("·",t.name,"· news only");
    }
  }catch(e){failed++;console.error("✗",t.name,"-",e.message);}
  api._liveLog.forEach(m=>console.log("   ",m));
}
mkdirSync("out",{recursive:true});
writeFileSync("out/live.json",JSON.stringify({generated:Date.now(),teams}));
console.log(`${ok} teams updated, ${failed} failed, ${seen.size-ok-failed} without a live source`);
if(ok===0)process.exit(1);
