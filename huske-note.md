# Huske-note (14. nov 2026)

**Mål:** My Sports Hub – sportsapp til Tine på Vercel (https://sportshubdk-sigma.vercel.app); robot opdaterer live.json. Nu: fra 145 til 1.000 besøgende om måneden.

**Beslutninger:**
- Design: mørk navy + pink, Google-stil. Hjemmeholdet altid først. Al ny tekst på dansk.
- Test ALT lokalt (telefon+computer) og vis skærmbilleder før udlægning; tjek live-appen bagefter.
- Konto-login (api/, Upstash Redis delt med Kapitly). Admin: /admin.html.
- main deployer automatisk til Vercel.

**Gjort 14/11 (på branch claude/new-session-23d9ff, IKKE lagt ud – venter på Tines ok):** holdsider til Google (/hold og /hold/gog-haandbold), sitemap, robots, delebillede (og.png), "Find dit hold" på forsiden, et link med ét hold åbner holdets side (også ligaklubber).

**Næste:** Tine siger "læg ud" → PR, merge, tjek live, kør robotten (meta). Derefter: Google Search Console, eget domæne (sæt SITE_URL), opslag i GOG-fangruppe. FC Fredericia mangler datakilde (vent med den gruppe).
