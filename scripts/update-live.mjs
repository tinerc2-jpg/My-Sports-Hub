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
const NEWS_V=4; // bump when the news logic changes so older snapshot news isn't reused
// Danish sports feeds, filtered per team by name in the headline (loaded once per run).
const DK_FEEDS=[
  {name:"DR Sporten",url:"https://www.dr.dk/nyheder/service/feeds/sporten"},
];
const _feeds={};
function loadFeed(f){
  return _feeds[f.url]||(_feeds[f.url]=fetch(f.url,{headers:{"Accept":"application/rss+xml, application/xml, text/xml"}})
    .then(r=>{if(!r.ok)throw new Error("HTTP "+r.status);return r.text();})
    .then(x=>{const items=parseRss(x);console.log(`    feed ${f.name}: ${items.length} items`);return items.map(i=>({...i,src:i.src||f.name}));})
    .catch(e=>{console.log(`    feed ${f.name}:`,e.message);return [];}));
}
// "Højgaard" → "hojgaard" so Danish spellings match the DB's ASCII names.
const fold=s=>api.norm(String(s||"").replace(/ø/gi,"o").replace(/æ/gi,"ae"));
function mentions(team,text){
  const t=" "+fold(text)+" ";
  return api.teamAliases(team).map(fold).filter(a=>a.length>=3).some(a=>t.includes(" "+a+" "));
}
async function rssTry(name,url){
  try{
    const r=await fetch(url,{headers:{"Accept":"application/rss+xml, application/xml, text/xml"}});
    if(!r.ok)throw new Error("HTTP "+r.status);
    return parseRss(await r.text());
  }catch(e){console.log(`    news (${name}):`,e.message);return [];}
}
const googleUrl=q=>`https://news.google.com/rss/search?hl=en-GB&gl=GB&ceid=GB:en&q=${encodeURIComponent(q+" when:30d")}`;
async function teamNews(team){
  const p=prev[team.name]&&prev[team.name].data,now=Date.now();
  if(p&&p.newsV===NEWS_V&&p.news&&p.news.length&&now-(p.newsTs||0)<NEWS_TTL)return{news:p.news,ts:p.newsTs};
  const dk=team.country==="🇩🇰",w=SPORT_WORDS[team.sport]||["",""];
  let names=[...new Set([team.name,team.shortName])].filter(n=>!/\./.test(n)); // skip "N. Hojgaard"-style short names
  if(!names.length)names=[team.name];
  const who=names.length>1?"("+names.map(n=>`"${n}"`).join(" OR ")+")":`"${names[0]}"`;
  let items=[];
  if(dk){
    // Google News has no Danish edition, so: Danish feeds + Bing da-DK, both kept only if the headline names the team.
    for(const f of DK_FEEDS){const fi=(await loadFeed(f)).filter(i=>mentions(team,i.title));items.push(...fi);}
    const bing=(await rssTry("Bing da-DK",`https://www.bing.com/news/search?format=rss&mkt=da-DK&setlang=da&q=${encodeURIComponent(who+" "+w[0])}`))
      .filter(i=>mentions(team,i.title));
    items.push(...bing);
    console.log(`    news DK: ${items.length} headlines naming ${team.shortName} (Bing ${bing.length})`);
  }
  if(items.length<3){ // English coverage (use the English sport word: "Vingegaard cykling" finds nothing there)
    // Headline must name the team too: Google also returns results/fixture pages listing other matches.
    const all=await rssTry("Google en-GB",googleUrl(`${who} ${w[1]}`)),g=all.filter(i=>mentions(team,i.title));
    console.log(`    news (Google en-GB): ${g.length}/${all.length} items name the team for ${who} ${w[1]}`);
    items.push(...g);
  }
  const seenT=new Set();
  const news=items.filter(n=>!seenT.has(n.title.toLowerCase())&&seenT.add(n.title.toLowerCase()))
    .sort((a,b)=>b.ts-a.ts).slice(0,5).map(({title,url,ts,src})=>({title,url,ts,src}));
  if(news.length)return{news,ts:now};
  return p&&p.newsV===NEWS_V&&p.news?{news:p.news,ts:p.newsTs}:null;
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
    .sort((a,b)=>b.ts-a.ts);
}

// ── Official World Golf Ranking (the public JSON behind owgr.com; men only) ──
// Loaded once per run. The response shape isn't documented, so we look for any object
// naming the player with a rank-like field, and log the top-level keys if that fails.
let _owgr=null;
function owgrLoad(){
  return _owgr||(_owgr=fetch("https://apiweb.owgr.com/api/owgr/rankings/getRankings?regionId=0&pageSize=1000&pageNumber=1&countryId=0&sortString=Rank+ASC",{headers:{"Accept":"application/json"}})
    .then(async r=>{if(!r.ok)throw new Error("HTTP "+r.status);const j=await r.json();console.log("    OWGR: top-level keys "+Object.keys(j).join(","));return j;})
    .catch(e=>{console.log("    OWGR:",e.message);return null;}));
}
async function owgrStanding(team){
  const j=await owgrLoad();if(!j)return null;
  const al=api.teamAliases(team);let hit=null;const rows=[];
  const walk=o=>{
    if(hit||!o||typeof o!=="object")return;
    if(Array.isArray(o)){o.forEach(walk);return;}
    const pl=o.player&&typeof o.player==="object"?o.player:o;
    const names=[pl.fullName,pl.name,[pl.firstName,pl.lastName].filter(Boolean).join(" ")].filter(Boolean);
    const rank=o.rank??o.ranking??o.currentRank??o.position;
    if(names.length&&rank!=null){rows.push({o,name:names[0]});if(api.nameMatch(al,names)===2){hit=o;return;}}
    Object.values(o).forEach(walk);
  };
  walk(j);
  if(!hit){
    // Spelling variants ("Nicklas"/"Niklas"): same last name and first name starting with the same 2 letters.
    const [first,...rest]=api.norm(team.name).split(" "),last=rest.join(" ");
    const cands=rows.filter(r=>{const n=api.norm(r.name).split(" ");return n.slice(1).join(" ")===last&&n[0].slice(0,2)===first.slice(0,2);});
    if(cands.length===1){hit=cands[0].o;console.log(`    OWGR: matched ${team.name} as "${cands[0].name}"`);}
    else{console.log(`    OWGR: ${team.name} not found`+(rows.length?"; same last name: "+rows.filter(r=>api.norm(r.name).endsWith(" "+last.split(" ").pop())).map(r=>r.name).slice(0,5).join(", "):""));return null;}
  }
  const rank=+(hit.rank??hit.ranking??hit.currentRank??hit.position);
  const pts=hit.pointsAverage??hit.averagePoints??hit.points;
  console.log(`    OWGR: ${team.name} #${rank}`);
  return{rank,points:pts!=null?Math.round(+pts*100)/100:null};
}

// ── Tennis rank outside ESPN's top-150 list: read it from the player's ESPN profile ──
// Field names aren't documented, so look for a rank-like number and log what we saw.
async function espnAthleteRank(id,tour){
  const urls=[`https://site.web.api.espn.com/apis/common/v3/sports/tennis/${tour}/athletes/${id}`,
    `https://sports.core.api.espn.com/v2/sports/tennis/leagues/${tour}/athletes/${id}`];
  for(const u of urls){
    try{
      const r=await fetch(u);if(!r.ok){console.log(`    athlete ${id}: HTTP ${r.status} ${new URL(u).host}`);continue;}
      const j=await r.json();let found=null;const seenKeys=new Set();
      const walk=(o,path)=>{
        if(found||!o||typeof o!=="object")return;
        if(Array.isArray(o)){o.forEach((x,i)=>walk(x,path+"["+i+"]"));return;}
        for(const [k,v] of Object.entries(o)){
          if(/rank/i.test(k))seenKeys.add(path+"."+k+"="+JSON.stringify(v).slice(0,40));
          if(/^(rank|currentRank|ranking|singlesRank)$/i.test(k)&&Number.isFinite(+v)&&+v>0){found=+v;return;}
          if(/rank/i.test(String(o.name||o.type||""))&&k==="value"&&Number.isFinite(+v)&&+v>0){found=+v;return;}
        }
        Object.entries(o).forEach(([k,v])=>walk(v,path+"."+k));
      };
      walk(j,"");
      console.log(`    athlete ${id} (${new URL(u).host}): ${found?"#"+found:"no rank"}`+(seenKeys.size?" · "+[...seenKeys].slice(0,6).join(" "):" · keys "+Object.keys(j).join(",")));
      if(found)return{rank:found,points:null};
    }catch(e){console.log(`    athlete ${id}:`,e.message);}
  }
  return null;
}

// ── Cycling: ProCyclingStats rider page (no free cycling API covers results/rankings) ──
// Reads the UCI World ranking and the latest results table from the public page.
// The page layout isn't documented, so everything found (or not) is logged.
const PCS="https://www.procyclingstats.com/rider/";
function pcsSlug(name){return api.norm(name).replace(/\s+/g,"-");}
const ENT={nbsp:" ",amp:"&",rsaquo:"›",lsaquo:"‹",raquo:"»",laquo:"«",quot:'"',apos:"'",ndash:"–",mdash:"—",hellip:"…"};
const cellText=s=>s.replace(/<[^>]+>/g," ").replace(/&(#\d+|[a-z]+);/gi,(m,e)=>e[0]==="#"?String.fromCharCode(+e.slice(1)):(ENT[e.toLowerCase()]??m)).replace(/\s+/g," ").trim();
async function pcsCycling(team){
  const url=PCS+pcsSlug(team.name);
  try{
    const r=await fetch(url,{headers:{"Accept":"text/html","Accept-Language":"en"}});
    const html=await r.text();
    console.log(`    PCS ${url}: HTTP ${r.status}, ${html.length} bytes`);
    if(!r.ok)return null;
    const text=cellText(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g," "));
    // Ranking: "UCI World <n>" if the page shows it, else PCS's own ranking ("PCS Ranking <n>").
    let rank=null,rankName="UCI World Ranking";
    const m=text.match(/UCI\s*World(?:\s*Ranking)?\s*:?\s*(\d{1,4})\b/i);
    if(m&&+m[1]>0&&+m[1]<5000)rank=+m[1];
    const pm=text.match(/PCS\s*Ranking\s*:?\s*(\d{1,4})\b/i);
    if(!rank&&pm&&+pm[1]>0){rank=+pm[1];rankName="PCS ranking";}
    console.log(`    PCS ranks: UCI ${m?m[1]:"?"}, PCS ${pm?pm[1]:"?"} → using ${rank?rankName+" #"+rank:"none"}`);
    // Results, newest first. Stage races: keep the General classification under the race's
    // name; skip individual stages and other classifications. One-day races: keep as is.
    const year=new Date().getFullYear(),rows=[],raw=[];
    const toDate=t=>{const all=[...String(t||"").matchAll(/(\d{1,2})\.(\d{1,2})/g)];if(!all.length)return null;const x=all[all.length-1];
      const d=new Date(Date.UTC(year,+x[2]-1,+x[1]));if(d.getTime()>Date.now()+864e5)d.setUTCFullYear(year-1);return d;};
    const clean=t=>t.replace(/^\d+\s+(?=Stage|Prologue)/i,"").replace(/\s*\((?:\d\.[A-Za-z0-9]+|WC|NC|CC|Olympic Games)\)/g,"").replace(/\s+\d+(?:\.\d+)?k$/,"").trim();
    let curRace=null,curDate=null;
    for(const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)){
      const cells=[...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c=>cellText(c[1])); // td only: skip header rows
      if(cells.length<2)continue;
      const di=cells.findIndex(c=>/^\d{1,2}\.\d{1,2}/.test(c));
      const ri=cells.findIndex((c,i)=>i!==di&&/^(\d{1,3}|DNF|DNS|OTL|DSQ)$/.test(c));
      const race=cells.filter((c,i)=>i!==di&&i!==ri&&/[A-Za-z]{3}/.test(c)).sort((x,y)=>y.length-x.length)[0];
      if(!race)continue;
      if(raw.length<8)raw.push((di>=0?cells[di]:"-")+"|"+(ri>=0?cells[ri]:"-")+"|"+race.slice(0,40));
      const d=di>=0?toDate(cells[di]):null;
      if(/^\d*\s*(Stage\s*\d|Prologue)/i.test(race))continue;                 // a stage
      if(/(points|mountains?|youth|teams?|young rider|kom|sprint)\s+classification/i.test(race))continue;
      if(/general classification/i.test(race)){
        if(ri>=0&&curRace)rows.push({d:d||curDate,res:cells[ri],race:curRace+" · GC"});
      }else if(ri<0){curRace=clean(race);curDate=d;continue;}                  // stage-race header
      else rows.push({d,res:cells[ri],race:clean(race)});                       // one-day race
      if(rows.length>=5)break;
    }
    rows.sort((x,y)=>(y.d?y.d.getTime():0)-(x.d?x.d.getTime():0));
    console.log(`    PCS rows (raw): ${raw.join(" ; ")}`);
    console.log(`    PCS results: ${rows.length} kept`+(rows[0]?` · latest ${rows[0].res} ${rows[0].race}`:""));
    if(!rank&&!rows.length)return null;
    const fmt=d=>d.toLocaleDateString("en-GB",{day:"numeric",month:"short"});
    return{source:"ProCyclingStats",
      standing:rank?{rank,points:null,note:rankName}:null,
      recentResults:rows.map(x=>{const n=parseInt(x.res,10);return{opponent:x.race,score:isNaN(n)?x.res:(n===1?"Win":"P"+n),label:isNaN(n)?x.res:null,result:n===1?"W":n<=10?"D":"L",date:x.d?fmt(x.d):"",ts:x.d?x.d.getTime():0};}),
      nextGame:{opponent:"No upcoming race found",offTitle:"No race scheduled",date:"Check the race calendar",time:"–",tv:"–"}};
  }catch(e){console.log("    PCS:",e.message);return null;}
}

// ── Rolex Women's World Golf Rankings (public page; read like the handball tables) ──
const ROLEX_PAGE={name:"Rolex Rankings",url:"https://www.rolexrankings.com/rankings"};
async function rolexStanding(team){
  try{
    const p=await tv2Load(ROLEX_PAGE),al=api.teamAliases(team),tk=p.tokens;
    const isInt=t=>/^\d{1,4}\.?$/.test(t),isDec=t=>/^\d+[.,]\d+$/.test(t);
    for(let i=0;i<tk.length;i++){
      const hit=[1,2,3].some(n=>al.includes(api.norm(tk.slice(i,i+n).join(" "))));
      if(!hit)continue;
      let rank=null;for(let k=i-1;k>=Math.max(0,i-6);k--)if(isInt(tk[k])){rank=parseInt(tk[k],10);break;}
      let pts=null;for(let k=i+1;k<Math.min(tk.length,i+10);k++)if(isDec(tk[k])){pts=parseFloat(tk[k].replace(",","."));break;}
      console.log(`    Rolex: «${tk.slice(Math.max(0,i-6),i+10).join(" ")}»`);
      if(rank&&rank<=2000)return{rank,points:pts};
    }
    console.log(`    Rolex: ${team.name} not found on page`);
  }catch(e){console.log("    Rolex:",e.message);}
  return null;
}

const teams={},seen=new Set();let ok=0,failed=0;
for(const t of Object.values(api.DB)){
  if(seen.has(t.name))continue;seen.add(t.name);
  api._liveLog.length=0;
  try{
    let data=await api.fetchTeamLive(t);
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
    if(data&&(t.sport==="Tennis"||t.sport==="Golf")){
      // ESPN only shows this week's events: keep earlier results from the previous snapshot.
      const pr=(prev[t.name]&&prev[t.name].data&&prev[t.name].data.recentResults)||[];
      const seenR=new Set(),merged=[...(data.recentResults||[]),...pr.filter(r=>r.ts)]
        .filter(r=>{const k=r.opponent+"|"+r.date;return !seenR.has(k)&&seenR.add(k);}).sort((a,b)=>b.ts-a.ts).slice(0,5);
      if(merged.length)data.recentResults=merged;
      if(t.sport==="Tennis"){
        const pd=prev[t.name]&&prev[t.name].data;
        data.athleteId=data.athleteId||(pd&&pd.athleteId)||null; // remember the id in weeks without a match
        if(!data.standing&&data.athleteId){const s=await espnAthleteRank(data.athleteId,/wta/i.test(t.league)?"wta":"atp");if(s)data.standing=s;}
      }
      if(t.sport==="Golf"&&!data.standing){
        const women=/LPGA|LET/.test(t.league);
        const s=women?await rolexStanding(t):await owgrStanding(t);
        if(s){data.standing=s;data.source+=women?" + Rolex Rankings":" + OWGR";}
      }
    }
    if(!data&&t.sport==="Cycling")data=await pcsCycling(t);
    const nw=await teamNews(t);
    if(data){
      if(nw){data.news=nw.news;data.newsTs=nw.ts;data.newsV=NEWS_V;}
      teams[t.name]={ts:Date.now(),data};ok++;
      const s=data.standing;
      console.log("✓",t.name,"·",data.source,"·",s&&s.rank?"#"+s.rank+(s.points!=null?" "+s.points+" pts":""):"no table");
    }else if(nw){
      teams[t.name]={ts:Date.now(),data:{newsOnly:true,source:"News",news:nw.news,newsTs:nw.ts,newsV:NEWS_V}};
      console.log("·",t.name,"· news only");
    }
  }catch(e){failed++;console.error("✗",t.name,"-",e.message);}
  api._liveLog.forEach(m=>console.log("   ",m));
}
mkdirSync("out",{recursive:true});
writeFileSync("out/live.json",JSON.stringify({generated:Date.now(),teams}));
console.log(`${ok} teams updated, ${failed} failed, ${seen.size-ok-failed} without a live source`);
if(ok===0)process.exit(1);
