// Public team pages (/hold/<slug>): data and text helpers shared by api/hold.js and api/sitemap.js.
// Files that start with "_" do not become endpoints on Vercel.
//
// The display rules are the app's own (index.html) and must stay identical: home team first
// ("Real Betis – Barça", score home–away), Danish dates, Danish sport names, Danish time.
// scripts/check-hold.mjs compares these functions with the ones in index.html and fails if they differ.

export const TZ = "Europe/Copenhagen";
// Production address. A custom domain is picked up from the request host; set SITE_URL on Vercel to force one.
export const SITE = "https://sportshubdk-sigma.vercel.app";
export const SNAPSHOT_URL = "https://raw.githubusercontent.com/tinerc2-jpg/My-Sports-Hub/live-data/live.json";

// ── Copies of the app's helpers (index.html) ───────────────────────────────────
export function norm(s) {
  return String(s || "").replace(/[øØ]/g, "o").replace(/[æÆ]/g, "ae").replace(/ß/g, "ss").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ").replace(/\b(fc|cf|afc|ssc|sc|ac|club|de|the|handbold|handball)\b/g, " ").replace(/\s+/g, " ").trim();
}
const DA_WD = { Mon: "man", Tue: "tir", Wed: "ons", Thu: "tor", Fri: "fre", Sat: "lør", Sun: "søn" };
const DA_MO = { Jan: "jan", Feb: "feb", Mar: "mar", Apr: "apr", May: "maj", Jun: "jun", Jul: "jul", Aug: "aug", Sep: "sep", Oct: "okt", Nov: "nov", Dec: "dec" };
export function daD(s) {
  if (typeof s !== "string") return s;
  const MO = "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)"; // "Sept": how en-GB writes September in newer browsers
  return s.replace(new RegExp("\\b(\\d{1,2}) " + MO + "\\b", "g"), (m, d, mo) => d + ". " + DA_MO[mo.slice(0, 3)])
    .replace(new RegExp("\\b" + MO + " (\\d{1,2})\\b", "g"), (m, mo, d) => d + ". " + DA_MO[mo.slice(0, 3)])
    .replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/g, (m) => DA_WD[m]).replace(/\bToday\b/, "I dag").replace(/\bTomorrow\b/, "I morgen")
    .replace(/\bSeason complete\b/, "Sæsonen er slut").replace(/^Off-season$/, "Uden for sæsonen").replace(/\bTBD\b/, "Ikke fastsat");
}
export function daDetail(x) {
  const t = String(x || "");
  return /^(half.?time|ht)$/i.test(t.trim()) ? "Pause" : /^(full.?time|ft|final)$/i.test(t.trim()) ? "Slut" : /^in progress$/i.test(t.trim()) ? "I gang" : t;
}
export function daRound(s) {
  return String(s || "").replace(/\bQuarterfinals?\b/g, "kvartfinale").replace(/\bSemifinals?\b/g, "semifinale").replace(/\bFinal\b/g, "finale")
    .replace(/\bRound (\d+)\b/g, "$1. runde").replace(/\bRound of (\d+)\b/g, "sidste $1");
}
// Home team first, as in football everywhere: "(A)" = away game → "Real Betis – Barça", score home–away.
export function fixture(team, opp, score) {
  const o = String(opp || ""), m = /\((H|A)\)/.exec(o), away = !!m && m[1] === "A", tag = (o.match(/\s·\s(.+)$/) || [])[1] || "";
  const name = daRound(o.replace(/\s*\((H|A)\)/, "").replace(/\s·\s.+$/, "").trim()), me = team.shortName || team.name;
  const sc = score && away && /^\d+\s*[–-]\s*\d+$/.test(score) ? score.split(/\s*[–-]\s*/).reverse().join("–") : score;
  return { title: !m ? me + " mod " + name : away ? name + " – " + me : me + " – " + name, score: sc, where: !m ? "" : away ? "Udekamp" : "Hjemmekamp", away, tag, name };
}
// "Bayern Munich 0–1 Arsenal": home team first with the score in home–away order; null when home/away is unknown.
export function scoreLine(team, opp, score) {
  if (!/\((H|A)\)/.test(opp || "")) return null;
  const f = fixture(team, opp, score), me = team.shortName || team.name;
  return (f.away ? f.name + " " + f.score + " " + me : me + " " + f.score + " " + f.name) + (f.tag ? " · " + f.tag : "");
}
const SPORT_DA = { "Football": "Fodbold", "Handball": "Håndbold", "Tennis": "Tennis", "Basketball": "Basketball", "Golf": "Golf", "Cycling": "Cykling", "Formula 1": "Formel 1", "Ice Hockey": "Ishockey", "Am. Football": "Am. fodbold", "Rugby": "Rugby", "Baseball": "Baseball", "Volleyball": "Volleyball", "Trav": "Trav" };
export const spDa = (s) => SPORT_DA[s] || s || "";
const OFF_WORDS = ["uden for sæsonen", "sæsonen er slut", "ingen kommende", "season complete", "off-season", "off season", "pre-season", "training camp", "offseason", "season ended", "eliminated", "no upcoming"];

// ── Only for the team pages ────────────────────────────────────────────────────
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Address of a team page: Danish letters the Danish way (ø → oe, æ → ae, å → aa), "FC København" → "fc-koebenhavn".
export function slugify(name) {
  return String(name || "").replace(/[øØ]/g, "oe").replace(/[æÆ]/g, "ae").replace(/[åÅ]/g, "aa").replace(/ß/g, "ss").normalize("NFD")
    .replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}
const fLong = new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long", timeZone: TZ });
const fShort = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: TZ }); // the app's fmtDay
const fDate = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "long", year: "numeric", timeZone: TZ });
const fTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ }); // "18:00", as in the app
const fYmd = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TZ });
export const dayLong = (ts) => fLong.format(new Date(ts));   // "lørdag den 14. november"
export const dayShort = (ts) => daD(fShort.format(new Date(ts)).replace(",", "")); // "lør 14. nov", as the app writes it
export const dayFull = (ts) => fDate.format(new Date(ts));   // "14. november 2026"
export const clock = (ts) => fTime.format(new Date(ts));
export const ymd = (ts) => fYmd.format(new Date(ts));        // "2026-11-14" in Danish time

// Tv: the sources also give American channels (FS2, ESPN+ …) that nobody in Denmark can turn on. Only channels sold here are shown.
const DK_CHANNEL = /viaplay|tv ?2|tv ?3|disney|prime video|\bdr ?\d|\bdr ?tv|\bmax\b|discovery|eurosport|v sport|dazn|ehf ?tv|kanal ?5|6'?eren|atg|sport live/i;
export const dkTv = (tv) => (tv && tv !== "–" && tv !== "-" && DK_CHANNEL.test(String(tv)) ? String(tv) : "");

const SOLO = ["Formula 1", "Golf", "Cycling", "Trav"];     // the "opponent" is a race, a tournament or a round
const PERSON = ["Tennis", "Golf", "Formula 1", "Cycling"];
const HEX = /^#[0-9a-f]{3,8}$/i;

// Sport, league, short name and colours of a team: the robot's `meta` (DB teams) or its league list.
export function metaFor(name, snap) {
  const m = snap && snap.meta && snap.meta[name];
  const x = !m && snap && Array.isArray(snap.leagueTeams) ? snap.leagueTeams.find((t) => t && t.name === name) : null;
  const src = m ? { short: m.s, sport: m.sp, league: m.lg, country: m.c, color: m.col, emoji: m.e }
    : x ? { short: x.shortName, sport: x.sport, league: x.league, country: x.country, color: x.color, emoji: x.emoji } : {};
  return {
    name, short: String(src.short || name), sport: String(src.sport || ""), league: String(src.league || ""), country: String(src.country || ""),
    color: HEX.test(src.color || "") ? src.color : "#e8409a", emoji: String(src.emoji || ""),
  };
}

// Every team in the snapshot with its page address. A short name ("gog") leads to the page too, when it is unambiguous.
export function buildIndex(snap) {
  const teams = [], bySlug = new Map(), alias = new Map(), shared = new Set();
  for (const name of Object.keys((snap && snap.teams) || {})) {
    const slug = slugify(name);
    if (!slug || bySlug.has(slug)) continue;
    const meta = metaFor(name, snap), t = { name, slug, meta, ts: (snap.teams[name] && snap.teams[name].ts) || 0 };
    teams.push(t); bySlug.set(slug, t);
  }
  for (const t of teams) for (const a of new Set([slugify(t.meta.short), slugify(norm(t.name))])) {
    if (!a || bySlug.has(a) || shared.has(a)) continue;
    if (alias.has(a) && alias.get(a) !== t.slug) { alias.delete(a); shared.add(a); continue; } // two teams share it: nobody gets it
    alias.set(a, t.slug);
  }
  return { teams, bySlug, alias };
}

// What a team page shows, worked out from the robot's entry. `now` is passed in so the checks can use a fixed time.
export function teamModel(t, snap, now = Date.now()) {
  const e = (snap.teams && snap.teams[t.name]) || {}, d = e.data || {}, meta = t.meta;
  const team = { name: t.name, shortName: meta.short }, solo = SOLO.includes(meta.sport), person = PERSON.includes(meta.sport);
  const ts = e.ts || 0, stale = !ts || now - ts > 36 * 3600e3;
  const title = (opp) => solo ? daRound(String(opp || "").replace(/^Next tour event:?\s*/i, "")) : fixture(team, opp).title;
  const game = (g) => {
    const f = solo ? { where: "", tag: "", away: false } : fixture(team, g.opponent);
    const timed = !g.tba && g.time !== "–" && g.time !== "-" && g.time !== "";
    return {
      title: title(g.opponent), tag: f.tag, where: f.where, away: f.away, ts: g.ts || 0,
      date: g.ts ? dayLong(g.ts) : daD(g.date || ""), dateShort: g.ts ? dayShort(g.ts) : daD(g.date || ""),
      time: g.tba ? "" : g.ts && timed ? clock(g.ts) : timed && g.time ? String(g.time) : "", tba: !!g.tba,
      tv: dkTv(g.tv),
    };
  };

  let live = null;
  if (d.liveGame && !stale) {
    const g = d.liveGame, f = solo ? null : fixture(team, g.opponent, g.score);
    live = { title: f ? f.title : String(g.opponent || ""), score: String((f ? f.score : g.score) || ""), detail: g.detail && g.detail !== "Live" ? daDetail(g.detail) : "" };
  }

  let next = null, off = "";
  const g = d.nextGame;
  if (g && g.opponent) {
    const low = (String(g.opponent) + " " + String(g.date || "")).toLowerCase();
    if (OFF_WORDS.some((k) => low.includes(k))) off = g.offTitle || "Sæsonen er slut";
    else if (g.ts && g.ts < now - 3 * 3600e3) off = "";            // already played: the entry is waiting for the next fixture
    else if (!g.ts && stale) off = "";                              // an old entry without a time stamp cannot be trusted
    else next = game(g);
  }

  // An entry the robot couldn't refresh (stale) only keeps results that carry a date from the last 30 days.
  const fresh = (r) => !stale || (r.ts && now - r.ts < 30 * 864e5);
  const results = (Array.isArray(d.recentResults) ? d.recentResults : []).filter((r) => r && r.opponent && fresh(r)).slice(0, 5).map((r) => {
    const line = solo ? null : scoreLine(team, r.opponent, r.score);
    const label = r.label && r.label !== "🏁" ? String(r.label) : "";
    return {
      text: line || title(r.opponent),
      score: line ? "" : solo ? [label, r.score && label ? "(" + r.score + ")" : r.score].filter(Boolean).join(" ") : String(r.score || ""),
      word: solo ? "" : r.result === "W" ? "Sejr" : r.result === "L" ? "Nederlag" : r.result === "D" ? "Uafgjort" : "",
      res: solo ? "" : String(r.result || ""), date: r.ts ? dayShort(r.ts) : daD(r.date || ""),
    };
  });

  const s = d.standing || null;
  let standing = null;
  if (s && (s.rank != null || s.points != null || (Array.isArray(s.table) && s.table.length))) {
    const rows = (Array.isArray(s.table) ? s.table : []).filter((r) => r && r.n != null).slice(0, 40);
    const has = (k) => rows.some((r) => r[k] != null);
    standing = {
      rank: s.rank ?? null, points: s.points ?? null, wins: s.wins ?? null, draws: s.draws ?? null, losses: s.losses ?? null,
      // as in the app: tennis and golf show a ranking, everything else a place (F1 with its note, leagues with group or league)
      kind: meta.sport === "Tennis" || meta.sport === "Golf" ? "rank" : "place",
      sub: meta.sport === "Tennis" || meta.sport === "Golf" ? "" : String(s.note && s.wins == null ? s.note : s.group || meta.league || ""),
      from: String(d.standingFrom || s.from || ""), rows,
      cols: [["p", "K", "Kampe"], ["w", "V", "Vundne"], ["d", "U", "Uafgjorte"], ["l", "T", "Tabte"], ["gd", "+/-", "Målforskel"], ["pts", "P", "Point"]].filter(([k]) => has(k)),
    };
  }

  const upcoming = (Array.isArray(d.upcoming) ? d.upcoming : [])
    .filter((u) => u && u.opponent && u.ts && u.ts > now - 3 * 3600e3 && !(next && next.ts === u.ts)).slice(0, 5).map(game);
  // News: real headlines only. The feeds also return score, stats and schedule listings ("GOG vs Sporting scores & schedule").
  const LISTING = /\b(scores?|stats|standings|squad|schedule|highlights|odds|predictions?|live stream)\b/i;
  const news = (Array.isArray(d.news) ? d.news : []).filter((n) => n && n.title && /^https?:\/\//i.test(n.url || "") && !LISTING.test(n.title)
    && (!n.ts || now - n.ts < 30 * 864e5)).slice(0, 4)
    .map((n) => ({ title: String(n.title), url: String(n.url), src: String(n.src || ""), date: n.ts ? dayShort(n.ts) : "" }));

  return {
    // a page with nothing to tell (no game, result, table or news) is not offered to search engines
    hasContent: !!(live || next || results.length || standing || news.length),
    name: t.name, slug: t.slug, short: meta.short, label: person ? t.name : meta.short, sport: meta.sport, sportDa: spDa(meta.sport), league: meta.league, country: meta.country,
    color: meta.color, emoji: meta.emoji, person, solo, live, next, off, results, standing, upcoming, news, ts, stale,
    source: [...new Set(String(d.source || "").split(" + "))].join(" + "), newsOnly: !!d.newsOnly, // "Top Håndbold + Top Håndbold" → once
    nextLabel: meta.sport === "Golf" ? "Næste turnering" : meta.sport === "Formula 1" || meta.sport === "Cycling" ? "Næste løb" : meta.sport === "Trav" ? "Næste omgang" : "Næste kamp",
  };
}

// Reads the robot's snapshot, at most once every 5 minutes per server instance; an older copy is used if GitHub is down.
let _snap = null, _snapTs = 0;
export async function loadSnapshot() {
  if (_snap && Date.now() - _snapTs < 5 * 60e3) return _snap;
  try {
    const r = await fetch(process.env.SNAPSHOT_URL || SNAPSHOT_URL, { headers: { "User-Agent": "MySportsHub/1.0 (+https://github.com/tinerc2-jpg/My-Sports-Hub)" } });
    if (!r.ok) throw new Error("snapshot " + r.status);
    const j = await r.json();
    if (!j || typeof j.teams !== "object") throw new Error("snapshot without teams");
    _snap = j; _snapTs = Date.now();
  } catch (e) {
    console.error("team pages:", e.message);
    if (!_snap) throw e;
  }
  return _snap;
}

// The site's own address: SITE_URL if set, the production address on *.vercel.app, else the host that was asked for (a custom domain).
export function siteBase(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, "");
  const host = String((req && req.headers && (req.headers["x-forwarded-host"] || req.headers.host)) || "").split(",")[0].trim().toLowerCase();
  if (!host || /\.vercel\.app$/.test(host) || !/^[a-z0-9.-]+(:\d+)?$/.test(host)) return SITE;
  return (/^(localhost|127\.)/.test(host) ? "http://" : "https://") + host;
}
