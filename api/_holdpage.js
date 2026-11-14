// HTML for the public team pages (/hold and /hold/<slug>). Plain server-rendered pages without JavaScript,
// so search engines and link previews read the same thing as people. Colours follow the app (navy + pink).
// Everything that comes from the data is escaped with esc(); links from the data must start with http(s).
import { esc, slugify, norm, spDa, hexColor as color, dayFull, clock, ymd } from "./_teamfmt.js";

const CSS = `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{background:#0f1b33;color:#fff;font-family:Roboto,"Google Sans",system-ui,-apple-system,"Segoe UI",Arial,sans-serif;font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased}
a{color:#ff9fd0}
.top{background:#0a1326;border-bottom:1px solid rgba(255,255,255,.08);padding:calc(12px + env(safe-area-inset-top)) 16px 12px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.logo{color:#fff;font-weight:700;text-decoration:none;font-size:1rem}
.open{background:#fff;color:#141414;font-weight:700;font-size:.85rem;text-decoration:none;padding:8px 16px;border-radius:8px;white-space:nowrap}
main{max-width:720px;margin:0 auto;padding:16px 16px 40px}
.crumbs{font-size:.8rem;color:#d5deee;margin-bottom:14px}
.crumbs a{color:#d5deee}
.hero{background:#16264a;border:1px solid rgba(255,255,255,.1);border-top:4px solid #e8409a;border-radius:14px;padding:18px 16px;display:flex;align-items:center;gap:14px}
.badge{width:56px;height:56px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.6rem;border:1px solid rgba(255,255,255,.25)}
h1{font-size:1.6rem;line-height:1.15;font-weight:700}
.sub{color:#d5deee;font-size:.9rem;margin-top:4px}
.cta{display:block;text-align:center;background:#e8409a;color:#fff;font-weight:700;font-size:1.05rem;text-decoration:none;padding:15px 18px;border-radius:12px;margin-top:14px}
.cta-sub{text-align:center;color:#d5deee;font-size:.82rem;margin-top:8px}
.card{background:#16264a;border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:16px;margin-top:14px}
.next{border-left:4px solid #e8409a}
.live{border:1px solid rgba(239,68,68,.6)}
h2{font-size:.78rem;letter-spacing:1.5px;text-transform:uppercase;color:#d5deee;font-weight:700;margin-bottom:10px}
.live h2{color:#ff9a9a}
.big{font-size:1.25rem;font-weight:700;line-height:1.25}
.score{font-size:2rem;font-weight:900;line-height:1.1;margin-top:4px}
.where{font-size:.85rem;font-weight:700;margin-top:6px;color:#9fe8b0}
.where.away{color:#ffd27a}
.meta{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:10px;color:#d5deee;font-size:.92rem}
.meta .tv{color:#ff9fd0;font-weight:700}
.muted{color:#d5deee;font-size:.9rem}
.stats{display:flex;flex-wrap:wrap;gap:8px}
.stat{flex:1 1 120px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px 12px}
.stat b{display:block;font-size:1.35rem;line-height:1.2}
.stat span{display:block;font-size:.7rem;letter-spacing:1px;text-transform:uppercase;color:#d5deee;margin-top:2px}
.stat small{display:block;font-size:.75rem;color:#d5deee;margin-top:2px}
.tw{overflow-x:auto;margin-top:12px}
table{width:100%;border-collapse:collapse;font-size:.88rem}
th,td{padding:7px 6px;text-align:right;border-bottom:1px solid rgba(255,255,255,.08);white-space:nowrap}
th{color:#d5deee;font-size:.72rem;font-weight:700}
th:nth-child(2),td:nth-child(2){text-align:left;white-space:normal}
td a{color:#fff}
tr.me td{background:rgba(232,64,154,.16);font-weight:700}
ul{list-style:none}
.rows li{display:flex;align-items:baseline;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.08)}
.rows li:last-child{border-bottom:none;padding-bottom:0}
.rows .t{flex:1;font-weight:600}
.rows .d{color:#d5deee;font-size:.8rem;white-space:nowrap}
.w{font-size:.68rem;font-weight:700;letter-spacing:.5px;text-transform:uppercase;min-width:66px}
.w.W{color:#9fe8b0}.w.L{color:#ff9a9a}.w.D{color:#ffd27a}
.news li{padding:9px 0;border-bottom:1px solid rgba(255,255,255,.08)}
.news li:last-child{border-bottom:none;padding-bottom:0}
.news a{color:#fff;font-weight:600;text-decoration:none}
.news small{display:block;color:#d5deee;font-size:.78rem;margin-top:2px}
.why li{padding:4px 0 4px 22px;position:relative}
.why li::before{content:"✓";position:absolute;left:0;color:#9fe8b0;font-weight:700}
.links{display:flex;flex-wrap:wrap;gap:8px}
.links a{display:inline-block;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.13);border-radius:40px;padding:7px 14px;color:#fff;text-decoration:none;font-size:.88rem}
.all{display:inline-block;margin-top:12px;font-weight:700}
h3{font-size:1rem;margin:16px 0 8px}
.intro{color:#d5deee;margin:6px 0 4px}
footer{max-width:720px;margin:0 auto;padding:0 16px calc(32px + env(safe-area-inset-bottom));color:#d5deee;font-size:.8rem}
footer p{margin-top:6px}`;

const jsonld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`;
const followUrl = (m) => `/?app&teams=${encodeURIComponent(m.name)}&utm_campaign=hold-${m.slug}`;
const short160 = (s) => (s.length <= 158 ? s : s.slice(0, 155).replace(/\s+\S*$/, "") + "…");

function shell({ title, desc, path, base, body, ld = [], noindex = false }) {
  const url = base + path;
  return `<!DOCTYPE html>
<html lang="da">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${esc(url)}">`}
<meta property="og:type" content="website">
<meta property="og:site_name" content="My Sports Hub">
<meta property="og:locale" content="da_DK">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(base)}/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0a1326">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>${CSS}</style>
${ld.map(jsonld).join("\n")}
<script data-goatcounter="https://mysportshub.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>
</head>
<body>
<header class="top"><a class="logo" href="/">My Sports Hub</a><a class="open" href="/?app">Åbn appen</a></header>
${body}
</body>
</html>`;
}

const gameMeta = (g) => `<p class="meta">${g.date ? `<span>${esc(g.date)}</span>` : ""}${g.time ? `<span>kl. ${esc(g.time)}</span>` : g.tba ? "<span>Tidspunkt følger</span>" : ""}${g.tv ? `<span class="tv">Tv: ${esc(g.tv)}</span>` : ""}</p>`;

function standingHtml(m, link) {
  const s = m.standing, pts = s.points != null ? Number(s.points).toLocaleString("da-DK") : "–";
  const box = (v, l, sub) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span>${sub ? `<small>${esc(sub)}</small>` : ""}</div>`;
  let boxes = box(s.rank != null ? "#" + s.rank : "–", s.kind === "rank" ? "Rangliste" : "Placering", s.sub) + box(pts, "Point");
  if (s.wins != null) boxes += box(s.wins, "Sejre") + box(`${s.wins}V·${s.draws || 0}U·${s.losses || 0}T`, "V-U-T");
  let table = "";
  if (s.rows.length) {
    const head = `<tr><th scope="col">#</th><th scope="col">${m.person ? "Navn" : "Hold"}</th>${s.cols.map(([, h, long]) => `<th scope="col" title="${esc(long)}">${esc(h)}</th>`).join("")}</tr>`;
    const rows = s.rows.map((r) => {
      const to = !r.me && link(r.n), name = to ? `<a href="/hold/${esc(to)}">${esc(r.n)}</a>` : esc(r.n);
      return `<tr${r.me ? ' class="me"' : ""}><td>${esc(r.r ?? "")}</td><td>${name}</td>${s.cols.map(([k]) => `<td>${esc(r[k] ?? "")}</td>`).join("")}</tr>`;
    }).join("");
    table = `<div class="tw"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
  }
  return `<section class="card"><h2>${s.kind === "rank" ? "Rangliste" : "Stilling"}</h2><div class="stats">${boxes}</div>${table}${s.from ? `<p class="muted" style="margin-top:10px;font-size:.78rem">Kilde: ${esc(s.from)}</p>` : ""}</section>`;
}

function description(m) {
  const n = m.next;
  if (m.live) return short160(`LIVE: ${m.live.title} ${m.live.score}. Følg ${m.label} med live-score, resultater og stilling i My Sports Hub. Gratis og uden reklamer.`);
  if (n && !m.solo) {
    const d = (tv) => `${n.title}${n.tag ? " (" + n.tag + ")" : ""} spilles ${n.date}${n.time ? " kl. " + n.time : ""}${tv ? " på " + tv : ""}. Se seneste resultater${m.standing ? " og stillingen" : ""} for ${m.label}.`;
    return short160(d(n.tv).length <= 158 ? d(n.tv) : d("")); // a long channel text is left out rather than cut
  }
  if (n) return short160(`${m.nextLabel} for ${m.name}: ${n.title}, ${n.date}${n.time ? " kl. " + n.time : ""}. Se seneste resultater${m.standing ? " og placering" : ""}.`);
  if (m.newsOnly) return short160(`Seneste nyt om ${m.name}, samlet ét sted. Følg ${m.label} gratis i My Sports Hub, uden reklamer.`);
  return short160(`Seneste resultater${m.standing ? ", stilling" : ""} og nyheder for ${m.name}. Følg ${m.label} gratis i My Sports Hub, uden reklamer.`);
}

export function teamPage(m, { base, index, now = Date.now() }) {
  // A table row links to that team's page – only within the same sport ("Spurs" in the NBA table is not Tottenham).
  const link = (n) => {
    const a = slugify(n), b = slugify(norm(n)), to = index.bySlug.has(a) ? a : index.alias.get(a) || (index.bySlug.has(b) ? b : index.alias.get(b)) || null;
    return to && index.bySlug.get(to).meta.sport === m.sport ? to : null;
  };
  const sub = [m.sportDa, m.league && m.league !== m.sportDa ? m.league : "", m.country].filter(Boolean).join(" · ");
  const what = m.person ? "næste kamp, resultater og rangliste" : "næste kamp, resultater og stilling";
  const title = `${m.label} – ${m.newsOnly ? "seneste nyt" : m.solo ? "program, resultater og placering" : what} | My Sports Hub`;
  const cta = `<a class="cta" href="${esc(followUrl(m))}">＋ Følg ${esc(m.label)} i My Sports Hub</a>`;
  const parts = [];

  parts.push(`<nav class="crumbs" aria-label="Du er her"><a href="/">Forside</a> › <a href="/hold">Alle hold</a> › ${esc(m.name)}</nav>`);
  parts.push(`<section class="hero" style="border-top-color:${color(m.color)}">${m.emoji ? `<div class="badge" style="background:${color(m.color)}" aria-hidden="true">${esc(m.emoji)}</div>` : ""}<div><h1>${esc(m.name)}</h1>${sub ? `<p class="sub">${esc(sub)}</p>` : ""}</div></section>`);
  parts.push(cta + `<p class="cta-sub">Gratis. Ingen reklamer. Du behøver ikke en konto.</p>`);

  if (m.live) parts.push(`<section class="card live"><h2>Live${m.live.detail ? " · " + esc(m.live.detail) : ""}</h2><p class="big">${esc(m.live.title)}</p><p class="score">${esc(m.live.score)}</p><p class="muted" style="margin-top:8px">Åbn appen for at følge stillingen minut for minut.</p></section>`);

  if (m.next) {
    const n = m.next;
    parts.push(`<section class="card next" style="border-left-color:${color(m.color)}"><h2>${esc(m.nextLabel)}</h2><p class="big">${esc(n.title)}${n.tag ? " · " + esc(n.tag) : ""}</p>${n.where ? `<p class="where${n.away ? " away" : ""}">${esc(n.where)}</p>` : ""}${gameMeta(n)}</section>`);
  } else if (!m.live && !m.newsOnly) {
    parts.push(`<section class="card"><h2>${esc(m.nextLabel)}</h2><p class="big">${esc(m.off || "Ikke fastsat endnu")}</p><p class="muted" style="margin-top:6px">${m.stale ? "Åbn appen for at se det nyeste program." : "Programmet opdateres automatisk, når næste kamp er sat."}</p></section>`);
  }

  if (m.standing) parts.push(standingHtml(m, link));

  if (m.results.length) parts.push(`<section class="card"><h2>Seneste resultater</h2><ul class="rows">${m.results.map((r) =>
    `<li>${r.word ? `<span class="w ${esc(r.res)}">${esc(r.word)}</span>` : ""}<span class="t">${esc(r.text)}${r.score ? " · " + esc(r.score) : ""}</span><span class="d">${esc(r.date)}</span></li>`).join("")}</ul></section>`);

  if (m.upcoming.length) parts.push(`<section class="card"><h2>Kommende kampe</h2><ul class="rows">${m.upcoming.map((u) =>
    `<li><span class="t">${esc(u.title)}${u.tag ? " · " + esc(u.tag) : ""}</span><span class="d">${esc(u.dateShort)}${u.time ? " kl. " + esc(u.time) : ""}</span></li>`).join("")}</ul></section>`);

  if (m.news.length) parts.push(`<section class="card"><h2>Seneste nyt</h2><ul class="news">${m.news.map((n) =>
    `<li><a href="${esc(n.url)}" rel="nofollow noopener noreferrer" target="_blank">${esc(n.title)}</a><small>${esc([n.src, n.date].filter(Boolean).join(" · "))}</small></li>`).join("")}</ul></section>`);

  parts.push(`<section class="card"><h2>Derfor My Sports Hub</h2><ul class="why"><li>Live-score og resultater for ${esc(m.label)}</li><li>Påmindelse før start, hvis du vil</li><li>Tidspunkt og tv-kanal med ét blik</li><li>Alle dine hold og sportsgrene samlet ét sted</li></ul>${cta}</section>`);

  const same = index.teams.filter((t) => t.slug !== m.slug && t.meta.league && t.meta.league === m.league).sort((a, b) => a.meta.short.localeCompare(b.meta.short, "da")).slice(0, 24);
  parts.push(`<section class="card"><h2>${same.length ? "Flere fra " + esc(m.league) : "Flere hold"}</h2>${same.length ? `<p class="links">${same.map((t) => `<a href="/hold/${esc(t.slug)}">${esc(t.meta.short)}</a>`).join("")}</p>` : ""}<a class="all" href="/hold">Se alle hold og spillere ›</a></section>`);

  const today = m.ts && ymd(m.ts) === ymd(now);
  const updated = m.ts ? `Opdateret ${today ? "i dag kl. " + clock(m.ts) : dayFull(m.ts)}` : "";
  const foot = `<footer><p>${esc([updated, m.source ? "Kilde: " + m.source : ""].filter(Boolean).join(" · "))}</p><p>My Sports Hub · Dine hold. Din sport. Altid klar.</p></footer>`;

  const url = `${base}/hold/${m.slug}`;
  const ld = [
    m.person ? { "@context": "https://schema.org", "@type": "Person", name: m.name, url, ...(m.sportDa ? { jobTitle: m.sportDa } : {}) }
      : { "@context": "https://schema.org", "@type": "SportsTeam", name: m.name, url, ...(m.sportDa ? { sport: m.sportDa } : {}), ...(m.league ? { memberOf: { "@type": "SportsOrganization", name: m.league } } : {}) },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Forside", item: base + "/" }, { "@type": "ListItem", position: 2, name: "Alle hold", item: base + "/hold" },
      { "@type": "ListItem", position: 3, name: m.name, item: url }] },
  ];
  if (m.next && m.next.ts && !m.solo && m.next.where && !m.next.tba) {
    const [home, away] = m.next.title.split(" – ");
    if (home && away) ld.push({ "@context": "https://schema.org", "@type": "SportsEvent", name: m.next.title, startDate: new Date(m.next.ts).toISOString(), eventStatus: "https://schema.org/EventScheduled", url,
      homeTeam: { "@type": "SportsTeam", name: home }, awayTeam: { "@type": "SportsTeam", name: away } });
  }
  return shell({ title, desc: description(m), path: "/hold/" + m.slug, base, ld, noindex: !m.hasContent, body: `<main>${parts.join("\n")}</main>\n${foot}` });
}

export function indexPage(index, { base }) {
  const bySport = new Map();
  for (const t of index.teams) {
    const sp = t.meta.sport ? t.meta.sport : "Andre", lg = t.meta.league || "";
    if (!bySport.has(sp)) bySport.set(sp, new Map());
    const m = bySport.get(sp); if (!m.has(lg)) m.set(lg, []); m.get(lg).push(t);
  }
  const order = ["Football", "Handball", "Tennis", "Golf", "Cycling", "Formula 1", "Basketball", "Ice Hockey", "Am. Football", "Baseball", "Rugby", "Volleyball", "Trav", "Andre"];
  const sports = [...bySport.keys()].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  const body = sports.map((sp) => {
    const leagues = [...bySport.get(sp).entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "da"));
    return `<section class="card"><h2>${esc(spDa(sp))}</h2>${leagues.map(([lg, ts]) =>
      `${lg && leagues.length > 1 ? `<h3>${esc(lg)}</h3>` : ""}<p class="links">${ts.sort((a, b) => a.meta.short.localeCompare(b.meta.short, "da")).map((t) => `<a href="/hold/${esc(t.slug)}">${esc(t.meta.short)}</a>`).join("")}</p>`).join("")}</section>`;
  }).join("\n");
  const ld = [{ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "Forside", item: base + "/" }, { "@type": "ListItem", position: 2, name: "Alle hold", item: base + "/hold" }] }];
  return shell({
    title: "Alle hold og spillere – næste kamp, resultater og stilling | My Sports Hub",
    desc: "Find dit hold: næste kamp, tv-kanal, seneste resultater og stilling for " + index.teams.length + " hold og spillere i fodbold, håndbold, tennis, golf, Formel 1 og mere. Gratis og uden reklamer.",
    path: "/hold", base, ld,
    body: `<main><nav class="crumbs" aria-label="Du er her"><a href="/">Forside</a> › Alle hold</nav><h1>Alle hold og spillere</h1><p class="intro">Vælg et hold for at se næste kamp, seneste resultater og stillingen. Du kan følge alle dine hold samlet i appen.</p><a class="cta" href="/?app">Åbn My Sports Hub</a>\n${body}</main>\n<footer><p>My Sports Hub · Dine hold. Din sport. Altid klar.</p></footer>`,
  });
}

export function messagePage({ base, title, text, path }) {
  return shell({ title: title + " | My Sports Hub", desc: text, path, base, noindex: true,
    body: `<main><h1>${esc(title)}</h1><p class="intro">${esc(text)}</p><a class="cta" href="/hold">Se alle hold og spillere</a></main>` });
}
