// /sitemap.xml (every team page, for search engines) and /robots.txt (?robots=1). vercel.json rewrites both here,
// so the addresses always carry the host the site is served on (also after a move to its own domain).
import { loadSnapshot, buildIndex, teamModel, siteBase, ymd } from "./_teamfmt.js";

const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

export default async function handler(req, res) {
  const base = siteBase(req), u = new URL(req.url || "/", "http://x");
  const robots = u.searchParams.get("robots") === "1" || (req.query && String(req.query.robots) === "1");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (robots) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=86400");
    return res.end(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin.html\n\nSitemap: ${base}/sitemap.xml\n`);
  }
  let index, snap;
  try { snap = await loadSnapshot(); index = buildIndex(snap); } catch (e) {
    res.statusCode = 503; res.setHeader("Content-Type", "text/plain; charset=utf-8"); res.setHeader("Cache-Control", "no-store");
    return res.end("Sitemap er ikke klar lige nu.");
  }
  const urls = [{ loc: base + "/" }, { loc: base + "/hold" }, ...index.teams.filter((t) => teamModel(t, snap).hasContent).map((t) => ({ loc: `${base}/hold/${t.slug}`, lastmod: t.ts ? ymd(t.ts) : "" }))];
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
  res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((x) =>
    `<url><loc>${xml(x.loc)}</loc>${x.lastmod ? `<lastmod>${x.lastmod}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`);
}
