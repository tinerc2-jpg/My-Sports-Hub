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
return {DB,notifyTopic,startTopic,fetchTeamLive,fetchEspnSummary,fetchEspnLineup,_liveLog,teamAliases,nameMatch,norm};`)();

// Previous snapshot: lets us reuse API-Sports standings so we stay within the free quota.
// --live: quick re-run inside the same Actions job (see the workflow's live loop). It starts from this
// job's own out/live.json and only re-fetches teams that are playing or about to.
const LIVE=process.argv.includes("--live");
const NOW=Date.now();
// Trav: from 2 h before the first leg (odds and pool % move most then).
function needsLive(e){const d=e&&e.data,k=d&&d.nextGame&&d.nextGame.ts;return !!(d&&(d.liveGame||(k&&NOW>k-(d.trot?120:15)*60e3&&NOW<k+150*60e3)));}
let prev={},prevFull=null;
let prevExtra=null;
if(LIVE&&existsSync("out/live.json")){const j=JSON.parse(readFileSync("out/live.json","utf8"));prev=j.teams||{};prevExtra=j.leagueTeams||[];}
else try{
  // the API has no CDN cache (raw.githubusercontent can be ~5 min old); raw file as fallback
  const repo=process.env.GITHUB_REPOSITORY||"tinerc2-jpg/My-Sports-Hub";
  let r=await fetch(`https://api.github.com/repos/${repo}/contents/live.json?ref=live-data`,{headers:{Accept:"application/vnd.github.raw"}});
  if(!r.ok)r=await fetch(`https://raw.githubusercontent.com/${repo}/live-data/live.json`);
  if(r.ok){prevFull=await r.json();prev=prevFull.teams||{};}
}catch(e){}

// League scoreboard per day (cached per run): fresher kick-off times than a team's schedule.
const _sb={};
async function espnScoreboardEvent(sp,lg,ev,ts){
  const days=[-1,0,1].map(o=>new Date(ts+o*864e5).toISOString().slice(0,10).replace(/-/g,""));
  for(const d of days){
    const k=sp+"/"+lg+"/"+d;
    if(!(k in _sb))_sb[k]=fetch(`https://site.api.espn.com/apis/site/v2/sports/${sp}/${lg}/scoreboard?dates=${d}`).then(r=>r.ok?r.json():null).catch(()=>null);
    const j=await _sb[k];const e=j&&(j.events||[]).find(x=>String(x.id)===String(ev));
    if(e)return e;
  }
  return null;
}

// ── Web Push: notifications straight from the app (no extra app). The VAPID key pair and the key that
// encrypts the stored subscriptions are derived from the APISPORTS_KEY secret, so nothing new has to be set
// up and no private key ever leaves Actions. Phones send their subscription (endpoint + the teams and
// alert types chosen) to an ntfy topic; every full run collects them into live.json.push.subs (encrypted).
import crypto from "node:crypto";
const PUSH_SUBS_TOPIC="msh-push-subs-7f3k9q";
const pushSecret=process.env.APISPORTS_KEY||process.env.PUSH_SECRET||"";
const b64u=b=>Buffer.from(b).toString("base64url");
let VAPID=null,SUBS_KEY=null;
if(pushSecret){
  const d=Buffer.from(crypto.hkdfSync("sha256",pushSecret,"my-sports-hub","vapid-p256",32));
  const ec=crypto.createECDH("prime256v1");ec.setPrivateKey(d);
  VAPID={publicKey:b64u(ec.getPublicKey()),privateKey:b64u(d)};
  SUBS_KEY=Buffer.from(crypto.hkdfSync("sha256",pushSecret,"my-sports-hub","subs-aes",32));
}
const encSubs=list=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv("aes-256-gcm",SUBS_KEY,iv);const x=Buffer.concat([c.update(JSON.stringify(list)),c.final()]);return b64u(Buffer.concat([iv,c.getAuthTag(),x]));};
const decSubs=t=>{try{const b=Buffer.from(t,"base64url"),c=crypto.createDecipheriv("aes-256-gcm",SUBS_KEY,b.subarray(0,12));c.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([c.update(b.subarray(28)),c.final()]).toString());}catch(e){return [];}};
let pushSubs=[];
if(VAPID){
  const pj=LIVE&&existsSync("out/live.json")?JSON.parse(readFileSync("out/live.json","utf8")):prevFull;
  pushSubs=pj&&pj.push&&pj.push.subs?decSubs(pj.push.subs):[];
  if(!LIVE){
    try{
      const r=await fetch(`https://ntfy.sh/${PUSH_SUBS_TOPIC}/json?poll=1&since=24h`);
      const msgs=(await r.text()).split("\n").filter(Boolean).map(l=>{try{return JSON.parse(l);}catch(e){return null;}}).filter(m=>m&&m.event==="message");
      let n=0;
      for(const m of msgs){let x;try{x=JSON.parse(m.message);}catch(e){continue;}
        if(!x||!x.sub||!x.sub.endpoint||!/^https:\/\//.test(x.sub.endpoint)||!x.sub.keys)continue;
        const old=pushSubs.find(s=>s.sub.endpoint===x.sub.endpoint);
        if(old&&(old.ts||0)>=(x.ts||0))continue;
        const teams=(Array.isArray(x.teams)?x.teams:[]).slice(0,60).map(t=>({n:String(t.n||"").slice(0,80),start:!!t.start,live:!!t.live})).filter(t=>t.n&&(t.start||t.live));
        pushSubs=pushSubs.filter(s=>s.sub.endpoint!==x.sub.endpoint);
        if(teams.length)pushSubs.push({sub:{endpoint:x.sub.endpoint,keys:{p256dh:String(x.sub.keys.p256dh),auth:String(x.sub.keys.auth)}},teams,ts:x.ts||m.time*1000});
        n++;
      }
      console.log(`push: ${pushSubs.length} phones subscribed (${n} updates from ${msgs.length} messages)`);
    }catch(e){console.log("push subs: "+e.message);}
  }
}
let _webpush=null;
async function sendPush(name,kind,payload){
  if(!VAPID)return;
  const to=pushSubs.filter(s=>s.teams.some(t=>t.n===name&&t[kind]));
  if(!to.length)return;
  if(!_webpush){_webpush=(await import("web-push")).default;_webpush.setVapidDetails("https://tinerc2-jpg.github.io/My-Sports-Hub/",VAPID.publicKey,VAPID.privateKey);}
  let ok=0,gone=0;
  for(const s of to){
    try{await _webpush.sendNotification(s.sub,JSON.stringify(payload),{TTL:3600,urgency:"high"});ok++;}
    catch(e){if(e.statusCode===404||e.statusCode===410){s.gone=true;gone++;}else console.log("push "+name+": HTTP "+(e.statusCode||"")+" "+String(e.body||e.message).slice(0,120));}
  }
  pushSubs=pushSubs.filter(s=>!s.gone);
  console.log(`push ${name} (${kind}): ${ok} sent`+(gone?`, ${gone} expired removed`:""));
}

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
const HB_V=4; // bump when hbMatchStats changes, so stats in the previous snapshot are recomputed
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
    .sort((a,b)=>b.n-a.n).filter((x,i,arr)=>arr.filter(y=>y.me===x.me).indexOf(x)<10);
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
// Where an EHF game is shown in Denmark: the match page's TV schedule (GetMatchTvSchedule).
const _ehfTv={};
async function ehfTv(id){
  if(id in _ehfTv)return _ehfTv[id];
  let tv="";
  try{
    const r=await fetch("https://www.eurohandball.com/umbraco/api/matchdetailapi/GetMatchTvSchedule?matchId="+id,{headers:{Accept:"application/json"}});
    const t=await r.text();let j=null;try{j=JSON.parse(t);}catch(e){}
    const hits=[];
    const walk=(o)=>{if(!o||typeof o!=="object")return;if(Array.isArray(o))return o.forEach(walk);
      const vals=Object.values(o).filter(v=>typeof v==="string");
      if(vals.some(v=>/^(den|denmark|danmark|dk)$/i.test(v.trim()))){
        const nm=o.tvStation||o.broadcaster||o.channel||o.channelName||o.stationName||o.name||o.title||vals.find(v=>/tv|sport|viaplay|max|dr/i.test(v));
        if(nm&&typeof nm==="string")hits.push(nm);else if(nm&&typeof nm==="object")hits.push(nm.name||nm.title||"");
      }
      Object.values(o).forEach(walk);};
    walk(j);
    // channels only (the list can also hold the clubs' own streams, named after the club)
    tv=[...new Set(hits.filter(h=>h&&/tv|viaplay|max|dr\b|sport|kanal|stream|play/i.test(h)))].join(" / ");
    console.log(`    EHF TV ${id}: HTTP ${r.status} · Denmark: ${tv||"none"}`+(tv?"":" · sample «"+t.slice(0,600).replace(/\s+/g," ")+"»"));
  }catch(e){console.log("    EHF TV: "+e.message);}
  return _ehfTv[id]=tv;
}
// EHF match statistics (GetMatchDetailStatistic): {homeStatistics, guestStatistics} with totalGoals,
// totalShots, shotEfficiency, goals7meters/shots7meters, totalMisses, technicalFaults, suspensions2minutes, warnings.
async function ehfMatchStats(id,team,row){
  const r=await fetch("https://www.eurohandball.com/umbraco/api/matchdetailapi/GetMatchDetailStatistic?matchId="+id,{headers:{Accept:"application/json"}});
  if(!r.ok)throw new Error("HTTP "+r.status);
  const j=await r.json(),H=j.homeStatistics,G=j.guestStatistics;
  if(!H||!G||!j.isAfterMatch)return null;
  const me=row.home?H:G,op=row.home?G:H;
  const v=(o,k,pct)=>o[k]==null?"–":String(o[k])+(pct?"%":"");
  const stats=[["Goals","totalGoals"],["Shots","totalShots"],["Shooting %","shotEfficiency",1],["7m goals","goals7meters"],["Missed shots","totalMisses"],
    ["Technical faults","technicalFaults"],["2-min suspensions","suspensions2minutes"],["Yellow cards","warnings"]]
    .map(([l,k,p])=>({label:l,me:v(me,k,p),op:v(op,k,p)})).filter(x=>x.me!=="–"||x.op!=="–");
  console.log(`    EHF stats ${id}: goals ${me.totalGoals}-${op.totalGoals}, shots ${me.totalShots}-${op.totalShots}`);
  return{v:HB_V,meName:team.shortName,opName:String(row.opponent||"").replace(/ \((H|A)\).*$/,""),stats,top:[],goals:[]};
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
      out.results.push({opponent:name,score:me+"–"+op,result:me>op?"W":me<op?"L":"D",date:fmtDK(when,{day:"numeric",month:"short"}),ts:when.getTime(),ehm:m.matchID,home:home?1:0});
    else if(when.getTime()>now-3*3600e3&&(!out.next||when<out.next.d))out.next={d:when,name,id:m.matchID};
  }
  if(out.next&&out.next.id)out.next.tv=await ehfTv(out.next.id);
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
  Rugby:["rugby","rugby"],Baseball:["baseball","MLB"],Volleyball:["volleyball","volleyball"],Trav:["trav","trav"]};
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

// ── Trav (trotting): ATG's big Saturday pool (V75; V85 while ATG runs that instead). Public racinginfo JSON. ──
const ATG="https://www.atg.se/services/racinginfo/v1/api/";
const atgTs=t=>{const m=/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(t||"");return m?cphDate(+m[3],+m[2],+m[1],+m[4],+m[5]).getTime():0;}; // Swedish time = Copenhagen time
const atgName=p=>p?[p.firstName,p.lastName].filter(Boolean).join(" ")||p.shortName||"":"";
// Current win odds ("vinnare" pool). ATG sends them as an integer ×100 (254 = 2.54) or already decimal.
const atgOdds=p=>{const o=p&&(p.odds??p.currentOdds);if(o==null||!(o>0))return null;return Number.isInteger(o)&&o>=100?o/100:o;};
const atgKm=k=>k&&k.minutes!=null?`${k.minutes}.${String(k.seconds).padStart(2,"0")},${k.tenths??0}`:"";
async function atgRound(t){
  try{
    const prods={};
    for(const bt of ["V75","V85"]){try{prods[bt]=await (await fetch(ATG+"products/"+bt)).json();}catch(e){}}
    const up=Object.entries(prods).flatMap(([bt,j])=>(j.upcoming||[]).map(g=>({bt,...g}))).sort((a,b)=>atgTs(a.startTime)-atgTs(b.startTime))[0];
    const done=Object.entries(prods).flatMap(([bt,j])=>(j.results||[]).map(g=>({bt,...g}))).sort((a,b)=>atgTs(b.startTime)-atgTs(a.startTime)).slice(0,5);
    const legsOf=(g,bt)=>(g.races||[]).slice().sort((a,b)=>atgTs(a.startTime)-atgTs(b.startTime)||a.number-b.number).map((r,i)=>({leg:i+1,race:r.number,name:r.name,track:r.track&&r.track.name,ts:atgTs(r.startTime),dist:r.distance,start:r.startMethod==="auto"?"Autostart":r.startMethod==="volte"?"Voltstart":r.startMethod,
      horses:(r.starts||[]).map(s=>{const pl=s.pools&&s.pools[bt]||{},res=s.result||{};return{n:s.number,h:s.horse&&s.horse.name,d:atgName(s.driver),tr:atgName(s.horse&&s.horse.trainer),
        pct:pl.betDistribution!=null?Math.round(pl.betDistribution/100):null,wo:atgOdds(s.pools&&s.pools.vinnare),x:!!s.scratched,pl:res.place||null,km:atgKm(res.kmTime),odds:res.finalOdds||null};})}));
    const trot={};
    let nextGame={opponent:"No round scheduled yet",offTitle:"Next round",date:"–",time:"–",tv:"ATG"};
    if(up){
      const g=await (await fetch(ATG+"games/"+up.id)).json();
      const pool=g.pools&&g.pools[up.bt]||{},legs=legsOf(g,up.bt),track=(up.tracks||[]).map(x=>x.name).join(" & ");
      trot.next={bt:up.bt,id:up.id,track,ts:atgTs(up.startTime),turnover:pool.turnover?Math.round(pool.turnover/100):null,legs};
      nextGame={opponent:`${up.bt} · ${track}`,date:"",time:"",ts:atgTs(up.startTime),tv:"ATG"};
      // Live while the round runs: legs get their winner as soon as ATG has the result.
      const fin=legs.filter(l=>l.horses.some(x=>x.pl===1)),now=Date.now(),last=legs[legs.length-1];
      if(legs.length&&now>legs[0].ts-15*60e3&&fin.length<legs.length&&now<last.ts+60*60e3){
        const cur=legs.find(l=>!l.horses.some(x=>x.pl===1)),pw=fin[fin.length-1],w=pw&&pw.horses.find(x=>x.pl===1);
        const hm=ts=>new Date(ts).toLocaleTimeString("da-DK",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/Copenhagen"});
        trot.live=true;
        var liveGame={opponent:`${up.bt} · ${track}`,score:`${fin.length}/${legs.length}`,
          detail:(cur?`${up.bt.slice(0,1)}-${cur.leg} kl. ${hm(cur.ts)}`:"")+(w?` · ${up.bt.slice(0,1)}-${pw.leg}: ${w.n} ${w.h}`:"")};
      }
      if(legs[0]&&legs[0].horses[0])console.log(`    ATG ${up.id}: ${legs.length} legs · vinnare sample ${JSON.stringify((g.races[0].starts[0].pools||{}).vinnare||{}).slice(0,200)}`);
    }
    const old={};((prev[t.name]&&prev[t.name].data&&prev[t.name].data.recentResults)||[]).forEach(r=>{if(r.atg)old[r.atg]=r;});
    const recentResults=[];
    for(const x of done){
      if(old[x.id]&&old[x.id].trot&&old[x.id].trot.v===2){recentResults.push(old[x.id]);continue;}
      try{
        const g=await (await fetch(ATG+"games/"+x.id)).json();
        const pool=g.pools&&g.pools[x.bt]||{},res=pool.result||{},pay=res.payouts||{};
        const legs=legsOf(g,x.bt),track=(x.tracks||[]).map(y=>y.name).join(" & "),top=Math.max(...Object.keys(pay).map(Number).filter(n=>n>0),0);
        const kr=n=>pay[n]&&pay[n].payout!=null?Math.round(pay[n].payout/100):null;
        const winners=legs.map(l=>{const w=l.horses.find(h=>h.pl===1);return w?{leg:l.leg,n:w.n,h:w.h,d:w.d,km:w.km,odds:w.odds}:{leg:l.leg};});
        const ts=atgTs(x.startTime);
        recentResults.push({atg:x.id,opponent:`${x.bt} · ${track}`,score:top&&kr(top)!=null?`${top} rätt: ${kr(top).toLocaleString("da-DK")} kr`:"Result",label:"🏁",result:"D",
          date:new Date(ts).toLocaleDateString("en-GB",{day:"numeric",month:"short",timeZone:"Europe/Copenhagen"}),ts,
          trot:{v:2,bt:x.bt,track,ts,row:winners.map(w=>w.n||"–").join("-"),winners,payouts:Object.keys(pay).map(Number).filter(n=>n>0).sort((a,b)=>b-a).map(n=>({n,kr:kr(n),sys:pay[n].systems??null})),turnover:pool.turnover?Math.round(pool.turnover/100):null}});
      }catch(e){console.log(`    ATG ${x.id}: ${e.message}`);}
    }
    console.log(`    ATG: next ${up?up.id:"none"} · ${recentResults.length} results`+(recentResults[0]?` · latest ${recentResults[0].opponent} ${recentResults[0].score} row ${recentResults[0].trot.row}`:""));
    if(!up&&!recentResults.length)return null;
    return{source:"ATG",standing:null,recentResults,nextGame,trot,liveGame:typeof liveGame!=="undefined"?liveGame:null};
  }catch(e){console.log("    ATG:",e.message);return null;}
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
const LEAGUE_TEAMS=[{sp:"soccer",lg:"den.1",league:"Superliga",country:"🇩🇰"},
  {sp:"soccer",lg:"eng.1",league:"Premier League",country:"🏴󠁧󠁢󠁥󠁮󠁧󠁿"},{sp:"soccer",lg:"ita.1",league:"Serie A",country:"🇮🇹"},
  {sp:"soccer",lg:"swe.1",league:"Allsvenskan",country:"🇸🇪"}];
// ESPN gives many clubs black/white (or no) colours and some names in another form: club colours / names here.
const CLUB_STYLE={
  "F.C. København":{name:"FC København",shortName:"FCK",color:"#1c3f94",accent:"#9fb8e8"},"Brøndby IF":{color:"#f2c500",accent:"#1d3c8f"},
  "FC Midtjylland":{color:"#c8102e",accent:"#111111"},"AGF":{color:"#1e5fa8",accent:"#9cc3ef"},"AC Horsens":{color:"#e8b400",accent:"#111111"},
  "Lyngby Boldklub":{color:"#004b9b",accent:"#7fb2ea"},"Odense Boldklub":{shortName:"OB",color:"#0055a5",accent:"#8ec0f0"},
  "Randers FC":{color:"#1f78c8",accent:"#81c0ff"},"Silkeborg IF":{color:"#d71920",accent:"#7a0f14"},"Sønderjyske Fodbold":{color:"#3a8fd6",accent:"#0d2f63"},
  "Viborg FF":{color:"#00843d",accent:"#0b3d22"},"FC Nordsjælland":{color:"#cf010e",accent:"#ff9f1a"},
  "Vejle Boldklub":{color:"#c8102e",accent:"#111111"},
  "Juventus":{color:"#3a3a3a",accent:"#c9a227"},"Newcastle United":{color:"#3d3d3d",accent:"#41b6e6"},"Tottenham Hotspur":{color:"#132257",accent:"#8a9ad6"},
  "Fulham":{color:"#4a4a4a",accent:"#cc0000"},"Udinese":{color:"#3d3d3d",accent:"#bfbfbf"},"Parma":{color:"#1e3f8a",accent:"#f5d000"},"FC Fredericia":{color:"#c8102e",accent:"#1d3360"},"Djurgårdens IF":{name:"Djurgården IF",shortName:"Djurgården",color:"#1e4fa0",accent:"#d71920"},"Aalborg BK":{shortName:"AaB",color:"#c8102e",accent:"#ffffff"},
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
// Every Håndboldligaen club, from the league table page (names as the league writes them).
async function handballLeagueTeams(){
  try{
    const p=await tv2Load(TABLE_PAGES[0]),gog=Object.values(api.DB).find(d=>d.league===TV2_LEAGUE);
    const rows=gog?hbTableFromTokens(p.tokens,api.teamAliases(gog)):null;
    if(!rows)return [];
    const have=Object.values(api.DB).filter(d=>d.sport==="Handball").map(d=>d.name);
    const out=rows.filter(r=>!have.some(n=>api.nameMatch(api.teamAliases({name:n,shortName:n}),[r.n])>0||api.nameMatch([api.norm(r.n)],[n])>0)).map(r=>{
      const hue=[...r.n].reduce((a,ch)=>(a*31+ch.charCodeAt(0))%360,7),st=CLUB_STYLE[r.n]||{};
      return{name:r.n,shortName:st.shortName||r.n.replace(/ (Håndboldklub|Håndbold|Herrehåndbold|Herrer|HH)$/,""),sport:"Handball",league:TV2_LEAGUE,country:"🇩🇰",
        color:st.color||hslHex(hue,60,40),accent:st.accent||hslHex((hue+40)%360,60,25),emoji:"🤾",standing:{rank:null,points:null},recentResults:[],nextGame:null,news:[]};
    });
    console.log(`league ${TV2_LEAGUE}: ${rows.length} clubs, ${out.length} added (${out.map(t=>t.shortName).join(", ")})`);
    return out;
  }catch(e){console.log("handball league clubs: "+e.message);return [];}
}
const extraTeams=LIVE?Object.values(prevExtra||{}):[...await leagueTeams(),...await handballLeagueTeams()];
const teams={},seen=new Set();let ok=0,failed=0;
let skipped=0;
for(const t of [...Object.values(api.DB),...extraTeams]){
  if(seen.has(t.name))continue;seen.add(t.name);
  if(LIVE&&!needsLive(prev[t.name])){if(prev[t.name]){teams[t.name]=prev[t.name];ok++;}skipped++;continue;}
  api._liveLog.length=0;
  try{
    let data=await api.fetchTeamLive(t);
    // league clubs TheSportsDB doesn't know still get table, programme and EHF data below
    if(!data&&t.sport==="Handball"&&t.league===TV2_LEAGUE)data={source:"Top Håndbold",recentResults:[],nextGame:null};
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
          time:eh.next.d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/Copenhagen"}),tv:eh.next.tv||"–",ts};
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
    if(!data&&t.sport==="Trav")data=await atgRound(t);
    // Match statistics per result. Finished games don't change, so stats from the previous snapshot are reused.
    if(data&&data.recentResults){
      const old={};((prev[t.name]&&prev[t.name].data&&prev[t.name].data.recentResults)||[]).forEach(r=>{const k=r.ev||(r.hbm&&"hb"+r.hbm)||(r.ehm&&"ehf"+r.ehm);if(k&&r.stats&&((r.hbm||r.ehm)?r.stats.v===HB_V:r.stats.sv===3))old[k]=r.stats;});
      let got=0,reused=0,none=0;
      for(const r of data.recentResults){
        const key=r.ev||(r.hbm&&"hb"+r.hbm)||(r.ehm&&"ehf"+r.ehm);
        if(!key||r.stats||!(r.sp||r.hbm||r.ehm))continue;
        if(old[key]){r.stats=old[key];reused++;continue;}
        try{const st=r.hbm?await hbMatchStats(r.hbm,t):r.ehm?await ehfMatchStats(r.ehm,t,r):await api.fetchEspnSummary(r.sp,r.lg,r.ev,r.tid);if(st){r.stats=st;got++;}else none++;}
        catch(e){none++;console.log(`    match stats ${key}:`,e.message);}
      }
      if(got+reused+none)console.log(`    match stats: ${got} new, ${reused} reused, ${none} without stats`+(got?" · e.g. "+JSON.stringify(data.recentResults.find(r=>r.stats).stats).slice(0,160):""));
    }
    // Kick-off check: ESPN's team schedule can lag behind a rescheduled time (Betis–Barcelona showed 18:00, real
    // kick-off 18:30). The league scoreboard for that day is fresher, so its time wins for games within 4 days.
    if(data&&data.nextGame&&data.nextGame.ev&&data.nextGame.sp&&data.nextGame.ts&&data.nextGame.ts-Date.now()<4*864e5){
      const g=data.nextGame;
      try{
        const ev=await espnScoreboardEvent(g.sp,g.lg,g.ev,g.ts);
        if(ev&&ev.date){const ts=Date.parse(ev.date);if(ts&&Math.abs(ts-g.ts)>=60e3){console.log(`    kick-off fix ${t.name}: schedule ${new Date(g.ts).toISOString()} → scoreboard ${new Date(ts).toISOString()}`);g.ts=ts;}}
      }catch(e){console.log(`    kick-off check ${t.name}: ${e.message}`);}
    }
    // Line-ups (football): from ~75 min before kick-off until full-time; kept once found (re-read while live).
    if(data&&t.sport==="Football"){
      const g=data.liveGame&&data.liveGame.ev?data.liveGame:data.nextGame,pl=prev[t.name]&&prev[t.name].data&&prev[t.name].data.lineup;
      const mins=g&&g.ts?(g.ts-Date.now())/60e3:null;
      if(g&&g.ev&&(data.liveGame||(mins!=null&&mins<75&&mins>-150))){
        if(pl&&pl.ev===String(g.ev)&&!data.liveGame)data.lineup=pl;
        else{try{const lu=await api.fetchEspnLineup(g.sp,g.lg,g.ev,g.tid);if(lu){data.lineup=lu;console.log(`    line-up ${t.name}: `+lu.teams.map(x=>x.name+" "+x.formation+" ("+x.starters.length+")").join(" v "));}else if(pl&&pl.ev===String(g.ev))data.lineup=pl;}
          catch(e){console.log(`    line-up ${t.name}: ${e.message}`);if(pl&&pl.ev===String(g.ev))data.lineup=pl;}}
      }else if(pl&&g&&pl.ev===String(g.ev))data.lineup=pl;
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
// Team requests from the app's "Request this team" button (GoatCounter events "request/<sport>/<name>").
// Needs the GOATCOUNTER_TOKEN repo secret (GoatCounter → Settings → API, read permission). Hourly at most.
let requests=null,usage=prevFull&&prevFull.usage||null;
const prevRequests=prevFull&&prevFull.requests;
{
  const pj=LIVE&&existsSync("out/live.json")?JSON.parse(readFileSync("out/live.json","utf8")):null;
  requests=pj&&pj.requests||null;
  const tok=process.env.GOATCOUNTER_TOKEN;
  if(!LIVE&&tok){
    try{
      const start=new Date(Date.now()-60*864e5).toISOString().slice(0,10);
      const r=await fetch(`https://mysportshub.goatcounter.com/api/v0/stats/hits?start=${start}&limit=100`,{headers:{Authorization:"Bearer "+tok,"Content-Type":"application/json"}});
      const j=await r.json();
      const list=(j.hits||[]).filter(x=>/^\/?request\//.test(x.path||"")).map(x=>({path:String(x.path).replace(/^\/?request\//,""),title:x.title||"",count:x.count||(x.stats||[]).reduce((a,d)=>a+(d.daily||0),0)}));
      requests={ts:Date.now(),list};
      console.log(`requests: HTTP ${r.status} · ${list.length} requested teams`+(list.length?": "+list.map(x=>x.path+" ×"+x.count).join(", "):"")+(r.ok?"":" · "+JSON.stringify(j).slice(0,200)));
    }catch(e){console.log("requests: "+e.message);}
    // Usage stats for the owner's weekly report (last 7 days): totals per day, top pages, countries, devices.
    try{
      const prevU=prevFull&&prevFull.usage;
      if(!prevU||Date.now()-(prevU.ts||0)>3600e3){
        const end=new Date().toISOString().slice(0,10),start=new Date(Date.now()-7*864e5).toISOString().slice(0,10);
        const gc=async p=>{const r=await fetch(`https://mysportshub.goatcounter.com/api/v0/${p}${p.includes("?")?"&":"?"}start=${start}&end=${end}`,{headers:{Authorization:"Bearer "+tok,"Content-Type":"application/json"}});return r.ok?r.json():{error:r.status};};
        const tot=await gc("stats/total"),hits=await gc("stats/hits?limit=20"),loc=await gc("stats/locations?limit=10"),sys=await gc("stats/systems?limit=10"),siz=await gc("stats/sizes?limit=10");
        const items=j=>(j.stats||[]).map(x=>({name:x.name||x.id||"?",count:x.count||0}));
        usage={ts:Date.now(),start,end,total:tot.total||0,events:tot.total_events||0,
          daily:(tot.stats||[]).map(d=>({day:d.day,count:d.daily||0})),
          pages:(hits.hits||[]).map(x=>({path:x.path,event:!!x.event,count:x.count||0})),
          countries:items(loc),systems:items(sys),screens:items(siz)};
        console.log(`usage: ${usage.total} visits, ${usage.events} events (${start}..${end})`+(tot.error?" · HTTP "+tot.error:""));
      }else usage=prevU;
    }catch(e){console.log("usage: "+e.message);}
  }
  // ntfy.sh topic the app posts to ("<sport> | <name>"); messages are kept ~12 h, so collect them every run.
  if(!LIVE){
    const pr=(prevRequests&&prevRequests.ntfy)||[];
    try{
      const r=await fetch("https://ntfy.sh/mysportshub-team-requests-7f3k9q/json?poll=1&since=24h");
      const msgs=(await r.text()).split("\n").filter(Boolean).map(l=>{try{return JSON.parse(l);}catch(e){return null;}}).filter(m=>m&&m.event==="message");
      const seenIds=new Set(pr.map(x=>x.id)),add=msgs.filter(m=>!seenIds.has(m.id)).map(m=>({id:m.id,ts:m.time*1000,text:String(m.message||"").slice(0,80)}));
      const all=[...pr,...add].slice(-200);
      requests={...(requests||{}),ntfy:all};
      console.log(`requests (ntfy): ${msgs.length} recent, ${add.length} new, ${all.length} kept`+(add.length?": "+add.map(x=>x.text).join("; "):""));
    }catch(e){console.log("requests (ntfy): "+e.message);requests={...(requests||{}),ntfy:pr};}
  }
}
// Live push to the app: every changed live score goes to one ntfy.sh topic the app listens to while a
// game is on (EventSource), so the app updates within seconds instead of polling GitHub every 75 s.
for(const [name,e] of Object.entries(teams)){
  const g=e&&e.data&&e.data.liveGame,p=prev[name]&&prev[name].data&&prev[name].data.liveGame;
  if(!g||(p&&p.score===g.score&&p.detail===g.detail))continue;
  try{await fetch("https://ntfy.sh/",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({topic:"msh-live-7f3k",message:JSON.stringify({n:name,o:g.opponent,s:g.score,d:g.detail})})});}catch(err){}
}
// Live notifications (football): compare with the previous run and post kick-off / goal / full-time to
// the team's ntfy.sh topic (users subscribe in the free ntfy app; see NotifyCard in the app).
for(const [name,e] of Object.entries(teams)){
  const d=e&&e.data,p=prev[name]&&prev[name].data,t=api.DB[Object.keys(api.DB).find(k=>api.DB[k].name===name)]||extraTeams.find(x=>x.name===name);
  if(!d||!t||t.sport!=="Football")continue;
  const now=d.liveGame,was=p&&p.liveGame;let title=null,body=null,tags="soccer";
  if(now&&!was){title="Kick-off: "+t.shortName;body=t.shortName+" vs "+now.opponent+" has started";}
  else if(now&&was&&now.score!==was.score){title="⚽ GOAL – "+t.shortName+" "+now.score;body=t.shortName+" "+now.score+" "+now.opponent+" ("+now.detail+")";tags="soccer,tada";}
  else if(!now&&was&&d.recentResults&&d.recentResults[0]){const r=d.recentResults[0];title="Full-time: "+t.shortName+" "+r.score;body=(r.result==="W"?"Win! ":r.result==="L"?"Loss. ":"Draw. ")+t.shortName+" "+r.score+" "+r.opponent;tags="checkered_flag";}
  if(!title)continue;
  // JSON publish: headers can't carry emoji / ø
  try{const r=await fetch("https://ntfy.sh/",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({topic:api.notifyTopic(name),title,message:body,tags:tags.split(","),click:"https://tinerc2-jpg.github.io/My-Sports-Hub/?app"})});
    console.log("notify "+name+": "+title+" (HTTP "+r.status+")");}
  catch(err){console.log("notify "+name+": "+err.message);}
  await sendPush(name,"live",{title,body,tag:"live-"+name,url:"https://tinerc2-jpg.github.io/My-Sports-Hub/?app"});
}
// Start reminders (all sports): about 60 min before the next game / race / round, once per start time
// (runs every 15 min and are often late, so anything 10–70 min ahead counts).
for(const [name,e] of Object.entries(teams)){
  const d=e&&e.data,p=prev[name]&&prev[name].data,t=api.DB[Object.keys(api.DB).find(k=>api.DB[k].name===name)]||extraTeams.find(x=>x.name===name);
  if(!d||!t||d.newsOnly)continue;
  if(p&&p.preNotified&&!d.preNotified)d.preNotified=p.preNotified;
  const g=d.nextGame,ts=g&&g.ts,left=ts?(ts-Date.now())/60e3:null;
  if(p&&p.lineupNotified&&!d.lineupNotified)d.lineupNotified=p.lineupNotified;
  // Line-up out after the reminder went: one extra "📋" message to the same subscribers.
  if(d.lineup&&ts&&d.preNotified===ts&&d.lineupNotified!==d.lineup.ev&&g.ev&&d.lineup.ev===String(g.ev)&&left>-15){
    d.lineupNotified=d.lineup.ev;
    const me=d.lineup.teams.find(x=>x.me)||d.lineup.teams[0];
    const body=(me.formation?me.formation+": ":"")+me.starters.map(x=>x.n.split(" ").slice(-1)[0]).join(", ");
    await sendPush(name,"start",{title:"📋 "+t.shortName+" – holdopstillingen er klar",body,tag:"lineup-"+name,url:"https://tinerc2-jpg.github.io/My-Sports-Hub/?app"});
    console.log("notify "+name+": line-up");
    continue;
  }
  if(!ts||d.liveGame||d.preNotified===ts||left<10||left>70)continue;
  d.preNotified=ts;
  const hm=new Date(ts).toLocaleTimeString("da-DK",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/Copenhagen"});
  const what=t.sport==="Trav"?g.opponent:t.shortName+" vs "+g.opponent,tv=g.tv&&g.tv!=="–"&&g.tv!=="-"?" · TV: "+g.tv:"";
  const lu=d.lineup&&g.ev&&d.lineup.ev===String(g.ev)?" · 📋 Holdopstillingen er klar":"";
  if(lu)d.lineupNotified=d.lineup.ev;
  try{const r=await fetch("https://ntfy.sh/",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({topic:api.startTopic(name),title:"⏰ "+t.shortName+" starter kl. "+hm,message:what+" starter om "+Math.round(left)+" min"+tv+lu,tags:["alarm_clock"],click:"https://tinerc2-jpg.github.io/My-Sports-Hub/?app"})});
    console.log("notify "+name+": start reminder "+hm+" (HTTP "+r.status+")");}
  catch(err){console.log("notify "+name+": "+err.message);}
  await sendPush(name,"start",{title:"⏰ "+t.shortName+" starter kl. "+hm,body:what+" starter om "+Math.round(left)+" min"+tv+lu,tag:"start-"+name,url:"https://tinerc2-jpg.github.io/My-Sports-Hub/?app"});
}
mkdirSync("out",{recursive:true});
writeFileSync("out/live.json",JSON.stringify({generated:Date.now(),teams,leagueTeams:extraTeams,requests,usage,push:VAPID?{vapid:VAPID.publicKey,subs:encSubs(pushSubs),count:pushSubs.length}:null}));
// Tell the workflow whether to keep re-running every minute (a game is on or starts within 15 min).
const liveNow=Object.entries(teams).filter(([,e])=>needsLive(e)).map(([n,e])=>n+(e.data.liveGame?" "+e.data.liveGame.score:" (kick-off soon)"));
if(liveNow.length){writeFileSync("out/live-needed",liveNow.join("\n"));console.log("live: "+liveNow.join(" · "));}
else if(existsSync("out/live-needed"))rmSync("out/live-needed");
console.log(LIVE?`live run: ${seen.size-skipped} teams refreshed, ${failed} failed`:`${ok} teams updated, ${failed} failed, ${seen.size-ok-failed} without a live source`);
if(ok===0)process.exit(1);
