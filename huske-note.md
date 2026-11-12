# Huske-note (12. nov 2026)

**Mål:** My Sports Hub – sportsapp til Tine (GitHub Pages + nu Vercel; robot opdaterer live.json).

**Beslutninger:**
- Design: mørk navy + pink, Google-stil. Hjemmeholdet altid først.
- Udvikl lokalt og vis skærmbilleder før noget lægges ud. Test ALT (telefon+computer, login, holdside, tilføj hold) før udlægning, og tjek live-appen bagefter.
- Konto-login som i Kapitly (api/, Upstash Redis delt med Kapitly, nøgler med `msh:`-forstavelse).
- Vercel-projekt `sportshubdk` (team "kapitly") – https://sportshubdk-sigma.vercel.app. koblet til GitHub 11/11 – main deployer automatisk.
- Sync-fejl 11/11 tømte Tines hold; rettet, liste gendannet.

- 11/11: gamle adresse tager brugernes hold med til Vercel; "What's new" fortæller om ny adresse + login.
- Admin-dashboard: sportshubdk-sigma.vercel.app/admin.html (kun bruger Admin): konti, hold, forbrug, ønsker.

**Åbne opgaver:**
- Login virker (bruger Admin), alle hold er på kontoen. Tine kan lægge Vercel-appen på hjemmeskærmen.
- GitHub Pages slukket 11/11: gamle adresse sender videre til Vercel.
- 12/11: telefontjek af login/admin: titel på én linje, login-bekræftelse på velkomst, admin kan åbne velkomstsiden (kontokort).
