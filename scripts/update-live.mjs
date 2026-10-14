// Fetches live data for every team in index.html's DB and writes out/live.json.
// Runs in GitHub Actions (no browser CORS limits); the app falls back to this
// snapshot when it can't reach the sports APIs directly.
// Reuses the app's own fetchers: the code between the live-data markers in index.html.
import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync} from "node:fs";

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
return {DB,fetchTeamLive,fetchEspnSummary,_liveLog,teamAliases,nameMatch,norm};`)();

// Previous snapshot: lets us reuse API-Sports standings so we stay within the free quota.
// --live: quick re-run inside the same Actions job (see the workflow's live loop). It starts from this
// job's own out/live.json and only re-fetches teams that are playing or about to.
const LIVE=process.argv.includes("--live");
const NOW=Date.now();
function needsLive(e){const d=e&&e.data,k=d&&d.nextGame&&d.nextGame.ts;return !!(d&&(d.liveGame||(k&&NOW>k-15*60e3&&NOW<k+150*60e3)));}
let prev={};
let prevExtra=null;
if(LIVE&&existsSync("out/live.json")){const j=JSON.parse(readFileSync("out/live.json","utf8"));prev=j.teams||{};prevExtra=j.leagueTeams||[];}
else try{
  // the API has no CDN cache (raw.githubusercontent can be ~5 min old); raw file as fallback
  const repo=process.env.GITHUB_REPOSITORY||"tinerc2-jpg/My-Sports-Hub";
  let r=await fetch(`https://api.github.com/repos/${repo}/contents/live.json?ref=live-data`,{headers:{Accept:"application/vnd.github.raw"}});
  if(!r.ok)r=await fetch(`https://raw.githubusercontent.com/${repo}/live-data/live.json`);
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
// Whole table from the page text: every "<rank> <name…> <P> <W> <D> <L> [goals] [diff] <points>" row that
// passes the same checks as the team's own row. Used only when it looks like a full table with our team in it.
function hbTableFromTokens(tokens,al){
  const num=t=>/^[+-]?\d+\.?$/.test(t)?parseInt(t,10):null,rows={};
  for(let i=0;i<tokens.length;i++){
    const rank=num(tokens[i]);if(rank==null||rank<1||rank>20||rows[rank])continue;
    let j=i+1;const name=[];
    while(j<tokens.length&&name.length<5&&num(tokens[j])==null&&!/^\d+[-–:]\d+$/.test(tokens[j]))name.push(tokens[j++]);
    if(!name.length)continue;
    const nums=[];let gd;
    for(;j<tokens.length&&nums.length<10;j++){
      const g=/^(\d+)[-–:](\d+)$/.exec(tokens[j]);if(g){gd=+g[1]-+g[2];continue;}
      const n=num(tokens[j]);if(n==null)break;nums.push(n);
    }
    if(nums.length<5)continue;
    const [played,wins,draws,losses]=nums,points=nums.slice(4).find(p=>p===2*wins+draws);
    if(!hbValid({played,wins,draws,losses,points}))continue;
    const n=name.join(" ");
    rows[rank]={r:rank,n,p:played,w:wins,d:draws,l:losses,gd,pts:points,me:api.nameMatch(al,[n])===2?1:undefined};
  }
  const list=Object.values(rows).sort((a,b)=>a.r-b.r);
  return list.length>=8&&list.some(r=>r.me)?list:null;
}
// Results + next game from the league's match programme (tophaandbold.dk/kampprogram/herreligaen).
// The page text has rows like "25-08-26 19:30 Skjern Håndbold 29-35 GOG … Livescore Hent Kamprapport";
// future games have no score. Team names are matched against the names in the league table
// (same site), so "GOG" vs "GOG Dame Elite" etc. can't be confused.
const HB_PROGRAM="https://tophaandbold.dk/kampprogram/herreligaen";
let _hbProgram=null;
// Page text, with " #M<id># " markers where a row links to /match/<id>, so each game keeps its id.
function hbProgramText(){
  return _hbProgram||(_hbProgram=fetch(HB_PROGRAM,{headers:{"Accept":"text/html","Accept-Language":"da-DK,da;q=0.9"}})
    .then(r=>{if(!r.ok)throw new Error("HTTP "+r.status);return r.text();})
    .then(h=>h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g," ").replace(/<a[^>]*href="[^"]*\/match\/(\d+)[^"]*"[^>]*>/g," #M$1# ")
      .replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/g," ").replace(/&amp;/g,"&").replace(/\s+/g," "))
    .catch(e=>{console.log("    programme: "+e.message);return "";}));
}
const TV_RE=/TV ?2(?: Sport| Play| News)?|TV3(?: Sport| MAX|\+)?|Viaplay|DR ?[12]?(?:TV)?|HBO Max|Max|Discovery\+|Kanal \d/;
// Danish wall-clock time → Date (CET/CEST).
function cphDate(d,mo,y,hh,mm){
  const guess=Date.UTC(y,mo-1,d,hh,mm);
  const f=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Copenhagen",hour:"2-digit",minute:"2-digit",hourCycle:"h23",day:"2-digit"});
  const parts=Object.fromEntries(f.formatToParts(new Date(guess)).map(p=>[p.type,p.value]));
  let off=(+parts.hour*60+ +parts.minute)-(hh*60+mm);if(+parts.day!==d)off+=off<0?1440:-1440;
  return new Date(guess-off*60000);
}
// Handball match statistics from tophaandbold.dk/match/<id>.json: score, halftime, arena, spectators,
// top scorers and per-team event counts (goals, saves, 2-min suspensions …) from the event list.
// tophaandbold.dk event names (Danish) → shown stats. A shot event belongs to the shooting team;
// a saved shot counts as a save for the keeper's team.
const HB_V=3; // bump when hbMatchStats changes, so stats in the previous snapshot are recomputed
const HB_GOAL=/^(Mål|Straffemål)$/,HB_SAVED=/^(Skud reddet|Straffe reddet)$/,HB_MISS=/^(Skud på stolpe|Skud forbi|Skud blokeret)$/;
async function hbMatchStats(id,team){
  const r=await fetch("https://tophaandbold.dk/match/"+id+".json");
  if(!r.ok)throw new Error("HTTP "+r.status);
  const j=await r.json(),al=api.teamAliases(team);
  const ts=j.teams||[],me=ts.find(t=>api.nameMatch(al,[t.name,t.short_name])===2),op=ts.find(t=>t!==me);
  if(!me||!op)return null;
  const idOf=x=>x&&typeof x==="object"?x.id:x,players={};(j.players||[]).forEach(p=>{players[p.id]=p;});
  const typeName=e=>{const t=e.event_type;return String(t&&typeof t==="object"?(t.name||t.title||t.key||t.id):t||"").trim();};
  const z=()=>({me:0,op:0}),c={goals:z(),pen:z(),shots:z(),saves:z(),susp:z(),turn:z(),warn:z()},scorers={},types={};
  const sideOf=tm=>tm==me.id?"me":tm==op.id?"op":null,other=s=>s==="me"?"op":"me";
  (j.events||[]).forEach(e=>{
    const ty=typeName(e),side=sideOf(idOf(e.team));if(!ty)return;
    types[ty]=(types[ty]||0)+1;if(!side)return;
    if(HB_GOAL.test(ty)){
      c.goals[side]++;c.shots[side]++;if(ty==="Straffemål")c.pen[side]++;
      const p=players[idOf(e.player)],who=p&&p.name;if(who){const k=side+"|"+who;scorers[k]=(scorers[k]||0)+1;}
    }else if(HB_SAVED.test(ty)){
      c.shots[side]++;
      const kp=players[idOf(e.keeper)],ks=kp&&sideOf(idOf(kp.team));c.saves[ks||other(side)]++;
    }else if(HB_MISS.test(ty))c.shots[side]++;
    else if(ty==="Udvisning")c.susp[side]++;
    else if(ty==="Fejlaflevering"||ty==="Tabt bold"||ty==="Regelfejl")c.turn[side]++;
    else if(ty==="Advarsel")c.warn[side]++;
  });
  const pct=s=>c.shots[s]?Math.round(c.goals[s]/c.shots[s]*100)+"%":"–";
  const row=(label,k)=>({label,me:String(c[k].me),op:String(c[k].op)});
  const stats=[row("Goals","goals"),row("Shots","shots"),{label:"Shooting %",me:pct("me"),op:pct("op")},row("7m goals","pen"),row("Saves","saves"),
    row("2-min suspensions","susp"),row("Turnovers & faults","turn"),row("Yellow cards","warn")].filter(x=>x.me!=="0"||x.op!=="0");
  const top=Object.entries(scorers).map(([k,n])=>{const [side,who]=k.split("|");return{who,n,me:side==="me"?1:0};})
    .sort((a,b)=>b.n-a.n).filter((x,i,arr)=>arr.filter(y=>y.me===x.me).indexOf(x)<4);
  const meHome=ts.indexOf(me)===0;
  // home–away order, like the score line in the app's match view
  const info=[j.halftime_score?"Half-time "+String(j.halftime_score).replace("-","–"):"",j.arena&&j.arena.name,j.spectators?j.spectators.toLocaleString("en-GB")+" spectators":""].filter(Boolean).join(" \xB7 ");
  // sanity check against the official score
  const [sh,sa]=String(j.score||"").split("-").map(Number),want=meHome?[sh,sa]:[sa,sh];
  if(!_hbTypesLogged){_hbTypesLogged=true;console.log("    handball event types: "+Object.entries(types).map(([t,n])=>t+"="+n).join(", "));}
  console.log(`    handball stats ${id}: goals ${c.goals.me}-${c.goals.op} vs score ${want.join("-")}, saves ${c.saves.me}-${c.saves.op}`);
  return{v:HB_V,meName:me.name,opName:op.name,stats,top,info,goals:[]};
}
let _hbTypesLogged=false;
async function hbProgramFor(team,tableNames){
  const text=await hbProgramText();if(!text)return null;
  const names=[...new Set(tableNames)].sort((a,b)=>b.length-a.length);
  const al=api.teamAliases(team),isMe=n=>api.nameMatch(al,[n])===2;
  const re=/(\d\d)-(\d\d)-(\d\d) (\d\d):(\d\d) /g,starts=[];let m;
  while((m=re.exec(text)))starts.push({i:m.index,end:re.lastIndex,m});
  const games=[];
  starts.forEach((st,k)=>{
    const seg=text.slice(st.end,k+1<starts.length?starts[k+1].i:st.end+300);
    // the two team names in order of appearance
    const found=[];names.forEach(n=>{let p=seg.indexOf(n);while(p>=0){if(!found.some(f=>p<f.p+f.n.length&&f.p<p+n.length))found.push({n,p});p=seg.indexOf(n,p+1);}});
    found.sort((a,b)=>a.p-b.p);
    if(found.length<2)return;
    const [hm,aw]=found;
    const between=seg.slice(hm.p+hm.n.length,aw.p),sc=/(\d{1,2})\s*[-–]\s*(\d{1,2})/.exec(between);
    const after=seg.slice(aw.p+aw.n.length),tv=TV_RE.exec(after),mid=/#M(\d+)#/.exec(seg);
    const [,dd,mo,yy,hh,mi]=st.m;
    games.push({d:cphDate(+dd,+mo,2000+ +yy,+hh,+mi),home:hm.n,away:aw.n,hs:sc?+sc[1]:null,as:sc?+sc[2]:null,tv:tv?tv[0]:"",mid:mid?mid[1]:null});
  });
  const mine=games.filter(g=>isMe(g.home)||isMe(g.away));
  console.log(`    programme: ${games.length} games, ${mine.length} for ${team.shortName}`+(mine[0]?" · e.g. "+JSON.stringify(mine[0]):""));
  if(!mine.length)return null;
  const now=Date.now();
  // A game that started in the last 2½ hours may still be on: ask its match JSON.
  let live=null;
  for(const g of mine.filter(g=>g.mid&&g.d.getTime()<now+5*60e3&&g.d.getTime()>now-150*60e3)){
    try{
      const j=await (await fetch("https://tophaandbold.dk/match/"+g.mid+".json")).json();
      const st=String(j.status||""),finished=/finish|ended|slut|afslut|done|played|complete/i.test(st)||(/^60:00/.test(j.time||"")&&!j.time_running);
      console.log(`    handball live check ${g.mid}: status "${st}", time ${j.time}, running ${j.time_running}, score ${j.score}`);
      if(finished)continue;
      const started=j.time_running||(j.time&&j.time!=="00:00.00")||g.d.getTime()<now;
      if(!started)continue;
      const [hs,as]=String(j.score||"0-0").split("-").map(Number),home=isMe(g.home),min=parseInt(String(j.time||"0"),10);
      live={opponent:(home?g.away:g.home)+(home?" (H)":" (A)"),score:(home?hs+"–"+as:as+"–"+hs),
        detail:/pause|halvleg|half/i.test(st)?"Half-time":min?min+"'":"Live",mid:g.mid};
      g.hs=null; // not a result yet
    }catch(e){console.log("    handball live check: "+e.message);}
  }
  const done=mine.filter(g=>g.hs!=null&&g.d.getTime()<now&&(!live||g.mid!==live.mid)).sort((a,b)=>b.d-a.d);
  const next=mine.filter(g=>g.hs==null&&g.d.getTime()>now-3*3600e3).sort((a,b)=>a.d-b.d)[0];
  const view=g=>{const home=isMe(g.home),ms=home?g.hs:g.as,os=home?g.as:g.hs;return{opp:(home?g.away:g.home)+(home?" (H)":" (A)"),ms,os};};
  const fmtS=d=>d.toLocaleDateString("en-GB",{day:"numeric",month:"short",timeZone:"Europe/Copenhagen"});
  return{liveGame:live,
    recentResults:done.slice(0,5).map(g=>{const v=view(g);return{opponent:v.opp,score:v.ms+"–"+v.os,result:v.ms>v.os?"W":v.ms<v.os?"L":"D",date:fmtS(g.d),ts:g.d.getTime(),hbm:g.mid||undefined,home:isMe(g.home)?1:0};}),
    nextGame:next?{opponent:view(next).opp,date:next.d.toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short",timeZone:"Europe/Copenhagen"}),
      time:next.d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/Copenhagen"}),tv:next.tv||"–",ts:next.d.getTime()}:null,
  };
}
// ── EHF (eurohandball.com): European club games — live score, results, next game ──
// The site's live-score feed lists the EHF competitions' games for the days around today:
// days[].liveScoreMatches[] = {match:{matchID,competitionShortName,homeTeam,guestTeam,url}, homeStats:{totalGoals},
// guestStats:{totalGoals}, matchStats:{time,startTime (CET/CEST),phase,state,isLive}}.
const EHF_FEED="https://www.eurohandball.com/umbraco/api/livescoreapi/GetLiveScoreMatches/1069";
let _ehfFeed=null,_ehfLogged=0;
function ehfFeed(){
  return _ehfFeed||(_ehfFeed=fetch(EHF_FEED,{headers:{Accept:"application/json"}})
    .then(r=>{if(!r.ok)throw new Error("HTTP "+r.status);return r.json();})
    .then(j=>{const ms=[];(j.days||[]).forEach(d=>(d.liveScoreMatches||[]).forEach(x=>ms.push({...x,day:d.dayDatumFormatted||String(d.date).slice(0,10)})));
      console.log(`    EHF feed: days ${(j.days||[]).map(d=>d.dayDatumFormatted).join(",")} · ${ms.length} games`);return ms;})
    .catch(e=>{console.log("    EHF feed: "+e.message);return [];}));
}
const fmtDK=(d,o)=>d.toLocaleDateString("en-GB",{...o,timeZone:"Europe/Copenhagen"});
async function ehfFor(team){
  const ms=await ehfFeed(),al=api.teamAliases(team);
  const isMe=t=>!!t&&api.nameMatch(al,[t.fullName,t.shortName,t.name].filter(Boolean))===2;
  const out={live:null,results:[],next:null},now=Date.now();
  for(const x of ms){
    const m=x.match||{},h=m.homeTeam,g=m.guestTeam||m.awayTeam;
    if(!(isMe(h)||isMe(g)))continue;
    const home=isMe(h),opp=home?g:h,st=x.matchStats||{};
    const [y,mo,d]=String(x.day).split("-").map(Number),[hh,mi]=String(st.startTime||"12:00").split(":").map(Number);
    const when=cphDate(d,mo,y,hh||0,mi||0);
    const hg=(x.homeStats||{}).totalGoals,gg=(x.guestStats||{}).totalGoals,me=home?hg:gg,op=home?gg:hg;
    const tag=String(m.competitionShortName||"EHF").replace(/\s*-\s*[MW]$/,"");
    const name=((opp&&opp.fullName)||"?")+(home?" (H)":" (A)")+" \xB7 "+tag;
    if(_ehfLogged++<4)console.log("    EHF game: "+JSON.stringify({day:x.day,matchStats:st,hg,gg,home:h&&h.fullName,guest:g&&g.fullName}));
    if(st.isLive){
      const min=parseInt(String(st.time||""),10);
      out.live={opponent:name,score:(me??0)+"–"+(op??0),detail:/half.?time|pause|^ht$/i.test(String(st.phase||""))?"Half-time":min?min+"'":String(st.phase||"Live")};
    }else if(me!=null&&op!=null&&when.getTime()<now)
      out.results.push({opponent:name,score:me+"–"+op,result:me>op?"W":me<op?"L":"D",date:fmtDK(when,{day:"numeric",month:"short"}),ts:when.getTime()});
    else if(when.getTime()>now-3*3600e3&&(!out.next||when<out.next.d))out.next={d:when,name};
  }
  return out;
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
      const table=hbTableFromTokens(p.tokens,al);
      console.log(`    ${page.name} (${how}): #${r.rank} ${r.played} played ${r.wins}-${r.draws}-${r.losses} ${r.points} pts · full table: ${table?table.length+" rows":"not found"}`);
      return{standing:{rank:r.rank,points:r.points,wins:r.wins,draws:r.draws,losses:r.losses,table:table||undefined},from:page.name};
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
  let names=[...new Set([team.name,team.shortName])].filter(n=>!/\./.test(n)); // skip "N. Højgaard"-style short names
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
      if(/^\d*\s*(Stage\s*\d|Prologue)/i.test(race)){                          // a stage:
        // abandoning means no GC row, so show the race as DNF/DNS/OTL (once per race)
        if(ri>=0&&/^(DNF|DNS|OTL|DSQ)$/.test(cells[ri])&&curRace&&!rows.some(r=>r.race.startsWith(curRace)))
          rows.push({d:d||curDate,res:cells[ri],race:curRace});
        continue;
      }
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

// Whole leagues from ESPN's team list (so promoted clubs appear by themselves). Clubs already in DB are
// skipped; the rest are added as plain entries, fetched like DB teams and listed in live.json's
// leagueTeams, which the app uses for searching / adding.
const LEAGUE_TEAMS=[{sp:"soccer",lg:"den.1",league:"Superliga",country:"🇩🇰"}];
// ESPN gives many clubs black/white (or no) colours and some names in another form: club colours / names here.
const CLUB_STYLE={
  "F.C. København":{name:"FC København",color:"#1c3f94",accent:"#9fb8e8"},"Brøndby IF":{color:"#f2c500",accent:"#1d3c8f"},
  "FC Midtjylland":{color:"#c8102e",accent:"#111111"},"AGF":{color:"#1e5fa8",accent:"#9cc3ef"},"AC Horsens":{color:"#e8b400",accent:"#111111"},
  "Lyngby Boldklub":{color:"#004b9b",accent:"#7fb2ea"},"Odense Boldklub":{shortName:"OB",color:"#0055a5",accent:"#8ec0f0"},
  "Randers FC":{color:"#1f78c8",accent:"#81c0ff"},"Silkeborg IF":{color:"#d71920",accent:"#7a0f14"},"Sønderjyske Fodbold":{color:"#3a8fd6",accent:"#0d2f63"},
  "Viborg FF":{color:"#00843d",accent:"#0b3d22"},"FC Nordsjælland":{color:"#cf010e",accent:"#ff9f1a"},
  "Vejle Boldklub":{color:"#c8102e",accent:"#111111"},"FC Fredericia":{color:"#c8102e",accent:"#1d3360"},"Aalborg BK":{shortName:"AaB",color:"#c8102e",accent:"#ffffff"},
};
// the app appends alpha to colours ("#rrggbbcc"), so they must be #rrggbb
function hslHex(h,sat,l){sat/=100;l/=100;const k=n=>(n+h/30)%12,a=sat*Math.min(l,1-l),f=n=>l-a*Math.max(-1,Math.min(k(n)-3,9-k(n),1));
  return "#"+[f(0),f(8),f(4)].map(x=>Math.round(x*255).toString(16).padStart(2,"0")).join("");}
async function leagueTeams(){
  const out=[],dbNames=Object.values(api.DB).map(d=>d.name);
  for(const L of LEAGUE_TEAMS){
    try{
      const r=await fetch(`https://site.api.espn.com/apis/site/v2/sports/${L.sp}/${L.lg}/teams?limit=200`);
      if(!r.ok)throw new Error("HTTP "+r.status);
      const raw=((((await r.json()).sports||[])[0]||{}).leagues||[])[0]?.teams||[];
      let added=0;
      for(const {team:t} of raw){
        if(!t||!t.displayName)continue;
        const al=[t.displayName,t.shortDisplayName,t.name].filter(Boolean).map(api.norm);
        if(dbNames.some(n=>api.nameMatch(al,[n])===2))continue;
        // no colour, or black/white (unreadable as a card background): a colour made from the name
        const hex=c=>/^[0-9a-f]{6}$/i.test(c||"")&&!/^(000000|ffffff)$/i.test(c)?"#"+c:null;
        const hue=[...t.displayName].reduce((a,ch)=>(a*31+ch.charCodeAt(0))%360,7),st=CLUB_STYLE[t.displayName]||{};
        out.push({name:st.name||t.displayName,shortName:st.shortName||(st.name?st.name.replace(/^FC /,""):null)||t.shortDisplayName||t.name||t.displayName,sport:"Football",league:L.league,country:L.country,
          color:st.color||hex(t.color)||hslHex(hue,60,40),accent:st.accent||hex(t.alternateColor)||hslHex((hue+40)%360,60,25),emoji:"⚽",
          standing:{rank:null,points:null,wins:null,draws:null,losses:null},recentResults:[],nextGame:null,news:[]});
        added++;
      }
      console.log(`league ${L.league}: ${raw.length} clubs, ${added} added (${out.slice(-added).map(t=>t.shortName).join(", ")})`);
    }catch(e){console.log(`league ${L.league}: ${e.message}`);}
  }
  return out;
}
const extraTeams=LIVE?Object.values(prevExtra||{}):await leagueTeams();
const teams={},seen=new Set();let ok=0,failed=0;
let skipped=0;
for(const t of [...Object.values(api.DB),...extraTeams]){
  if(seen.has(t.name))continue;seen.add(t.name);
  if(LIVE&&!needsLive(prev[t.name])){if(prev[t.name]){teams[t.name]=prev[t.name];ok++;}skipped++;continue;}
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
      // League results and next game from the match programme (TheSportsDB's free key has only a few games).
      const tbl=data.standing&&data.standing.table;
      if(t.league===TV2_LEAGUE&&tbl){
        const pg=await hbProgramFor(t,tbl.map(r=>r.n));
        if(pg){
          const seenR=new Set();
          data.recentResults=[...pg.recentResults,...(data.recentResults||[])].filter(r=>{const k=r.date+"|"+(r.opponent||"").split(" (")[0].slice(0,4);return !seenR.has(k)&&seenR.add(k);}).sort((a,b)=>(b.ts||0)-(a.ts||0)).slice(0,5);
          // keep a sooner non-league game (e.g. European cup from TheSportsDB) if there is one
          if(pg.nextGame&&!(data.nextGame&&data.nextGame.ts&&data.nextGame.ts<pg.nextGame.ts))data.nextGame=pg.nextGame;
          if(!/Top Håndbold/.test(data.source))data.source+=" + Top Håndbold";
          if(pg.liveGame)data.liveGame=pg.liveGame;
          data.preferSnapshot=true; // the app's own handball source (TheSportsDB) has far less: use this file
        }
      }
    }
    if(data&&t.sport==="Handball"){
      // European club games (EHF Champions/European League): live score, results, next game.
      const eh=await ehfFor(t);
      if(eh.live){data.liveGame=eh.live;console.log("    EHF live: "+eh.live.score+" "+eh.live.detail);}
      if(eh.results.length)data.recentResults=[...eh.results,...(data.recentResults||[])].sort((a,b)=>(b.ts||0)-(a.ts||0)).slice(0,5);
      if(eh.next){
        const n=data.nextGame,ts=eh.next.d.getTime();
        // the EHF's own date beats TheSportsDB's; keep a sooner league game
        if(!n||!n.ts||ts<=n.ts+6*3600e3)data.nextGame={opponent:eh.next.name,date:fmtDK(eh.next.d,{weekday:"short",day:"numeric",month:"short"}),
          time:eh.next.d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/Copenhagen"}),tv:"–",ts};
      }
      data.preferSnapshot=true;
    }
    if(data&&(t.sport==="Tennis"||t.sport==="Golf"||t.sport==="Handball")){
      // ESPN only shows this week's events (TheSportsDB's free key only the latest handball game):
      // keep earlier results from the previous snapshot.
      const pr=(prev[t.name]&&prev[t.name].data&&prev[t.name].data.recentResults)||[];
      // handball: TheSportsDB and the league site spell clubs differently, so compare date + start of the name
      const key=r=>t.sport==="Handball"?r.date+"|"+(r.opponent||"").split(" (")[0].slice(0,4):r.opponent+"|"+r.date;
      const seenR=new Set(),merged=[...(data.recentResults||[]),...pr.filter(r=>r.ts)]
        .filter(r=>{const k=key(r);return !seenR.has(k)&&seenR.add(k);}).sort((a,b)=>b.ts-a.ts).slice(0,5);
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
    // Match statistics per result. Finished games don't change, so stats from the previous snapshot are reused.
    if(data&&data.recentResults){
      const old={};((prev[t.name]&&prev[t.name].data&&prev[t.name].data.recentResults)||[]).forEach(r=>{const k=r.ev||(r.hbm&&"hb"+r.hbm);if(k&&r.stats&&(!r.hbm||r.stats.v===HB_V))old[k]=r.stats;});
      let got=0,reused=0,none=0;
      for(const r of data.recentResults){
        const key=r.ev||(r.hbm&&"hb"+r.hbm);
        if(!key||r.stats||!(r.sp||r.hbm))continue;
        if(old[key]){r.stats=old[key];reused++;continue;}
        try{const st=r.hbm?await hbMatchStats(r.hbm,t):await api.fetchEspnSummary(r.sp,r.lg,r.ev,r.tid);if(st){r.stats=st;got++;}else none++;}
        catch(e){none++;console.log(`    match stats ${key}:`,e.message);}
      }
      if(got+reused+none)console.log(`    match stats: ${got} new, ${reused} reused, ${none} without stats`+(got?" · e.g. "+JSON.stringify(data.recentResults.find(r=>r.stats).stats).slice(0,160):""));
    }
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
  }catch(e){failed++;console.error("✗",t.name,"-",e.message);if(prev[t.name])teams[t.name]=prev[t.name]; /* keep the last good data */}
  api._liveLog.forEach(m=>console.log("   ",m));
}
mkdirSync("out",{recursive:true});
writeFileSync("out/live.json",JSON.stringify({generated:Date.now(),teams,leagueTeams:extraTeams}));
// Tell the workflow whether to keep re-running every minute (a game is on or starts within 15 min).
const liveNow=Object.entries(teams).filter(([,e])=>needsLive(e)).map(([n,e])=>n+(e.data.liveGame?" "+e.data.liveGame.score:" (kick-off soon)"));
if(liveNow.length){writeFileSync("out/live-needed",liveNow.join("\n"));console.log("live: "+liveNow.join(" · "));}
else if(existsSync("out/live-needed"))rmSync("out/live-needed");
console.log(LIVE?`live run: ${seen.size-skipped} teams refreshed, ${failed} failed`:`${ok} teams updated, ${failed} failed, ${seen.size-ok-failed} without a live source`);
if(ok===0)process.exit(1);
