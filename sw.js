// My Sports Hub service worker: shows the push notifications the robot sends (start reminders, goals).
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("push",e=>{
  let d={};try{d=e.data?e.data.json():{};}catch(err){d={body:e.data&&e.data.text()};}
  e.waitUntil(self.registration.showNotification(d.title||"My Sports Hub",{body:d.body||"",icon:"icon-192.png",badge:"icon-192.png",tag:d.tag,data:{url:d.url||"./?app",title:d.title||"My Sports Hub",body:d.body||""}}));
});
self.addEventListener("notificationclick",e=>{
  e.notification.close();
  const d=e.notification.data||{},title=d.title||e.notification.title,body=d.body||e.notification.body||"";
  // iOS removes the notification when it's tapped, so the app shows its text in a banner
  const base=new URL(d.url||"./?app",self.registration.scope);base.searchParams.set("nt",title);base.searchParams.set("nb",body);
  e.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(ws=>{
    for(const w of ws){if("focus" in w){w.postMessage({msh:"note",title,body});return w.focus();}}
    return self.clients.openWindow(base.href);
  }));
});
