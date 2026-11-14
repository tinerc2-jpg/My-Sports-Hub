// Guard for the public team pages (api/hold.js, api/sitemap.js): the same home/away and date rules as the app
// (owner, 17 Oct 2026: an away game shown as "Barça vs Betis" must never happen), safe HTML, and the right
// answers for short, unknown and odd addresses. Run: node scripts/check-hold.mjs
import {readFileSync} from "node:fs";
import * as F from "../api/_teamfmt.js";
import {teamPage} from "../api/_holdpage.js";
import hold from "../api/hold.js";
import sitemap from "../api/sitemap.js";

let bad=0,n=0;
const ok=(c,msg)=>{n++;if(!c){bad++;console.error("✗ "+msg);}};
const has=(s,x,msg)=>ok(s.includes(x),(msg||"expected")+": "+JSON.stringify(x));
const not=(s,x,msg)=>ok(!s.includes(x),(msg||"must not appear")+": "+JSON.stringify(x));

// ── 1) The copies in api/_teamfmt.js answer exactly like the app's own functions in index.html ──
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const pick=re=>{const m=html.match(re);if(!m){console.error("not found in index.html: "+re);process.exit(1);}return m[0];};
const app=new Function([pick(/function norm\(s\)\{[\s\S]*?\.trim\(\);\}/),pick(/const DA_WD=\{[^\n]*\n/),pick(/function daD\(s\)\{[^\n]*\n/),
  pick(/function daDetail\(x\)\{[^\n]*\n/),pick(/function daRound\(s\)\{[^\n]*\n/),pick(/function fixture\(team,opp,score\)\{[\s\S]*?\n\}/),
  pick(/function scoreLine\(team,opp,score\)\{[\s\S]*?\n\}/)].join("\n")+"\nreturn {norm,daD,daDetail,daRound,fixture,scoreLine};")();
const same=(a,b,msg)=>ok(JSON.stringify(a)===JSON.stringify(b),msg+": app "+JSON.stringify(a)+" ≠ page "+JSON.stringify(b));
const barca={name:"FC Barcelona",shortName:"Barça"},rune={name:"Holger Rune",shortName:"Rune"};
for(const [t,o,sc] of [[barca,"Real Betis (A)","1–0"],[barca,"Real Betis (H)","2–1"],[barca,"Paris Saint-Germain (A) · CL",undefined],[barca,"Sevilla (A)","0–0"],
  [barca,"Real Madrid (H) · Venskab","3-1"],[rune,"Collignon (European Open, Round 1)","6-4 6-3"],[rune,"Taylor Fritz (Stockholm Open, Quarterfinal)",""],
  [{name:"GOG Håndbold",shortName:"GOG"},"Sporting Clube de Portugal (H) · EHF CL","35–37"],[{name:"X"},"",""],[{name:"X"},null,null]]){
  same(app.fixture(t,o,sc),F.fixture(t,o,sc),"fixture "+o);same(app.scoreLine(t,o,sc),F.scoreLine(t,o,sc),"scoreLine "+o);
}
for(const s of ["Sat 14 Nov","27 Sept","4 Oct","May 24","Sep 5","Today","Tomorrow","Season complete","Off-season","TBD","Se turneringens program","",null,12])same(app.daD(s),F.daD(s),"daD "+s);
for(const s of ["Half-time","HT","FT","Full Time","In progress","67'",""])same(app.daDetail(s),F.daDetail(s),"daDetail "+s);
for(const s of ["GOG Håndbold","FC København","Atlético de Madrid","Brøndby IF","Örgryte IS","AC Milan","The Club de Fútbol","Weiß & Söhne","",null])same(app.norm(s),F.norm(s),"norm "+s);
for(const s of ["Final","Quarterfinals","Round 2","Round of 16","Semifinal"])same(app.daRound(s),F.daRound(s),"daRound "+s);

// ── 2) What a page says, with a fixed clock (14 Nov 2026 08:00 Danish time) ──
const NOW=Date.UTC(2026,10,14,7,0,0),H=3600e3,D=24*H;
const snap={generated:NOW,
  meta:{"FC Barcelona":{s:"Barça",sp:"Football",lg:"La Liga",c:"🇪🇸",col:"#A50044",e:"⚽"},"Holger Rune":{s:"Rune",sp:"Tennis",lg:"ATP Tour",c:"🇩🇰",col:"#1B4332",e:"🎾"},
    "Max Verstappen":{s:"Verstappen",sp:"Formula 1",lg:"FIA Formula 1",c:"🇳🇱",col:"#1E41FF",e:"🏎️"},"Gammel Klub":{s:"Gammel",sp:"Football",lg:"1. division",c:"🇩🇰",col:"red; background:url(x)",e:"⚽"},
    "Real Madrid CF":{s:"R. Madrid",sp:"Football",lg:"La Liga",c:"🇪🇸",col:"#FEBE10",e:"⚽"}},
  leagueTeams:[{name:"AGF",shortName:"AGF",sport:"Football",league:"Superliga",country:"🇩🇰",color:"#1e5fa8",emoji:"⚽"}],
  teams:{
    "FC Barcelona":{ts:NOW-10*60e3,data:{source:"ESPN",
      nextGame:{opponent:"Real Betis (A)",date:"Sat 14 Nov",time:"18:30",tv:"Disney+",ts:Date.UTC(2026,10,14,17,30)},
      recentResults:[{opponent:"Sevilla (A)",score:"3–1",result:"W",date:"7 Nov"},{opponent:"Real Madrid (H)",score:"1–2",result:"L",date:"27 Sept"}],
      standing:{rank:2,points:25,wins:8,draws:1,losses:2,table:[{r:1,n:"Real Madrid",p:11,w:9,d:1,l:1,gd:15,pts:28},{r:2,n:"Barcelona",p:11,w:8,d:1,l:2,gd:12,pts:25,me:1}]},
      upcoming:[{opponent:"Real Betis (A)",ts:Date.UTC(2026,10,14,17,30),tv:"Disney+"},{opponent:"Paris Saint-Germain (A) · CL",ts:Date.UTC(2026,10,25,20,0),tv:"FS2"}],
      news:[{title:"<script>alert(1)</script> Barça vinder",url:"https://example.com/a?x=1&y=\"2\"",ts:NOW-H,src:"Kilde <b>"},{title:"Ond lænke",url:"javascript:alert(1)",ts:NOW},
        {title:"Barcelona vs Betis scores & schedule",url:"https://example.com/b",ts:NOW}]}},
    "Real Madrid CF":{ts:NOW-10*60e3,data:{source:"ESPN",liveGame:{opponent:"Girona (A)",score:"2–1",detail:"Half-time"},recentResults:[]}},
    "Holger Rune":{ts:NOW-10*60e3,data:{source:"ESPN",nextGame:{opponent:"Ingen kommende kamp fundet",offTitle:"Ingen kamp planlagt",date:"Se turneringens program",time:"–",tv:"–"},
      recentResults:[{opponent:"Collignon (European Open, Round 1)",score:"6-4 6-3",result:"W",date:"10 Nov",ts:NOW-4*D}],standing:{rank:433,points:null,from:"Wikipedia"}}},
    "Max Verstappen":{ts:NOW-10*60e3,data:{source:"Jolpica F1",nextGame:{opponent:"Las Vegas Grand Prix",date:"Sun 22 Nov",time:"05:00",tv:"–",ts:Date.UTC(2026,10,22,4,0)},
      recentResults:[{opponent:"Brazilian Grand Prix",score:"P2",result:"W",date:"8 Nov"}],standing:{rank:2,points:279,note:"3 sejre · F1-stilling 2026",table:[{r:1,n:"Andrea Kimi Antonelli",w:9,pts:390},{r:2,n:"Max Verstappen",w:3,pts:279,me:1}]}}},
    "Gammel Klub":{ts:NOW-28*D,data:{source:"TheSportsDB",nextGame:{opponent:"Hobro (H)",date:"Sat 17 Oct",time:"16:30",tv:"–",ts:NOW-28*D},recentResults:[{opponent:"Køge (H)",score:"3–0",result:"W",date:"25 Jul",ts:NOW-110*D},{opponent:"Vejle (A)",score:"0–1",result:"L",date:"1 Aug"}],standing:null}},
    "AGF":{ts:NOW-10*60e3,data:{source:"ESPN"}},
  }};
const index=F.buildIndex(snap),base="https://sportshubdk-sigma.vercel.app";
const page=name=>teamPage(F.teamModel(index.teams.find(t=>t.name===name),snap,NOW),{base,index,now:NOW});
const lds=h=>[...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m=>JSON.parse(m[1]));

let h=page("FC Barcelona");
has(h,"Real Betis – Barça","away game: home team first");not(h,"Barça – Real Betis","away game the wrong way round");
has(h,"Udekamp");has(h,"lørdag 14. november");has(h,"kl. 18:30");has(h,"Tv: Disney+");
has(h,"Sevilla 1–3 Barça","away result: score in home–away order");has(h,"Barça 1–2 Real Madrid");has(h,"27. sep","September date in Danish");
has(h,"Paris Saint-Germain – Barça · CL");not(h,"FS2","American tv channel");
const up=(h.match(/<h2>Kommende kampe<\/h2>[\s\S]*?<\/section>/)||[""])[0];
ok(up.includes("Paris Saint-Germain")&&!up.includes("Real Betis"),"the next game is not repeated under upcoming games");
not(h,"<script>alert(1)","unescaped data");has(h,"&lt;script&gt;alert(1)&lt;/script&gt; Barça vinder");not(h,"javascript:alert","javascript: link");not(h,"scores &amp; schedule","listing headline");
has(h,'<link rel="canonical" href="https://sportshubdk-sigma.vercel.app/hold/fc-barcelona">');has(h,"<title>Barça – næste kamp, resultater og stilling | My Sports Hub</title>");
has(h,'href="/?app&amp;teams=FC%20Barcelona&amp;utm_campaign=hold-fc-barcelona"',"follow link");has(h,'<a href="/hold/real-madrid-cf">Real Madrid</a>',"table row links to that team");
let ev=lds(h).find(x=>x["@type"]==="SportsEvent");
ok(ev&&ev.homeTeam.name==="Real Betis"&&ev.awayTeam.name==="Barça"&&ev.startDate==="2026-11-14T17:30:00.000Z","SportsEvent: home/away and start time");
ok(lds(h).some(x=>x["@type"]==="SportsTeam"&&x.name==="FC Barcelona"),"SportsTeam data");

h=page("Real Madrid CF");has(h,"Girona – R. Madrid","live: home team first");has(h,'<p class="score">1–2</p>',"live score in home–away order");has(h,"Live · Pause");
h=page("Holger Rune");has(h,"Rune mod Collignon (European Open, 1. runde)");has(h,"<title>Holger Rune – næste kamp, resultater og rangliste | My Sports Hub</title>");has(h,"Ingen kamp planlagt");has(h,"#433");
ok(!lds(h).some(x=>x["@type"]==="SportsEvent"),"no event for a player without a match");ok(lds(h).some(x=>x["@type"]==="Person"),"Person data for a player");
h=page("Max Verstappen");has(h,"Næste løb");has(h,"Las Vegas Grand Prix");not(h,"Verstappen mod","a race is not an opponent");has(h,"Brazilian Grand Prix · P2");has(h,"søndag 22. november");
h=page("Gammel Klub");has(h,'<meta name="robots" content="noindex">',"a stale page without content is not indexed");not(h,"Hobro","a next game that is long gone");not(h,"Køge","an old result on a stale page");
not(h,"Vejle","a result without a date on a stale page");has(h,"Ikke fastsat endnu");not(h,"background:url","unsafe colour value");
h=page("AGF");has(h,"<h1>AGF</h1>");has(h,"Superliga");has(h,'<meta name="robots" content="noindex">');

// ── 3) The addresses (handlers), with the snapshot served by a stand-in for fetch ──
const call=async(fn,url,{method="GET",host="sportshubdk-sigma.vercel.app"}={})=>{
  const res={statusCode:200,headers:{},body:"",setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(b){this.body=b||"";}};
  await fn({method,url,headers:{host}},res);return res;
};
const realFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error("offline");};
let r=await call(hold,"/api/hold?slug=fc-barcelona");ok(r.statusCode===503&&r.headers["cache-control"]==="no-store","snapshot unreachable → 503, not cached");
const live=JSON.parse(JSON.stringify(snap));for(const e of Object.values(live.teams))e.ts=Date.now()-(NOW-e.ts);live.teams["FC Barcelona"].data.nextGame.ts=Date.now()+5*H;live.teams["FC Barcelona"].data.upcoming=[];
globalThis.fetch=async()=>({ok:true,json:async()=>live});
r=await call(hold,"/api/hold");ok(r.statusCode===200&&r.body.includes("Alle hold og spillere")&&r.body.includes('href="/hold/fc-barcelona"'),"/hold lists the teams");
r=await call(hold,"/api/hold?slug=fc-barcelona");ok(r.statusCode===200&&/s-maxage=600/.test(r.headers["cache-control"])&&r.body.includes("Real Betis – Barça"),"/hold/fc-barcelona");
r=await call(hold,"/hold/fc-barcelona");ok(r.statusCode===200,"slug read from the path");
r=await call(hold,"/api/hold?slug=barca");ok(r.statusCode===308&&r.headers.location==="/hold/fc-barcelona","short name → 308 to the team page");
r=await call(hold,"/api/hold?slug=findes-ikke");ok(r.statusCode===404&&r.body.includes("noindex"),"unknown team → 404");
r=await call(hold,"/api/hold?slug=%3Cscript%3Ealert(1)%3C%2Fscript%3E");ok(r.statusCode===404&&!r.body.includes("alert(1)"),"odd slug → 404 without echo");
r=await call(hold,"/api/hold?slug=fc-barcelona",{method:"POST"});ok(r.statusCode===405,"POST → 405");
r=await call(hold,"/api/hold?slug=fc-barcelona",{method:"HEAD"});ok(r.statusCode===200&&r.body==="","HEAD → headers only");
r=await call(hold,"/api/hold?slug=fc-barcelona",{host:"mysportshub.dk"});has(r.body,'<link rel="canonical" href="https://mysportshub.dk/hold/fc-barcelona">',"own domain in the canonical address");
r=await call(hold,"/api/hold?slug=fc-barcelona",{host:"sportshubdk-abc123-x.vercel.app"});has(r.body,'href="https://sportshubdk-sigma.vercel.app/hold/fc-barcelona"',"deployment address → production address");
r=await call(hold,"/api/hold?slug=fc-barcelona",{host:'evil.example"><script>'});has(r.body,'href="https://sportshubdk-sigma.vercel.app/hold/fc-barcelona"',"odd host header → production address");
r=await call(sitemap,"/api/sitemap");ok(r.statusCode===200&&r.body.includes("<loc>https://sportshubdk-sigma.vercel.app/hold/fc-barcelona</loc>")&&!r.body.includes("/hold/gammel-klub")&&!r.body.includes("/hold/agf<"),"sitemap: pages with content only");
r=await call(sitemap,"/api/sitemap?robots=1");ok(r.body.includes("Sitemap: https://sportshubdk-sigma.vercel.app/sitemap.xml")&&r.body.includes("Disallow: /api/"),"robots.txt");
globalThis.fetch=realFetch;

if(bad){console.error(bad+" team page check(s) failed – not deploying");process.exit(1);}
console.log("team page checks OK ("+n+" checks)");
