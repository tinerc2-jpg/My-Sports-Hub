# Huske-note (11. nov 2026)

**Mål:** My Sports Hub – sportsapp til Tine (GitHub Pages; robot opdaterer live.json).

**Beslutninger:**
- Design: mørk navy + pink i Google-stil (Roboto, flade kort, farvestriber). Godkendt 6/11.
- Hjemmeholdet står altid først (scoreLine/fixture).
- Robotten kører selv i løkke, skifter ikke job under kampe.
- Ét tjek før dagens første kamp (daglig rutine); ugentlig/månedlig brugsrapport; daglig tjek af holdønsker.
- Udvikl lokalt og vis skærmbilleder før noget lægges ud.
- Sync (11/11): fejl tømte Tines liste; rettet (#138): enhed der joiner venter, tom liste tages aldrig. Kode kan skrives ind i appen (#139). `?restore&teams=…` slår sync fra og lægger hold ind.

**Åbne opgaver:**
- Vercel: projektet er ikke oprettet endnu (navnet "mysportshub" blev afvist – prøv fx "sportshubdk"). vercel.json er klar.
- Spørg om GitHub Pages skal blive ved, når Vercel kører.

**Næste skridt:** Tjek at Tines hold er tilbage i hjemmeskærm-appen (via kode). Hjælp Tine med Vercel-import (navn uden bindestreg).
