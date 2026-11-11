// My Sports Hub API (copied from Kapitly): storage, passwords and the login cookie.
// Fælles kode for API'et: lager, adgangskoder og login-cookie.
// Filer der starter med "_" bliver ikke til selvstændige endpoints på Vercel.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// --- Lager -----------------------------------------------------------------
// Online: Upstash Redis (oprettet via Vercel → Storage). Navnene afhænger af integrationen.
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const IS_HOSTED = ["production", "preview"].includes(process.env.VERCEL_ENV);
// Lokalt uden Redis: en JSON-fil i systemets temp-mappe (kun til udvikling). Den ligger
// uden for projektet, fordi "vercel dev" genstarter, når filer i projektmappen ændres.
const DEV_FILE = path.join(os.tmpdir(), "msh-dev-db.json");

function devDb() { try { return JSON.parse(fs.readFileSync(DEV_FILE, "utf8")); } catch { return {}; } }
function devCmd([cmd, key, ...args]) {
  const db = devDb(); let out = null;
  switch (cmd) {
    case "GET": out = db[key] ?? null; break;
    case "SET": db[key] = args[0]; out = "OK"; break;
    case "DEL": out = key in db ? 1 : 0; delete db[key]; break;
    case "INCR": db[key] = String(Number(db[key] || 0) + 1); out = Number(db[key]); break;
    case "EXPIRE": out = 1; break; // udløb ignoreres lokalt
    case "SADD": db[key] = [...new Set([...(db[key] || []), args[0]])]; out = 1; break;
    case "SREM": db[key] = (db[key] || []).filter((x) => x !== args[0]); out = 1; break;
    case "SMEMBERS": out = db[key] || []; break;
    default: throw new Error("Ukendt kommando " + cmd);
  }
  fs.writeFileSync(DEV_FILE, JSON.stringify(db));
  return out;
}
// The Redis database is shared with Kapitly, so every key gets the "msh:" prefix (keys are always the 2nd item).
export async function redis(c0, key, ...rest) {
  const cmd = [c0, "msh:" + key, ...rest];
  if (!REDIS_URL) {
    if (IS_HOSTED) throw new Error("Databasen er ikke sat op (mangler Upstash Redis i Vercel).");
    return devCmd(cmd);
  }
  const r = await fetch(REDIS_URL, { method: "POST", headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `Databasefejl ${r.status}`);
  return j.result;
}
export const getJSON = async (k) => { const v = await redis("GET", k); return v ? JSON.parse(v) : null; };
export const setJSON = (k, v) => redis("SET", k, JSON.stringify(v));

// --- Brugere ---------------------------------------------------------------
export const userId = (name) => String(name || "").trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9æøå_-]/g, "").slice(0, 40);
export const getUser = (id) => getJSON("user:" + id);
export const saveUser = async (u) => { await setJSON("user:" + u.id, u); await redis("SADD", "users", u.id); };
export const isAdmin = (u) => !!u && (process.env.ADMIN_USERS || "admin").split(",").map((s) => s.trim().toLowerCase()).includes(u.id);
export const publicUser = (u) => ({ id: u.id, name: u.name, ...(isAdmin(u) ? { admin: true } : {}) });

export function hashPassword(pw, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(String(pw), salt, 32).toString("hex") };
}
export function checkPassword(u, pw) {
  const { hash } = hashPassword(pw, u.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(u.hash, "hex"));
}
// --- Login-cookie ----------------------------------------------------------
// Lokalt kører hver forespørgsel i sin egen proces, så den lokale nøgle gemmes i temp-mappen.
let devSecret;
function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (IS_HOSTED) throw new Error("SESSION_SECRET mangler i Vercel.");
  if (devSecret) return devSecret;
  const f = path.join(os.tmpdir(), "msh-dev-secret");
  try { devSecret = fs.readFileSync(f, "utf8").trim(); } catch {}
  if (!devSecret) { devSecret = crypto.randomBytes(32).toString("hex"); fs.writeFileSync(f, devSecret); }
  return devSecret;
}
const sign = (p) => crypto.createHmac("sha256", secret()).update(p).digest("base64url");
const COOKIE = "msh";
const DAYS = 365;

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter(([k]) => k).map(([k, ...v]) => [k, v.join("=")]));
}
export function setSession(res, u) {
  const p = Buffer.from(JSON.stringify({ u: u.id, v: u.sv || 0, exp: Date.now() + DAYS * 864e5 })).toString("base64url");
  res.setHeader("Set-Cookie", `${COOKIE}=${p}.${sign(p)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DAYS * 86400}${IS_HOSTED ? "; Secure" : ""}`);
}
export function clearSession(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${IS_HOSTED ? "; Secure" : ""}`);
}
export async function currentUser(req) {
  const t = cookies(req)[COOKIE]; if (!t) return null;
  const [p, s] = t.split("."); if (!p || !s) return null;
  const good = sign(p); if (s.length !== good.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) return null;
  let d; try { d = JSON.parse(Buffer.from(p, "base64url").toString()); } catch { return null; }
  if (!d.exp || d.exp < Date.now()) return null;
  const u = await getUser(d.u);
  return u && (u.sv || 0) === d.v ? u : null; // sv tælles op ved ny kode → gamle logins udløber
}
export async function requireUser(req, res) {
  let u;
  try { u = await currentUser(req); } catch (e) { res.status(500).json({ error: e.message }); return null; }
  if (!u) { res.status(401).json({ error: "Please log in." }); return null; }
  return u;
}
