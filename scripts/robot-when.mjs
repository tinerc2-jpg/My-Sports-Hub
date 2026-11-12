// Decides what the live-data robot does right now, from out/live.json only (no network):
//   full  – a full run (all teams, news, push subscriptions, requests, sync)
//   live  – a quick --live run (a favourite is playing or starts within 60 min, Trav 2 h)
//   sleep – nothing to do: no API calls
// Owner (12 Nov 2026): don't run every 15 min all day – only the morning calendar, reminders before games and live data.
// Full runs at FULL_HOURS Danish time (06 = calendar for the morning, 08 = ☀️ morning summary, which is sent 8–11,
// 14 = afternoon changes, 20 = ntfy messages (requests, sync, push sign-ups) are kept only ~12 h).
// Start reminders are sent by the --live runs (10–70 min before kick-off), so they need no full run.
// `node scripts/robot-when.mjs soon` prints "yes" if something is live or starts within 30 min (don't hand over to a new job then).
import {existsSync,readFileSync} from "fs";
const FULL_HOURS=[6,8,14,20];
const NOW=Date.now();
let j=null;try{if(existsSync("out/live.json"))j=JSON.parse(readFileSync("out/live.json","utf8"));}catch(e){}
// start of the latest full-run slot (Copenhagen time) at or before now
function lastSlot(){
  for(let back=0;back<48;back++){
    const t=new Date(Math.floor(NOW/36e5)*36e5-back*36e5);
    const h=+t.toLocaleTimeString("en-GB",{hour:"2-digit",hourCycle:"h23",timeZone:"Europe/Copenhagen"}).slice(0,2);
    if(FULL_HOURS.includes(h))return t.getTime();
  }
  return 0;
}
// minutes until this team needs live runs (≤0 = now), null = nothing planned
function liveIn(e){
  const d=e&&e.data;if(!d)return null;
  if(d.liveGame)return 0;
  const g=d.nextGame,k=g&&!g.tba&&g.ts;if(!k)return null;
  if(NOW>=k+150*60e3)return null;
  return (k-(d.trot?120:60)*60e3-NOW)/60e3;
}
const ins=Object.values((j&&j.teams)||{}).map(liveIn).filter(x=>x!==null);
const next=ins.length?Math.min(...ins):null;
if(process.argv[2]==="soon"){console.log(next!==null&&next<=30?"yes":"no");process.exit(0);}
const fullTs=j&&(j.fullTs||j.generated)||0;
if(!j||NOW-fullTs>24*36e5||fullTs<lastSlot())console.log("full");
else if(next!==null&&next<=0)console.log("live");
else console.log("sleep");
