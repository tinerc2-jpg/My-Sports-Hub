// Public team pages that search engines can read: /hold (all teams) and /hold/<slug> (one team).
// vercel.json rewrites those addresses to this function. The data is the robot's snapshot (live.json on
// the live-data branch); Vercel's CDN keeps each page for a few minutes, so the function runs rarely.
import { loadSnapshot, buildIndex, teamModel, siteBase } from "./_teamfmt.js";
import { teamPage, indexPage, messagePage } from "./_holdpage.js";

// Vercel's CDN keeps a page for 5 minutes (and may hand out that copy for 10 more while it fetches a new one);
// around a game – live now or starting within 3 hours – only for a minute, so the page turns to live and back in time.
const CACHE = "public, max-age=0, s-maxage=300, stale-while-revalidate=600";
const CACHE_GAME = "public, max-age=0, s-maxage=60, stale-while-revalidate=120";

function html(req, res, status, body, cache) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", cache);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(req.method === "HEAD" ? undefined : body);
}

// The slug comes from the rewrite (?slug=…, already decoded) or, without one, from the path itself (/hold/<slug>).
// null = no slug at all (the list of all teams); anything that isn't a proper slug ends as "not found" further down.
function slugOf(req) {
  let s = req.query && req.query.slug;
  if (Array.isArray(s)) s = s[0];
  if (s == null) {
    const u = new URL(req.url || "/", "http://x");
    s = u.searchParams.get("slug");
    const m = s == null && /^\/hold\/([^/]+)\/?$/.exec(u.pathname);
    if (m) { try { s = decodeURIComponent(m[1]); } catch { s = "%"; } }
  }
  return s == null || s === "" ? null : String(s).trim().toLowerCase();
}

export default async function handler(req, res) {
  const base = siteBase(req);
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return html(req, res, 405, messagePage({ base, title: "Siden kan kun læses", text: "Denne adresse viser en holdside.", path: "/hold" }), "no-store");
  }
  let snap;
  try { snap = await loadSnapshot(); } catch (e) {
    return html(req, res, 503, messagePage({ base, title: "Holdsiden kan ikke vises lige nu", text: "Vi kunne ikke hente de nyeste resultater. Prøv igen om lidt, eller åbn appen.", path: "/hold" }), "no-store");
  }
  try {
    const index = buildIndex(snap), raw = slugOf(req);
    if (raw === null) return html(req, res, 200, indexPage(index, { base }), CACHE);
    const slug = /^[a-z0-9-]{1,80}$/.test(raw) ? raw : "";
    const t = slug && index.bySlug.get(slug);
    if (t) {
      const m = teamModel(t, snap), soon = m.next && m.next.ts && m.next.ts - Date.now() < 3 * 3600e3;
      return html(req, res, 200, teamPage(m, { base, index }), m.live || soon ? CACHE_GAME : CACHE);
    }
    const to = slug && index.alias.get(slug);
    if (to) { // a short name such as /hold/gog
      res.statusCode = 308; res.setHeader("Location", "/hold/" + to); res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600");
      return res.end();
    }
    return html(req, res, 404, messagePage({ base, title: "Vi kender ikke det hold endnu", text: "Find dit hold på listen, eller åbn appen og ønsk det. Så kommer det med.", path: "/hold" }), "public, max-age=0, s-maxage=300");
  } catch (e) {
    console.error("team page:", e);
    return html(req, res, 500, messagePage({ base, title: "Noget gik galt", text: "Siden kunne ikke vises. Prøv igen om lidt, eller åbn appen.", path: "/hold" }), "no-store");
  }
}
