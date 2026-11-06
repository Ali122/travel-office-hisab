/**
 * AB Travels — staff portal API (Cloudflare Worker)
 *
 * Staff-only operations on the same private GitHub JSON used by the owner app:
 *   - password login (server-side secret, signed session cookie)
 *   - all clients (view/add/edit, no delete)
 *   - pending payments (receivables + unpaid tickets) with partial payments
 *   - staff's own bookings (cost/profit hidden)
 *   - invoice data is generated client-side from the staff's own booking
 *
 * Required Worker secrets:
 *   STAFF_PASSWORD   strong password entered by staff
 *   SESSION_SECRET   random long string (optional; falls back to STAFF_PASSWORD)
 *   GITHUB_TOKEN     fine-grained PAT with Contents: Read and write on the backup repo
 *
 * Optional vars/secrets:
 *   GITHUB_REPO      owner/repo, default Ali122/travel-office-hisab-backup
 *   GITHUB_BRANCH    default main
 */
const COOKIE = "staff_session";
const SESSION_TTL = 12 * 60 * 60 * 1000;

const enc = new TextEncoder();
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  }
});
const fail = (code, message, status = 400, field = null) => json({ ok: false, error: { code, message, field } }, status);

function b64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function bytesFromB64url(s) {
  let t = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmac(env, text) {
  const keyText = String(env.SESSION_SECRET || env.STAFF_PASSWORD || "");
  if (!keyText) throw new Error("STAFF_PASSWORD is not configured");
  const key = await crypto.subtle.importKey("raw", enc.encode(keyText), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(String(text)))));
}
function safeEqual(a, b) {
  a = String(a || ""); b = String(b || "");
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
function cookieValue(req, name) {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return "";
}
async function makeSession(env) {
  const pwdTag = await hmac(env, "pwd:" + String(env.STAFF_PASSWORD || ""));
  const payload = { exp: Date.now() + SESSION_TTL, ph: pwdTag };
  const raw = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await hmac(env, "session:" + raw);
  return raw + "." + sig;
}
async function readSession(req, env) {
  const value = cookieValue(req, COOKIE);
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const expected = await hmac(env, "session:" + parts[0]);
  if (!safeEqual(expected, parts[1])) return null;
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(bytesFromB64url(parts[0]))); } catch { return null; }
  if (!payload || Number(payload.exp) < Date.now()) return null;
  const pwdTag = await hmac(env, "pwd:" + String(env.STAFF_PASSWORD || ""));
  if (!safeEqual(payload.ph, pwdTag)) return null;
  return payload;
}
function sessionCookie(value) {
  return COOKIE + "=" + encodeURIComponent(value) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + Math.floor(SESSION_TTL / 1000);
}
function clearCookie() {
  return COOKIE + "=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}
function originOk(req, url) {
  const o = req.headers.get("origin");
  return !o || o === url.origin;
}
function ipOf(req) {
  return req.headers.get("cf-connecting-ip") || "unknown";
}
const buckets = new Map();
function loginAllowed(ip) {
  const now = Date.now();
  const b = buckets.get(ip) || { reset: now + 60000, n: 0 };
  if (now > b.reset) { b.reset = now + 60000; b.n = 0; }
  b.n++;
  buckets.set(ip, b);
  return b.n <= 8;
}
function cleanText(v, max = 200) {
  return String(v == null ? "" : v).trim().slice(0, max);
}
function normName(v) {
  return String(v == null ? "" : v).trim().toLowerCase();
}
function validDate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
}
function uid() {
  try { return crypto.randomUUID(); } catch { return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
}
function paidOf(x) {
  return (Array.isArray(x && x.payments) ? x.payments : []).reduce((n, p) => n + (Number(p && p.amount) || 0), 0);
}
function ensure(s) {
  ["clients", "receivables", "tickets", "invoices", "draws", "bills", "waseem", "charityPaid", "qarzaPayments", "qarzaPaid", "airlineIds"].forEach((k) => { if (!Array.isArray(s[k])) s[k] = []; });
  if (!s.settings || typeof s.settings !== "object") s.settings = {};
  return s;
}

/* ---------- GitHub data source ---------- */
function ghRepo(env) {
  return String(env.GITHUB_REPO || "Ali122/travel-office-hisab-backup").trim();
}
function ghBranch(env) {
  return String(env.GITHUB_BRANCH || "main").trim();
}
function ghHeaders(env) {
  return {
    Authorization: "Bearer " + String(env.GITHUB_TOKEN || ""),
    Accept: "application/vnd.github+json",
    "User-Agent": "AB-Travels-Staff-Portal"
  };
}
function b64encodeUtf8(text) {
  const bytes = enc.encode(String(text));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64decodeUtf8(b64) {
  const bin = atob(String(b64 || "").replace(/\n/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
async function ghRead(env) {
  if (!String(env.GITHUB_TOKEN || "").trim()) throw new Error("GITHUB_TOKEN is not configured");
  const r = await fetch("https://api.github.com/repos/" + ghRepo(env) + "/contents/HisabData.json?ref=" + encodeURIComponent(ghBranch(env)), {
    headers: ghHeaders(env)
  });
  if (r.status === 404) throw new Error("SYNC_FILE_NOT_FOUND");
  if (!r.ok) throw new Error("GITHUB_READ_" + r.status);
  const j = await r.json();
  let data;
  try { data = JSON.parse(b64decodeUtf8(j.content)); } catch { throw new Error("SYNC_FILE_INVALID"); }
  return { data: ensure(data), sha: j.sha };
}
async function ghWrite(env, data, sha) {
  const body = {
    message: "Staff portal update " + new Date().toISOString(),
    content: b64encodeUtf8(JSON.stringify(data, null, 2)),
    branch: ghBranch(env)
  };
  if (sha) body.sha = sha;
  const r = await fetch("https://api.github.com/repos/" + ghRepo(env) + "/contents/HisabData.json", {
    method: "PUT",
    headers: { ...ghHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    let msg = "GITHUB_WRITE_" + r.status;
    try { const j = await r.json(); if (j && j.message) msg += ":" + j.message; } catch {}
    throw new Error(msg);
  }
  return r.json();
}
async function withData(env, mutate) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, sha } = await ghRead(env);
    const result = mutate(data);
    if (result && result.error) return result;
    try {
      await ghWrite(env, data, sha);
      return { ok: true, data };
    } catch (e) {
      lastErr = e;
      if (!/GITHUB_WRITE_(409|422)/.test(String(e && e.message))) break;
      await new Promise((r) => setTimeout(r, 300 + attempt * 500));
    }
  }
  return { error: { code: "SYNC_WRITE_FAILED", message: String((lastErr && lastErr.message) || lastErr) } };
}

/* ---------- staff view ---------- */
function staffView(s) {
  const clients = [];
  const seen = new Set();
  const add = (c) => {
    const name = String((c && c.name) || "").trim();
    const key = normName(name);
    if (!name || seen.has(key)) return;
    seen.add(key);
    clients.push({
      id: c.id, name, phone: c.phone || "", nic: c.nic || "", passExp: c.passExp || "", note: c.note || ""
    });
  };
  (s.clients || []).forEach(add);
  // Older data files have sales but no clients[] records. Show those names too;
  // saving one creates a real client record in the owner app's data.
  const addName = (v) => {
    const name = String(v || "").trim();
    if (!name || seen.has(normName(name))) return;
    seen.add(normName(name));
    clients.push({ id: "name:" + encodeURIComponent(name), name, phone: "", nic: "", passExp: "", note: "" });
  };
  (s.tickets || []).forEach((t) => addName(t.client));
  (s.receivables || []).forEach((r) => addName(r.client));

  const receivables = (s.receivables || []).map((r) => ({
    id: r.id, client: r.client || "", note: r.note || "", date: r.date || "", total: Number(r.total) || 0,
    payments: (r.payments || []).map((p) => ({ date: p.date || "", amount: Number(p.amount) || 0, method: p.method || "", by: p.by || "", note: p.note || "" }))
  }));
  const tickets = (s.tickets || []).map((t) => ({
    id: t.id, date: t.date || "", client: t.client || "", detail: t.detail || "", from: t.from || "", to: t.to || "",
    pnr: t.pnr || "", air: t.air || "", sale: Number(t.sale) || 0,
    // Keep the owner app's tri-state: only an explicit paid:false ticket is pending.
    paid: t.paid === true ? true : (t.paid === false ? false : null),
    payments: (t.payments || []).map((p) => ({ date: p.date || "", amount: Number(p.amount) || 0, method: p.method || "", by: p.by || "", note: p.note || "" })),
    createdBy: t.createdBy || "", kind: t.kind || "Ticket"
  }));
  return {
    clients,
    receivables,
    tickets,
    bookings: tickets.filter((t) => t.createdBy === "staff"),
    business: {
      company: cleanText(s.settings && s.settings.invCompany, 80) || "AB Travels",
      phone1: cleanText(s.settings && s.settings.invPhone1, 40) || "0310-3311199",
      phone2: cleanText(s.settings && s.settings.invPhone2, 40) || "0314-3178560"
    },
    staffName: "Staff"
  };
}

/* ---------- handlers ---------- */
async function api(req, env, url) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": url.origin, "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS" } });

  if (url.pathname === "/api/session" && req.method === "GET") {
    const s = await readSession(req, env);
    return s ? json({ ok: true }) : fail("UNAUTHORIZED", "login required", 401);
  }

  if (url.pathname === "/api/login" && req.method === "POST") {
    if (!originOk(req, url)) return fail("FORBIDDEN", "origin", 403);
    if (!loginAllowed(ipOf(req))) return fail("RATE_LIMITED", "too many login attempts", 429);
    let b;
    try { b = await req.json(); } catch { return fail("BAD_REQUEST", "invalid JSON", 400); }
    if (!env.STAFF_PASSWORD) return fail("SERVER_CONFIG", "STAFF_PASSWORD secret is not set", 500);
    if (!safeEqual(cleanText(b.password, 200), String(env.STAFF_PASSWORD))) return fail("UNAUTHORIZED", "wrong password", 401);
    const token = await makeSession(env);
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(token) });
  }

  if (url.pathname === "/api/logout" && req.method === "POST") {
    return json({ ok: true }, 200, { "set-cookie": clearCookie() });
  }

  const session = await readSession(req, env);
  if (!session) return fail("UNAUTHORIZED", "login required", 401);
  if (!originOk(req, url)) return fail("FORBIDDEN", "origin", 403);

  if (url.pathname === "/api/data" && req.method === "GET") {
    try {
      const { data } = await ghRead(env);
      return json({ ok: true, ...staffView(data), observed_at: new Date().toISOString() });
    } catch (e) {
      return fail("SYNC_READ_FAILED", String((e && e.message) || e), 502);
    }
  }

  if (url.pathname === "/api/payment" && req.method === "POST") {
    let b;
    try { b = await req.json(); } catch { return fail("BAD_REQUEST", "invalid JSON", 400); }
    const amount = Number(b.amount);
    if (!(amount > 0)) return fail("BAD_REQUEST", "amount must be greater than 0", 400, "amount");
    if (!b.id) return fail("BAD_REQUEST", "id required", 400, "id");
    if (b.type !== "receivable" && b.type !== "ticket") return fail("BAD_REQUEST", "unknown payment type", 400, "type");
    const date = validDate(b.date) ? b.date : new Date().toISOString().slice(0, 10);
    const method = cleanText(b.method, 40) || "Cash";
    const note = cleanText(b.note, 200);
    const res = await withData(env, (s) => {
      if (b.type === "receivable") {
        const r = (s.receivables || []).find((x) => x.id === b.id);
        if (!r) return { error: { code: "NOT_FOUND", message: "receivable not found" } };
        const rem = Math.max(0, (Number(r.total) || 0) - paidOf(r));
        if (amount > rem + 0.5) return { error: { code: "BAD_REQUEST", message: "amount is more than the remaining balance" } };
        if (!Array.isArray(r.payments)) r.payments = [];
        r.payments.push({ date, amount, method, note, by: "staff", at: new Date().toISOString() });
      } else {
        const t = (s.tickets || []).find((x) => x.id === b.id);
        if (!t) return { error: { code: "NOT_FOUND", message: "ticket not found" } };
        if (t.paid !== false) return { error: { code: "BAD_REQUEST", message: "ticket is not marked unpaid" } };
        const rem = Math.max(0, (Number(t.sale) || 0) - paidOf(t));
        if (amount > rem + 0.5) return { error: { code: "BAD_REQUEST", message: "amount is more than the remaining balance" } };
        if (!Array.isArray(t.payments)) t.payments = [];
        t.payments.push({ date, amount, method, note, by: "staff", at: new Date().toISOString() });
        if (paidOf(t) >= (Number(t.sale) || 0) - 0.5) t.paid = true;
      }
    });
    if (res.error) return fail(res.error.code, res.error.message, res.error.code === "NOT_FOUND" ? 404 : 400);
    return json({ ok: true, ...staffView(res.data) });
  }

  if (url.pathname === "/api/client" && req.method === "POST") {
    let b;
    try { b = await req.json(); } catch { return fail("BAD_REQUEST", "invalid JSON", 400); }
    const name = cleanText(b.name, 120);
    if (!name) return fail("BAD_REQUEST", "client name required", 400, "name");
    const res = await withData(env, (s) => {
      const list = s.clients || (s.clients = []);
      const synthetic = b.id && String(b.id).startsWith("name:");
      let oldName = "";
      if (synthetic) {
        try { oldName = decodeURIComponent(String(b.id).slice(5)); }
        catch { return { error: { code: "BAD_REQUEST", message: "invalid client id" } }; }
      }
      let c = synthetic
        ? list.find((x) => normName(x.name) === normName(oldName))
        : (b.id ? list.find((x) => x.id === b.id) : null);
      if (synthetic && !c) {
        c = { id: uid(), name: oldName, phone: "", nic: "", passExp: "", note: "" };
        list.push(c);
      }
      if (b.id && !c) return { error: { code: "NOT_FOUND", message: "client not found" } };
      const nameChanged = !c || normName(c.name) !== normName(name);
      if (nameChanged) {
        const dup = list.find((x) => x !== c && normName(x.name) === normName(name));
        if (dup) return { error: { code: "DUPLICATE", message: "A client with this name already exists. Edit that client instead." } };
      }
      const data = {
        name,
        phone: cleanText(b.phone, 60),
        nic: cleanText(b.nic, 40),
        passExp: validDate(b.passExp) ? b.passExp : "",
        note: cleanText(b.note, 500)
      };
      if (c) Object.assign(c, data);
      else { c = { id: uid(), ...data }; list.push(c); }
    });
    if (res.error) return fail(res.error.code, res.error.message, res.error.code === "NOT_FOUND" ? 404 : 400);
    return json({ ok: true, ...staffView(res.data) });
  }

  if (url.pathname === "/api/booking" && req.method === "POST") {
    let b;
    try { b = await req.json(); } catch { return fail("BAD_REQUEST", "invalid JSON", 400); }
    const client = cleanText(b.client, 120);
    const date = b.date;
    const sale = Number(b.sale);
    if (!client) return fail("BAD_REQUEST", "client required", 400, "client");
    if (!validDate(date)) return fail("BAD_REQUEST", "date required", 400, "date");
    if (!(sale > 0)) return fail("BAD_REQUEST", "sale amount required", 400, "sale");
    const res = await withData(env, (s) => {
      const list = s.tickets || (s.tickets = []);
      if (!Array.isArray(s.clients)) s.clients = [];
      if (!s.clients.some((c) => String(c.name || "").trim().toLowerCase() === client.toLowerCase())) {
        s.clients.push({ id: uid(), name: client, phone: "", nic: "", passExp: "", note: "" });
      }
      list.push({
        id: uid(),
        date,
        client,
        detail: cleanText(b.detail, 300),
        from: cleanText(b.from, 3).toUpperCase(),
        to: cleanText(b.to, 3).toUpperCase(),
        pnr: cleanText(b.pnr, 12).toUpperCase(),
        air: cleanText(b.air, 30),
        cost: 0,
        sale,
        paid: !!b.paid,
        payments: [],
        createdBy: "staff",
        staffBooking: true,
        kind: "Ticket"
      });
    });
    if (res.error) return fail(res.error.code, res.error.message, 400);
    return json({ ok: true, ...staffView(res.data) });
  }

  return fail("NOT_FOUND", "not found", 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      try { return await api(req, env, url); }
      catch (e) { return fail("SERVER_ERROR", String((e && e.message) || e), 500); }
    }
    // With the static assets binding, "/" is served by public/index.html.
    return new Response("Not found", { status: 404 });
  }
};
