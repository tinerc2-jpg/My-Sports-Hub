// Deploy guard: home/away must always read right (owner, 17 Oct 2026: an away game shown as
// "Barça vs Betis" must never happen again). Runs fixture() from index.html on known cases.
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const src=html.match(/function fixture\(team,opp,score\)\{[\s\S]*?\n\}/);
if(!src){console.error("fixture() not found in index.html");process.exit(1);}
const fixture=new Function(src[0]+"\nreturn fixture;")();
const barca={name:"FC Barcelona",shortName:"Barça"};
const cases=[
  [barca,"Real Betis (A)","1–0",{title:"Real Betis – Barça",score:"0–1",where:"Away game"}],
  [barca,"Real Betis (H)","2–1",{title:"Barça – Real Betis",score:"2–1",where:"Home game"}],
  [barca,"Paris Saint-Germain (A) · CL",undefined,{title:"Paris Saint-Germain – Barça",tag:"CL",where:"Away game"}],
  [barca,"Sevilla (A)","0–0",{title:"Sevilla – Barça",score:"0–0"}],
  [{shortName:"Rune"},"Collignon (European Open, Round 1)","6-4 6-3",{title:"Rune vs Collignon (European Open, Round 1)",score:"6-4 6-3",where:""}],
];
let bad=0;
for(const [t,o,sc,want] of cases){
  const got=fixture(t,o,sc);
  for(const k of Object.keys(want))if(got[k]!==want[k]){bad++;console.error(`✗ ${o}: ${k} = "${got[k]}", expected "${want[k]}"`);}
}
// scoreLine(): tiles, result rows and share text ("Bayern Munich 0–1 Arsenal")
const sl=html.match(/function scoreLine\(team,opp,score\)\{[\s\S]*?\n\}/);
if(!sl){console.error("scoreLine() not found in index.html");process.exit(1);}
const scoreLine=new Function(src[0]+"\n"+sl[0]+"\nreturn scoreLine;")();
for(const [t,o,sc,want] of [[{shortName:"Arsenal"},"Bayern Munich (A) · CL","1–0","Bayern Munich 0–1 Arsenal · CL"],[barca,"Real Madrid (H)","3–1","Barça 3–1 Real Madrid"]]){
  const got=scoreLine(t,o,sc);if(got!==want){bad++;console.error(`✗ scoreLine ${o}: "${got}", expected "${want}"`);}
}
if(bad){console.error(bad+" home/away check(s) failed – not deploying");process.exit(1);}
console.log("home/away checks OK ("+cases.length+" cases)");
