# Huske-note (11. nov 2026)

**Mål:** My Sports Hub – sportsapp til Tine (GitHub Pages + nu Vercel; robot opdaterer live.json).

**Beslutninger:**
- Design: mørk navy + pink, Google-stil. Hjemmeholdet altid først.
- Udvikl lokalt og vis skærmbilleder før noget lægges ud.
- Konto-login som i Kapitly (api/, Upstash Redis delt med Kapitly, nøgler med `msh:`-forstavelse).
- Vercel-projekt `sportshubdk` (team "kapitly") – https://sportshubdk-sigma.vercel.app. IKKE koblet til GitHub (Tine mangler GitHub Login Connection), så deploy sker via Vercel-API med token (gemt i miljøet).
- Sync-fejl 11/11 tømte Tines hold; rettet, liste gendannet.

**Åbne opgaver:**
- Tine skal teste login på Vercel-adressen og lægge appen på hjemmeskærmen derfra.
- Evt. koble Vercel til GitHub (Login Connection), så main deployer automatisk.
- Spørg om GitHub Pages skal blive ved.
