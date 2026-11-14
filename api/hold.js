// Public team pages that search engines can read: /hold (all teams) and /hold/<slug> (one team).
// vercel.json rewrites those addresses to this function. The data is the robot's snapshot (live.json on
// the live-data branch); Vercel's CDN keeps each page for 10 minutes, so the function runs rarely.
import { loadSnapshot, buildIndex, teamModel, siteBase } from "./_teamfmt.js";
import { teamPage, indexPage, messagePage } from "./_holdpage.js";

const CACHE = "public, max-age=0, s-maxage=600, stale-while-revalidate=86400";

function html(req, res, status, body, cache) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", cache);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(req.method === "HEAD" ? undefined : body);
}

// The slug comes from the rewrite (?slug=…) or, without one, from the path itself (/hold/<slug>).
function slugOf(req) {
  let s = req.query && req.query.slug;
  if (Array.isArray(s)) s = s[0];
  if (s == null) {
    const u = new URL(req.url || "/", "http://x");
    s = u.searchParams.get("slug") ?? (/^\/hold\/([^/]+)\/?$/.exec(u.pathname) || [])[1] ?? "";
  }
  try { s = decodeURIComponent(String(s)); } catch { s = ""; }
  return s.trim().toLowerCase().replace(/\/+$/, "");
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
    if (!raw) return html(req, res, 200, indexPage(index, { base }), CACHE);
    const slug = /^[a-z0-9-]{1,80}$/.test(raw) ? raw : "";
    const t = slug && index.bySlug.get(slug);
    if (t) return html(req, res, 200, teamPage(teamModel(t, snap), { base, index }), CACHE);
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
