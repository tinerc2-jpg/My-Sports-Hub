# My Sports Hub

Single-file web app (`index.html`): a landing page plus a React 18 fan dashboard (loaded from cdnjs, written with `React.createElement` as `h`, no build step).

## Structure
- Landing page markup + CSS at the top of `index.html`.
- `mountApp()` contains the dashboard: `DB` (hardcoded team/player data, added via `add([...keys], {...})`), `FS_IDS` (Flashscore links), `HINTS`, components (`App`, `FavBar`, `AddModal`, `NextGame`, `StandingDisplay`, …).
- Favourites persist in `localStorage` (`msh-teams`, `msh-sel`). `refreshFromDB` re-applies DB data on load.
- PWA: inline data-URL manifest + install banner (iOS Safari / `beforeinstallprompt`).

## Known issues / TODO
- All data is static and dated May–June 2026; `fetchTeamLive` is a stub returning `null`.
- `triggerInstall()` reads `window._deferredPrompt`, but the listener stores the event in a local `deferredPrompt` — the Install button does nothing.
- Handball emoji in `SPORTS` is a baseball (`⚾`).
- GOG's recent results / news disagree with the landing-page mockup (Aalborg vs Skanderborg AGF).
- `FS_IDS` key "FC Bayern Munchen" doesn't match DB name "FC Bayern München".

## Run
Open `index.html` in a browser, or `python3 -m http.server` in this folder.
