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
return {DB,fetchTeamLive,_liveLog,teamAliases,nameMatch};`)();

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
let hbTable=null;
async function hbTableLoad(){
  if(hbTable)return hbTable;
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
    }
    if(data){
      teams[t.name]={ts:Date.now(),data};ok++;
      const s=data.standing;
      console.log("✓",t.name,"·",data.source,"·",s&&s.rank?"#"+s.rank+(s.points!=null?" "+s.points+" pts":""):"no table");
    }
  }catch(e){failed++;console.error("✗",t.name,"-",e.message);}
  api._liveLog.forEach(m=>console.log("   ",m));
}
mkdirSync("out",{recursive:true});
writeFileSync("out/live.json",JSON.stringify({generated:Date.now(),teams}));
console.log(`${ok} teams updated, ${failed} failed, ${seen.size-ok-failed} without a live source`);
if(ok===0)process.exit(1);
