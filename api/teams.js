// The logged-in user's favourites: {teams:[names], ts}. An empty list is never saved (that is how the
// sync bug of 11 Nov 2026 lost the owner's teams); the previous list is kept as a backup.
import { getJSON, setJSON, requireUser } from "./_lib.js";

export default async function handler(req, res) {
  const u = await requireUser(req, res); if (!u) return;
  try {
    const key = "teams:" + u.id;
    if (req.method === "GET") return res.status(200).json((await getJSON(key)) || { teams: [], ts: 0 });
    if (req.method === "PUT") {
      const t = (req.body || {}).teams;
      if (!Array.isArray(t)) return res.status(400).json({ error: "Missing teams." });
      const teams = [...new Set(t.filter((x) => typeof x === "string" && x.trim()).map((x) => x.slice(0, 60)))].slice(0, 80);
      if (!teams.length) return res.status(400).json({ error: "Not saving an empty list." });
      const old = await getJSON(key);
      if (old && old.teams && old.teams.length) await setJSON("teams-prev:" + u.id, old);
      const v = { teams, ts: Date.now() };
      await setJSON(key, v);
      return res.status(200).json(v);
    }
    res.status(405).json({ error: "Use GET or PUT." });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Server error." });
  }
}
