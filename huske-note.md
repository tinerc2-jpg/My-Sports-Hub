# Huske-note (5. nov 2026)
**Mål:** Tine vil have brugsdata for appen 1 gang om måneden som regneark (Google Sheets).
**Besluttet:**
- Robotten henter GoatCounter-tal for 30 dage hver time (`live.json.usage`): besøgende, pr. dag, sider, åbnet fra notifikation, lande, regioner, systemer, browsere, skærme, henvisninger, kampagner.
- Ugentlig rapport er nu månedlig (1. i måneden 8.52): laver `usage/brugsdata-ÅÅÅÅ-MM.xlsx` på grenen `usage-reports`.
- Ingen Google-connector → .xlsx, som Tine uploader til Drive og åbner med Google Sheets.
**Lavet:** `usage/brugsdata-2026-11-05.xlsx` til Tines Claude-session 6. nov.
**Åbent:** Forbind Google Drive i claude.ai, hvis rapporten skal blive et rigtigt Google Sheet.
