// Log in, create account, log out, "who am I".
import { redis, getUser, saveUser, userId, publicUser, hashPassword, checkPassword, setSession, clearSession, currentUser } from "./_lib.js";

const MIN_PW = 6;

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const u = await currentUser(req);
      return res.status(200).json({ user: u ? publicUser(u) : null });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
    const { action, name, password } = req.body || {};
    if (action === "logout") { clearSession(res); return res.status(200).json({ ok: true }); }

    const id = userId(name);
    if (!id || id.length < 2 || !password) return res.status(400).json({ error: "Type a name and a password." });

    if (action === "signup") {
      if (String(password).length < MIN_PW) return res.status(400).json({ error: `The password must be at least ${MIN_PW} characters.` });
      const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "x";
      const k = "signups:" + ip;
      if (Number(await redis("GET", k)) >= 10) return res.status(429).json({ error: "Too many new accounts. Try again later." });
      if (await getUser(id)) return res.status(409).json({ error: "That name is taken – pick another, or log in." });
      await redis("INCR", k); await redis("EXPIRE", k, 3600);
      const u = { id, name: String(name).trim().slice(0, 40), sv: 0, created: Date.now(), ...hashPassword(password) };
      await saveUser(u);
      setSession(res, u);
      return res.status(200).json({ user: publicUser(u) });
    }

    if (action === "login") {
      const failKey = "fail:" + id;
      if (Number(await redis("GET", failKey)) >= 10) return res.status(429).json({ error: "Too many wrong tries. Wait 15 minutes." });
      const u = await getUser(id);
      if (!u || !checkPassword(u, password)) {
        await redis("INCR", failKey); await redis("EXPIRE", failKey, 900);
        return res.status(401).json({ error: "Wrong name or password." });
      }
      await redis("DEL", failKey);
      u.lastLogin = Date.now(); await saveUser(u);
      setSession(res, u);
      return res.status(200).json({ user: publicUser(u) });
    }
    res.status(400).json({ error: "Unknown action." });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Server error." });
  }
}
