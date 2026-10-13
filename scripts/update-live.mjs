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
return {DB,fetchTeamLive,_liveLog};`)();

const teams={},seen=new Set();let ok=0,failed=0;
for(const t of Object.values(api.DB)){
  if(seen.has(t.name))continue;seen.add(t.name);
  api._liveLog.length=0;
  try{
    const data=await api.fetchTeamLive(t);
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
