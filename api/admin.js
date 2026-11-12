// Owner dashboard data (admin.html): accounts and their teams. Only for admin users
// (env ADMIN_USERS, comma-separated user ids; default "admin"). No passwords/hashes are returned.
import { redis, getJSON, requireUser, isAdmin } from "./_lib.js";

export default async function handler(req, res) {
  const u = await requireUser(req, res); if (!u) return;
  if (!isAdmin(u)) return res.status(403).json({ error: "Kun admin kan se dette." });
  try {
    const ids = (await redis("SMEMBERS", "users")) || [];
    const users = [];
    for (const id of ids) {
      const [x, t] = await Promise.all([getJSON("user:" + id), getJSON("teams:" + id)]);
      if (!x) continue;
      users.push({ id, name: x.name, created: x.created || 0, lastLogin: x.lastLogin || 0, lastSeen: x.lastSeen || 0,
        teams: (t && t.teams) || [], teamsTs: (t && t.ts) || 0 });
    }
    users.sort((a, b) => b.created - a.created);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ts: Date.now(), users });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Serverfejl." });
  }
}
