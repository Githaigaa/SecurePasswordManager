"use strict";

// Local-only UI bridge. Decrypted values and Keychain keys stay in this process.
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { Keychain } = require("./password-manager");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
const VAULT_FILE = path.join(__dirname, ".keychain-vault.json");
const CATALOG = "__keychain_ui_catalog_v1__";
const STATIC = path.join(__dirname, "ui");
let keychain = null;
let vaultExists = false;
let lastActivity = Date.now();
const LOCK_AFTER_MS = 15 * 60 * 1000;
const autoLockTimer = setInterval(() => {
  if (keychain && Date.now() - lastActivity > LOCK_AFTER_MS) keychain = null;
}, 30_000);
autoLockTimer.unref();

async function readVault() {
  try { return JSON.parse(await fs.readFile(VAULT_FILE, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function persist() {
  const [repr, checksum] = await keychain.dump();
  const temp = `${VAULT_FILE}.tmp`;
  await fs.writeFile(temp, JSON.stringify({ repr, checksum }), { mode: 0o600 });
  await fs.rename(temp, VAULT_FILE);
  vaultExists = true;
}
async function records() {
  const raw = await keychain.get(CATALOG);
  if (!raw) return [];
  const ids = JSON.parse(raw);
  const items = [];
  for (const id of ids) {
    const value = await keychain.get(id);
    if (value) items.push({ id, ...JSON.parse(value) });
  }
  return items;
}
function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(body));
}
async function body(req) {
  let value = "";
  for await (const chunk of req) { value += chunk; if (value.length > 2_000_000) throw new Error("Request too large"); }
  return value ? JSON.parse(value) : {};
}
function strength(password) {
  let n = 0;
  if (password.length >= 12) n++;
  if (password.length >= 16) n++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) n++;
  if (/\d/.test(password)) n++;
  if (/[^A-Za-z0-9]/.test(password)) n++;
  return n >= 4 ? "Strong" : n >= 2 ? "Moderate" : "Weak";
}
function score(items) {
  if (!items.length) return 0;
  const pass = items.map(x => x.password || "");
  const dupes = pass.length - new Set(pass).size;
  const strong = pass.filter(p => strength(p) === "Strong").length;
  const complete = items.filter(x => x.username && x.url).length;
  return Math.max(0, Math.round((strong / items.length * 55) + ((items.length - dupes) / items.length * 25) + (complete / items.length * 20)));
}

const server = http.createServer(async (req, res) => {
  try {
    const hostHeader = req.headers.host || "";
    if (![`${HOST}:${PORT}`, `localhost:${PORT}`].includes(hostHeader)) return send(res, 403, { error: "Use the local Keychain address." });
    const origin = req.headers.origin;
    if (origin && ![`http://${HOST}:${PORT}`, `http://localhost:${PORT}`].includes(origin)) return send(res, 403, { error: "Cross-origin requests are not allowed." });
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (url.pathname.startsWith("/api/")) {
      if (Date.now() - lastActivity > LOCK_AFTER_MS && keychain) keychain = null;
      if (req.method === "GET" && url.pathname === "/api/status") {
        vaultExists = !!(await readVault());
        return send(res, 200, { exists: vaultExists, unlocked: !!keychain });
      }
      if (req.method === "POST" && ["/api/setup", "/api/unlock"].includes(url.pathname)) {
        const { password } = await body(req);
        if (typeof password !== "string" || password.length < 8) return send(res, 400, { error: "Use a master password with at least 8 characters." });
        if (url.pathname === "/api/setup") {
          if (await readVault()) return send(res, 409, { error: "A vault already exists. Unlock it instead." });
          keychain = await Keychain.init(password);
          await keychain.set(CATALOG, "[]");
          await persist();
        } else {
          const saved = await readVault();
          if (!saved) return send(res, 404, { error: "No vault exists yet." });
          keychain = await Keychain.load(password, saved.repr, saved.checksum);
        }
        lastActivity = Date.now();
        return send(res, 200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/api/lock") { keychain = null; return send(res, 200, { ok: true }); }
      if (!keychain) return send(res, 423, { error: "Unlock the vault to continue." });
      lastActivity = Date.now();
      if (req.method === "GET" && url.pathname === "/api/credentials") return send(res, 200, { items: await records() });
      if (req.method === "POST" && url.pathname === "/api/credentials") {
        const item = await body(req);
        if (!item.name?.trim() || !item.url?.trim() || !item.password) return send(res, 400, { error: "Name, website, and password are required." });
        const list = await records();
        const id = item.id || `${item.url.trim().toLowerCase()}|${(item.username || "").trim().toLowerCase()}`;
        const data = { name: item.name.trim(), url: item.url.trim(), username: item.username || "", password: item.password, category: item.category || "Other", notes: item.notes || "", favorite: !!item.favorite, createdAt: item.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
        await keychain.set(id, JSON.stringify(data));
        const ids = [...new Set([...list.map(x => x.id), id])];
        await keychain.set(CATALOG, JSON.stringify(ids));
        await persist();
        return send(res, 200, { ok: true });
      }
      if (req.method === "DELETE" && url.pathname.startsWith("/api/credentials/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/credentials/".length));
        const list = await records();
        await keychain.remove(id);
        await keychain.set(CATALOG, JSON.stringify(list.filter(x => x.id !== id).map(x => x.id)));
        await persist();
        return send(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/backup") {
        const [repr, checksum] = await keychain.dump();
        return send(res, 200, { repr, checksum, exportedAt: new Date().toISOString() });
      }
      if (req.method === "POST" && url.pathname === "/api/restore") {
        const { repr, checksum, password } = await body(req);
        keychain = await Keychain.load(password, repr, checksum);
        await persist();
        return send(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/summary") {
        const items = await records();
        const counts = { Strong: 0, Moderate: 0, Weak: 0 };
        for (const item of items) counts[strength(item.password)]++;
        return send(res, 200, { items, score: score(items), counts, duplicates: items.length - new Set(items.map(x => x.password)).size });
      }
      if (req.method === "GET" && url.pathname === "/api/generate") {
        const length = Math.min(64, Math.max(8, Number(url.searchParams.get("length") || 20)));
        const ambiguous = url.searchParams.get("ambiguous") !== "false";
        const groups = [
          ["upper", ambiguous ? "ABCDEFGHJKLMNPQRSTUVWXYZ" : "ABCDEFGHIJKLMNOPQRSTUVWXYZ"],
          ["lower", ambiguous ? "abcdefghijkmnopqrstuvwxyz" : "abcdefghijklmnopqrstuvwxyz"],
          ["numbers", ambiguous ? "23456789" : "0123456789"],
          ["symbols", "!@#$%^&*_-+=?"],
        ].filter(([key]) => url.searchParams.get(key) !== "false").map(([, chars]) => chars);
        if (!groups.length) return send(res, 400, { error: "Select at least one character type." });
        const pool = groups.join("");
        const chars = groups.map(group => group[crypto.randomInt(group.length)]);
        while (chars.length < length) chars.push(pool[crypto.randomInt(pool.length)]);
        for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
        const password = chars.join("");
        return send(res, 200, { password });
      }
      return send(res, 404, { error: "Not found" });
    }
    const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const file = path.resolve(STATIC, requested);
    if (!file.startsWith(path.resolve(STATIC) + path.sep)) return send(res, 403, { error: "Forbidden" });
    const content = await fs.readFile(file);
    const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(content);
  } catch (error) {
    const status = String(error).includes("Invalid password") || String(error).includes("Tampering") ? 401 : 500;
    send(res, status, { error: status === 401 ? "Unable to unlock: password is incorrect or the backup is damaged." : (error.message || "Request failed") });
  }
});
server.listen(PORT, HOST, () => console.log(`Keychain UI listening at http://${HOST}:${PORT}`));
