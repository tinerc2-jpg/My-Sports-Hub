# Huske-note (12. nov 2026)

**Mål:** My Sports Hub – sportsapp til Tine på Vercel (https://sportshubdk-sigma.vercel.app); robot opdaterer live.json. Nu: udbrede appen.

**Beslutninger:**
- Design: mørk navy + pink, Google-stil. Hjemmeholdet altid først. Al ny tekst på dansk.
- Test ALT lokalt (telefon+computer, login, holdside, tilføj hold, vinduer) og vis skærmbilleder før udlægning; tjek live-appen bagefter.
- Konto-login (api/, Upstash Redis delt med Kapitly, `msh:`-nøgler). Admin-dashboard: /admin.html (bruger Admin).
- main deployer automatisk til Vercel. GitHub Pages slukket; gamle adresse sender videre.

**Gjort 12/11:** login/admin-rettelser; hele appen på dansk; del resultat/live som billede.

**Gjort 12/11 (2):** `ReminderOffer` på forsiden: ét tryk = startpåmindelse for alle hold + morgenoversigt; nye hold får den automatisk (`msh-remind-all`). Ligger på branch, ikke merget endnu.

**Næste idéer:** eget domæne (fx mysportshub.dk), del i fangrupper (GOG, FC Fredericia).
