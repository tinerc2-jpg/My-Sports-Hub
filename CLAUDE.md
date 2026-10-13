# My Sports Hub

Single-file web app (`index.html`): a landing page plus a React 18 fan dashboard (loaded from cdnjs, written with `React.createElement` as `h`, no build step).

## Structure
- Landing page markup + CSS at the top of `index.html`.
- `mountApp()` contains the dashboard: `DB` (hardcoded team/player data, added via `add([...keys], {...})`), `FS_IDS` (Flashscore links), `HINTS`, components (`App`, `FavBar`, `AddModal`, `NextGame`, `StandingDisplay`, …).
- Favourites persist in `localStorage` (`msh-teams`, `msh-sel`). `refreshFromDB` re-applies DB data on load.
- Live data: `fetchTeamLive(team)` auto-updates results / next game / standings from free CORS APIs — ESPN (football, NBA, NHL, NFL, MLB), Jolpica (F1), TheSportsDB (handball). `resolveSource` finds the team id by name (cached in `msh-src`), results are cached in `msh-live`, and `mergeLive` overlays them on the static DB entry. If a host blocks the browser (CORS), `getJSON` retries via public CORS proxies (`CORS_PROXIES`: corsproxy.io, allorigins) — approved by the owner. Sections still showing static data are labelled "saved May 2026". `App` ticks every 30s; `liveIsStale` decides refetches (1 min during live games / around kickoff, 10 min for the selected team, 30 min for others).
- PWA: inline data-URL manifest + install banner (iOS Safari / `beforeinstallprompt`).

## Known issues / TODO
- Tennis, golf, cycling, rugby, volleyball have no live source yet (static May–June 2026 data). News is always static. Handball has no live standings.
- Live API response formats were written from docs, not verified against the real endpoints in a browser yet.
- `triggerInstall()` reads `window._deferredPrompt`, but the listener stores the event in a local `deferredPrompt` — the Install button does nothing.
- Handball emoji in `SPORTS` is a baseball (`⚾`).
- GOG's recent results / news disagree with the landing-page mockup (Aalborg vs Skanderborg AGF).
- `FS_IDS` key "FC Bayern Munchen" doesn't match DB name "FC Bayern München".

## Run
Open `index.html` in a browser, or `python3 -m http.server` in this folder.
