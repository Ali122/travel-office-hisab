/**
 * AB Travels — one Cloudflare Worker, two jobs:
 *
 *   1) Ignav proxy for the hisab app  (/health, /fares, /round-trip, /booking-links)
 *      The Ignav API key stays here on the server, never in the browser.
 *
 *   2) Telegram flight-price bot      (/telegram, plus a 1-minute cron)
 *      Normal message: "DXB to KHI 15 December", "DXB KHI 15 Dec har 30 minute",
 *      "EK601 DXB KHI 15 December", "... kal raat 10 baje tak"
 *      /price KHI DXB 01-12-2026        -> cheapest fares right now
 *      /watch KHI DXB 01-12-2026        -> check automatically, alert on price drop
 *      /urgent <id> 60                  -> check every minute for 60 minutes
 *      /interval /pause /resume /list /stop /book /budget
 *
 *   3) App proxy budget: MAX_DAILY_PROXY (default 200), optional ALLOWED_ORIGIN check.
 *      Both are best effort; keep the Ignav dashboard spending limit as the hard stop.
 *
 * SETUP (one time, free plan, no credit card):
 *   1) Create the Worker, paste this file, Deploy.
 *      (Worker must be an ES-module Worker — the default "Hello World" template is.)
 *   2) Settings -> Variables and Secrets:
 *        IGNAV_API_KEY        = your Ignav key (secret)
 *        TELEGRAM_BOT_TOKEN   = token from @BotFather (secret)
 *        TELEGRAM_WEBHOOK_SECRET = any random word (optional but recommended, secret)
 *   3) Settings -> Bindings -> KV namespace, variable name: KV
 *   4) Settings -> Triggers -> Cron Triggers -> add: *\/1 * * * *   (every minute)
 *   5) Open https://YOUR-WORKER.workers.dev/setup once  -> connects the bot
 *   6) In Telegram open your bot, send /start (first person to /start owns the bot)
 *
 * Notes:
 *   - Ignav gives 1,000 free fare searches (one time, not monthly).
 *     Per-minute checks = 60 searches per hour, so the bot has a daily budget
 *     (default 60/day, override with MAX_DAILY_REQUESTS). /budget shows it.
 *   - KV free plan: 1,000 writes/day. The bot writes at most once per check,
 *     so the daily budget also keeps KV writes safe.
 *   - KV list free plan: only 1,000/day. The cron must NOT call KV.list every
 *     minute (that was 1,440/day). WATCH_INDEX_DO stores the concurrent-safe index.
 */

const IGNAV_API = "https://ignav.com/api";
const TG_API = "https://api.telegram.org/bot";
const DEFAULT_EVERY = 15; // minutes
const MAX_DAILY = 60;     // fare searches per day for the bot, protects the free allowance
const MAX_DAILY_PROXY = 200; // fare searches per day for the browser app (best effort)
const DROP_PCT = 0.05;    // alert when the price falls at least 5%
const MAX_WATCHES = 5;
const WATCH_TTL = 60 * 60 * 24 * 120;
const WATCH_INDEX = "w:index"; // one KV key lists watch keys, avoiding daily KV.list on the cron
const QUIET_KEY = "settings:quiet";
const QUIET_DEFAULT = { enabled: true, start: "02:00", end: "09:00" };
const PERIODIC_MIN_EVERY = 30; // 30+ min watches: send a price update after every check

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function cors(env) {
  return {
    "Access-Control-Allow-Origin": (env && env.ALLOWED_ORIGIN) || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

function jres(obj, status, hdrs) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, hdrs || {})
  });
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function num(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function money(n, cur) {
  return (cur ? cur + " " : "") + num(n);
}

function dur(m) {
  m = Math.max(0, Number(m) || 0);
  const h = Math.floor(m / 60), mm = m % 60;
  return h ? h + "h" + (mm ? " " + mm + "m" : "") : mm + "m";
}

function prettyDate(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(iso || "");
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+m[2] - 1];
  return m[3] + " " + mo + " " + m[1];
}

function hhmm(s) {
  return String(s || "").slice(11, 16) || "--:--";
}

function todayIso() {
  return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10); // PKT
}

function budgetKey() {
  return "budget:" + new Date().toISOString().slice(0, 10);
}

function budgetCap(env) {
  const n = Number(env && env.MAX_DAILY_REQUESTS);
  return isFinite(n) && n > 0 ? Math.floor(n) : MAX_DAILY;
}

/* ------------------------------------------------------------------ */
/* Shared access (team)                                                */
/*   owner  = first chat that sent /start                              */
/*   share  = extra chat IDs added by the owner with /share <id>       */
/* Watches live under the owner key, so everyone allowed sees the      */
/* same list, and every alert goes to all allowed chats.               */
/* ------------------------------------------------------------------ */

async function teamChat(env) {
  if (!env.KV) return "";
  try { return String((await env.KV.get("owner")) || ""); } catch (e) { return ""; }
}

async function sharedChats(env) {
  if (!env.KV) return [];
  let a = [];
  try { a = JSON.parse((await env.KV.get("share")) || "[]"); } catch (e) { a = []; }
  if (!Array.isArray(a)) a = [];
  return a.map(String).filter(Boolean);
}

async function allowedChats(env) {
  const owner = await teamChat(env);
  const list = owner ? [owner] : [];
  (await sharedChats(env)).forEach(function (c) {
    if (list.indexOf(c) < 0) list.push(c);
  });
  return list;
}

async function isAllowed(env, chat) {
  return (await allowedChats(env)).indexOf(String(chat)) >= 0;
}

async function notifyAll(env, html, extra) {
  const list = await allowedChats(env);
  const sent = [];
  for (const c of list) {
    try { await send(env, c, html, extra); sent.push(c); } catch (e) { /* ignore */ }
  }
  return sent;
}


/* ------------------------------------------------------------------ */
/* Ignav                                                               */
/* ------------------------------------------------------------------ */

async function ignavCall(env, path, body) {
  if (!env.IGNAV_API_KEY) {
    throw Object.assign(new Error("IGNAV_API_KEY secret is not set in the Worker."), { code: "NO_KEY" });
  }
  const init = { method: body ? "POST" : "GET", headers: { "X-Api-Key": env.IGNAV_API_KEY } };
  if (body) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const r = await fetch(IGNAV_API + path, init);
  const txt = await r.text();
  let j = null;
  try { j = JSON.parse(txt); } catch (e) { /* not json */ }
  if (!r.ok) {
    const msg = (j && j.error && (j.error.message || j.error.code)) || ("Ignav HTTP " + r.status);
    throw Object.assign(new Error(msg), { code: "IGNAV", status: r.status, payload: j });
  }
  return j || {};
}

async function takeBudget(env) {
  if (!env.KV) {
    throw Object.assign(new Error("KV binding (variable name KV) is not set in the Worker."), { code: "NO_KV" });
  }
  const k = env.KV;
  const key = budgetKey();
  const cap = budgetCap(env);
  const used = Number((await k.get(key)) || 0);
  if (used >= cap) return { ok: false, used: used, cap: cap };
  await k.put(key, String(used + 1), { expirationTtl: 172800 });
  return { ok: true, used: used + 1, cap: cap };
}

function proxyBudgetCap(env) {
  const n = Number(env && env.MAX_DAILY_PROXY);
  return isFinite(n) && n > 0 ? Math.floor(n) : MAX_DAILY_PROXY;
}

// Best-effort separate counter for the browser app, so a public /fares endpoint
// cannot drain the whole Ignav allowance. KV has no atomic increment, so under
// heavy parallel traffic a few calls can slip past the cap. Keep the Ignav
// dashboard spending limit as the hard stop.
async function takeProxyBudget(env) {
  if (!env.KV) return { ok: true, used: 0, cap: proxyBudgetCap(env) };
  const key = "px:" + new Date().toISOString().slice(0, 10);
  const cap = proxyBudgetCap(env);
  const used = Number((await env.KV.get(key)) || 0);
  if (used >= cap) return { ok: false, used: used, cap: cap };
  await env.KV.put(key, String(used + 1), { expirationTtl: 172800 });
  return { ok: true, used: used + 1, cap: cap };
}

function routePayload(w) {
  const p = {
    origin: w.origin,
    destination: w.destination,
    departure_date: w.departure,
    adults: w.adults || 1,
    cabin_class: w.cabin || "economy",
    market: w.market || "PK"
  };
  if (w.ret) p.return_date = w.ret;
  if (w.nonstop) p.max_stops = 0;
  if (w.children) p.children = w.children;
  return p;
}

function cheapestFare(j, flight) {
  const list = (j && j.itineraries) || [];
  const want = String(flight || "").toUpperCase().replace(/\s/g, "");
  let best = null;
  for (const it of list) {
    if (want && !legHasFlight(it.outbound, want)) continue;
    const p = it && it.price;
    if (!p) continue;
    const a = Number(p.amount);
    if (!isFinite(a) || a <= 0) continue;
    if (!best || a < Number(best.price.amount)) best = it;
  }
  return best;
}

function bestFare(j, flight) {
  const list = (j && j.itineraries) || [];
  const want = String(flight || "").toUpperCase().replace(/\s/g, "");
  let best = null;
  for (const it of list) {
    if (want && !legHasFlight(it.outbound, want)) continue;
    const p = it && it.price;
    if (!p) continue;
    if (p.status && p.status !== "verified") continue;
    const a = Number(p.amount);
    if (!isFinite(a) || a <= 0) continue;
    if (!best || a < Number(best.price.amount)) best = it;
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Telegram                                                            */
/* ------------------------------------------------------------------ */

async function tg(env, method, payload) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN secret is not set in the Worker.");
  /* Cloudflare se Telegram ki raasta kabhi 15-40s leti hai (kabhi block bhi hoti
     hai). Is liye ek retry - timeout ya network error par dobara try, taake
     notification drop na ho. */
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(TG_API + env.TELEGRAM_BOT_TOKEN + "/" + method, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {}),
        signal: AbortSignal.timeout(attempt === 0 ? 20000 : 40000)
      });
      let j = null;
      try { j = await r.json(); } catch (e) { /* ignore */ }
      if (!j || j.ok !== true) {
        const desc = String((j && j.description) || r.status);
        // Flood control / server error par retry
        if (attempt === 0 && /flood|try again|retry|5\d\d/i.test(desc)) {
          lastErr = new Error("Telegram " + method + " failed: " + desc);
          continue;
        }
        throw new Error("Telegram " + method + " failed: " + desc);
      }
      return j.result;
    } catch (e) {
      lastErr = e;
      if (attempt === 0) continue; // timeout / network error - ek aur try
    }
  }
  throw lastErr || new Error("Telegram " + method + " failed");
}

async function send(env, chat, html, extra) {
  const text = String(html || "");
  if (text.length <= 3800) {
    return tg(env, "sendMessage", Object.assign({
      chat_id: chat, text: text, parse_mode: "HTML", disable_web_page_preview: true
    }, extra || {}));
  }
  let left = text;
  while (left.length) {
    let cut = left.lastIndexOf("\n", 3800);
    if (cut < 1000) cut = 3800;
    const part = left.slice(0, cut);
    left = left.slice(cut);
    await tg(env, "sendMessage", Object.assign({
      chat_id: chat, text: part, parse_mode: "HTML", disable_web_page_preview: true
    }, extra || {}));
  }
}

/* ------------------------------------------------------------------ */
/* text formatting                                                     */
/* ------------------------------------------------------------------ */

function legLine(leg, label) {
  if (!leg) return "";
  const segs = leg.segments || [];
  if (!segs.length) return "";
  const first = segs[0], last = segs[segs.length - 1];
  const stops = segs.length - 1;
  const code = String(first.marketing_carrier_code || "").trim();
  const fno = code ? code + " " + String(first.flight_number || "").trim() : String(leg.carrier || "").trim();
  const carrier = leg.carrier && code ? " (" + leg.carrier + ")" : "";
  return label + ": " + (first.departure_airport || "") + " " + hhmm(first.departure_time_local) +
    " → " + (last.arrival_airport || "") + " " + hhmm(last.arrival_time_local) +
    " · " + (stops ? stops + " stop" + (stops > 1 ? "s" : "") : "direct") +
    (leg.duration_minutes ? " · " + dur(leg.duration_minutes) : "") +
    "\n   " + (fno || "flight") + carrier;
}

function routeTitle(w) {
  return "<b>" + esc(w.origin) + " → " + esc(w.destination) + "</b> · " + esc(prettyDate(w.departure)) +
    (w.ret ? " ↔ " + esc(prettyDate(w.ret)) : "") +
    " · " + (w.adults || 1) + " adult" + ((w.adults || 1) > 1 ? "s" : "") +
    " · " + esc(String(w.cabin || "economy").replace("_", " ")) +
    (w.nonstop ? " · non-stop" : "");
}

function offerBlock(it, i) {
  const p = it.price || {};
  let s = "<b>" + (i + 1) + ". " + esc(money(p.amount, p.currency)) + "</b>";
  s += "\n" + legLine(it.outbound, "Out");
  if (it.inbound) s += "\n" + legLine(it.inbound, "Ret");
  return s;
}

/* ------------------------------------------------------------------ */
/* command parsing                                                     */
/* ------------------------------------------------------------------ */

function parseCmd(text) {
  const parts = String(text || "").trim().split(/\s+/).filter(Boolean);
  let cmd = (parts.shift() || "").toLowerCase().replace(/@[a-z0-9_]+$/i, "");
  const args = [], opts = {};
  for (const raw of parts) {
    const p = raw.replace(/^[\s,]+|[\s,]+$/g, "");
    if (!p) continue;
    const m = p.match(/^([a-zA-Z_]+)=(.+)$/);
    if (m) { opts[m[1].toLowerCase()] = m[2]; continue; }
    if (/^nonstop$/i.test(p) || /^non-stop$/i.test(p)) { opts.nonstop = "1"; continue; }
    args.push(p);
  }
  return { cmd: cmd, args: args, opts: opts };
}

function isoOk(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(iso + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

function parseDate(s) {
  const t = String(s || "").trim().toLowerCase();
  if (!t) return "";
  if (t === "today") return todayIso();
  if (t === "tomorrow") {
    const d = new Date(todayIso() + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (isoOk(t)) return t;
  let m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) {
    const iso = m[3] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
    return isoOk(iso) ? iso : "";
  }
  m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    const iso = m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
    return isoOk(iso) ? iso : "";
  }
  return "";
}

const CABINS = { eco: "economy", economy: "economy", pe: "premium_economy", premium: "premium_economy", premium_economy: "premium_economy", biz: "business", business: "business", first: "first" };

/* ------------------------------------------------------------------ */
/* natural language (Roman Urdu / English)                             */
/* ------------------------------------------------------------------ */

const CITY = {
  karachi: "KHI", khi: "KHI",
  lahore: "LHE", lhe: "LHE",
  islamabad: "ISB", isb: "ISB", rawalpindi: "ISB",
  quetta: "UET", uet: "UET",
  peshawar: "PEW", pew: "PEW",
  multan: "MUX", mux: "MUX",
  faisalabad: "LYP", lyp: "LYP",
  skardu: "KDU", kdu: "KDU",
  gilgit: "GIL", gil: "GIL",
  dubai: "DXB", dxb: "DXB",
  "abu dhabi": "AUH", abudhabi: "AUH", auh: "AUH",
  sharjah: "SHJ", shj: "SHJ",
  doha: "DOH", doh: "DOH",
  jeddah: "JED", jed: "JED", jiddah: "JED",
  madinah: "MED", medina: "MED", med: "MED",
  riyadh: "RUH", ruh: "RUH",
  dammam: "DMM", dmm: "DMM",
  muscat: "MCT", mct: "MCT",
  kuwait: "KWI", kwi: "KWI",
  bahrain: "BAH", bah: "BAH",
  istanbul: "IST", ist: "IST",
  london: "LHR", lhr: "LHR",
  toronto: "YYZ", yyz: "YYZ",
  bangkok: "BKK", bkk: "BKK",
  kualalumpur: "KUL", "kuala lumpur": "KUL", kul: "KUL"
};

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
};

function pktIso(ms) {
  return new Date((ms == null ? Date.now() : ms) + 5 * 3600 * 1000).toISOString();
}

function pktToday() {
  return pktIso().slice(0, 10);
}

function pktNowText() {
  return pktIso().slice(0, 16).replace("T", " ") + " PKT";
}

/* ------------------------------------------------------------------ */
/* Quiet hours (Pakistan time)                                        */
/*   Default: 02:00-09:00 PKT, enabled. No automatic checks in this    */
/*   window, so Ignav searches are not wasted while you sleep.         */
/* ------------------------------------------------------------------ */

function pktMinutes() {
  const d = new Date(Date.now() + 5 * 3600 * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function pad2(n) {
  return ("0" + Number(n)).slice(-2);
}

function parseHHMM(s) {
  const m = String(s || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

function parseQuietRange(s) {
  const m = String(s || "").match(/^(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  const sh = Number(m[1]), sm = Number(m[2] || 0), eh = Number(m[3]), em = Number(m[4] || 0);
  if (sh > 23 || eh > 23 || sm > 59 || em > 59) return null;
  return { start: pad2(sh) + ":" + pad2(sm), end: pad2(eh) + ":" + pad2(em) };
}

async function getQuiet(env) {
  let q = null;
  try {
    if (env.KV) {
      const raw = await env.KV.get(QUIET_KEY);
      if (raw) q = JSON.parse(raw);
    }
  } catch (e) { q = null; }
  const start = q && parseHHMM(q.start) != null ? q.start : QUIET_DEFAULT.start;
  const end = q && parseHHMM(q.end) != null ? q.end : QUIET_DEFAULT.end;
  const enabled = q && q.enabled != null ? !!q.enabled : QUIET_DEFAULT.enabled;
  return { enabled, start, end, startMin: parseHHMM(start), endMin: parseHHMM(end) };
}

async function saveQuiet(env, q) {
  await env.KV.put(QUIET_KEY, JSON.stringify({ enabled: !!q.enabled, start: q.start, end: q.end }));
}

function inQuiet(q, mins) {
  if (!q || !q.enabled || q.startMin == null || q.endMin == null || q.startMin === q.endMin) return false;
  if (q.startMin < q.endMin) return mins >= q.startMin && mins < q.endMin;
  return mins >= q.startMin || mins < q.endMin; // overnight window
}

function quietLabel(q) {
  return q && q.enabled ? (q.start + "–" + q.end + " PKT") : "off";
}

function addDaysIso(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function naturalDate(text) {
  const t = String(text || "").toLowerCase();
  if (/\btomorrow\b|\bkal\b/.test(t) && !/\bkal raat\b/.test(t)) return addDaysIso(pktToday(), 1);
  if (/\btoday\b|\baaj\b/.test(t)) return pktToday();
  let m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)(?:\s+(\d{4}))?\b/);
  if (m) {
    const year = m[3] ? Number(m[3]) : Number(pktToday().slice(0, 4));
    const iso = year + "-" + ("0" + MONTHS[m[2]]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
    if (isoOk(iso)) return iso >= pktToday() ? iso : addDaysIso(iso, 0).replace(String(year), String(year + 1));
  }
  m = t.match(/\b(\d{1,2})[-\/.](\d{1,2})(?:[-\/.](\d{2,4}))?\b/);
  if (m) {
    let year = m[3] ? Number(m[3]) : Number(pktToday().slice(0, 4));
    if (year < 100) year += 2000;
    const iso = year + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
    if (isoOk(iso)) return iso;
  }
  m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m && isoOk(m[0])) return m[0];
  return "";
}

function naturalInterval(text) {
  const t = String(text || "").toLowerCase();
  let m = t.match(/\b(?:har|every|each)\s+(\d{1,3})\s*(?:min|mins|minute|minutes)\b/);
  if (m) return Math.min(1440, Math.max(1, Number(m[1])));
  m = t.match(/\b(?:har|every|each)\s+(\d{1,2})\s*(?:hour|hours|ghant[ae]|ghantay)\b/);
  if (m) return Math.min(1440, Math.max(1, Number(m[1]) * 60));
  if (/\b(?:har|every)\s+(?:minute|min)\b/.test(t)) return 1;
  if (/\b(?:har|every)\s+(?:hour|ghant[ae]|ghantay)\b/.test(t)) return 60;
  if (/\bhar\s+do\s+ghant/.test(t)) return 120;
  if (/\bhar\s+teen\s+ghant/.test(t)) return 180;
  if (/\bhar\s+aadha\s+ghant/.test(t)) return 30;
  return 0;
}

function naturalTime(text) {
  const t = String(text || "").toLowerCase();
  const m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(?:baje|bje|o'?clock|am|pm)\b/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (h > 23 || min > 59) return null;
  const night = /\braat\b|\bshaam\b|\bsham\b|\bevening\b|\bnight\b|\bpm\b/.test(t);
  const morning = /\bsubah\b|\bmorning\b|\bam\b/.test(t);
  if (night && h < 12) h += 12;
  if (night && h === 12) h = 0;
  if (morning && h === 12) h = 0;
  return { h: h, m: min };
}

function naturalUntil(text) {
  const t = String(text || "").toLowerCase();
  if (!/\btak\b|\buntil\b|\btill\b/.test(t)) return { ms: 0, label: "" };
  const tm = naturalTime(t);
  if (!tm) return { ms: 0, label: "" };
  // "kal raat 10 baje tak" / "aaj shaam 6 baje tak" -> the day word belongs to the end time
  let date = "";
  const near = t.match(/\b(kal|aaj|tomorrow|today)\b[^,;]{0,25}?\b\d{1,2}(?::\d{2})?\s*(?:baje|bje|o'?clock|am|pm)\b/);
  if (near) date = /kal|tomorrow/.test(near[1]) ? addDaysIso(pktToday(), 1) : pktToday();
  if (!date) date = naturalDate(t);
  if (!date) date = pktToday();
  let ms = Date.parse(date + "T" + ("0" + tm.h).slice(-2) + ":" + ("0" + tm.m).slice(-2) + ":00+05:00");
  if (!isFinite(ms)) return { ms: 0, label: "" };
  if (ms <= Date.now() && !near) ms += 86400000;
  if (ms <= Date.now()) return { ms: 0, label: "" };
  return { ms: ms, label: pktIso(ms).slice(0, 16).replace("T", " ") };
}

function naturalFlight(text) {
  const m = String(text || "").toUpperCase().match(/\b([A-Z]{2})\s?(\d{1,4})\b/);
  if (!m) return "";
  return m[1] + m[2];
}

function naturalTarget(text) {
  const t = String(text || "").replace(/,/g, "");
  let m = t.match(/\btarget\s*[:=]?\s*(\d{3,7})\b/i);
  if (!m) m = t.match(/\b(\d{3,7})\s*(?:se|say|ya)\s*kam\b/i);
  if (!m) m = t.match(/\bbelow\s+(\d{3,7})\b/i);
  const n = m ? Number(m[1]) : 0;
  return isFinite(n) && n > 0 ? n : 0;
}

function naturalRoute(text) {
  const s = " " + String(text || "").toLowerCase().replace(/[→➡>]/g, " to ") + " ";
  const hits = [];
  let m;
  const names = Object.keys(CITY).sort(function (a, b) { return b.length - a.length; });
  for (const name of names) {
    const re2 = new RegExp("(^|[^a-z])" + name.replace(/ /g, "\\s+") + "(?=$|[^a-z])", "g");
    while ((m = re2.exec(s))) hits.push({ at: m.index, code: CITY[name] });
  }
  // explicit codes first
  const codeHits = [];
  const re3 = /(^|[^a-z])([a-z]{3})(?=$|[^a-z])/g;
  while ((m = re3.exec(s))) {
    const code = m[2].toUpperCase();
    if (Object.values(CITY).indexOf(code) >= 0) codeHits.push({ at: m.index, code: code });
  }
  const all = codeHits.length ? codeHits : hits;
  all.sort(function (a, b) { return a.at - b.at; });
  const seen = [];
  for (const h of all) if (seen.indexOf(h.code) < 0) seen.push(h.code);
  if (seen.length < 2) return null;
  return { origin: seen[0], destination: seen[1] };
}

function parseNatural(text) {
  const raw = String(text || "");
  const route = naturalRoute(raw);
  const date = naturalDate(raw);
  const every = naturalInterval(raw);
  const until = naturalUntil(raw);
  const flight = naturalFlight(raw);
  const target = naturalTarget(raw);
  const wantsWatch = every > 0 || /\bwatch\b|\btrack\b|\bmonitor\b|\balert\b|\bdekh(?:ta|te|ti)\s+rah|\bcheck\s+karta/.test(raw.toLowerCase()) || until.ms > 0;
  if (!route || !date) {
    return {
      ok: false,
      missing: !route ? "route" : "date",
      route: route, date: date, every: every, until: until, flight: flight, target: target, watch: wantsWatch
    };
  }
  return {
    ok: true, route: route, date: date, every: every, until: until, flight: flight,
    target: target, watch: wantsWatch
  };
}

function readRoute(args, opts) {
  const codes = [];
  const dates = [];
  for (const a of args) {
    const up = a.toUpperCase();
    if (/^[A-Z]{3}$/.test(up) && !dates.length && codes.length < 2) codes.push(up);
    else {
      const d = parseDate(a);
      if (d) dates.push(d);
      else return { error: "Samajh nahi aaya: “" + a + "”. Airport 3 letters (KHI) aur date 01-12-2026 likhein." };
    }
  }
  if (codes.length !== 2) return { error: "Route adhoora — misaal: /price KHI DXB 01-12-2026" };
  if (!dates.length) return { error: "Date missing — misaal: /price KHI DXB 01-12-2026" };
  if (dates.length > 2) return { error: "Sirf departure aur (optionally) return date dein." };
  if (dates.length === 2 && dates[1] < dates[0]) return { error: "Return date departure se pehle nahi ho sakti." };
  if (dates[0] < todayIso()) return { error: "Departure date guzar gayi hai: " + dates[0] };
  const adults = Math.min(9, Math.max(1, Math.floor(Number(opts.adults || 1)) || 1));
  const cabin = CABINS[String(opts.cabin || "economy").toLowerCase()];
  if (!cabin) return { error: "Cabin: economy, premium_economy, business ya first." };
  return {
    origin: codes[0], destination: codes[1], departure: dates[0], ret: dates[1] || "",
    adults: adults, cabin: cabin,
    market: String(opts.market || "PK").toUpperCase().slice(0, 2),
    nonstop: /^(1|true|yes)$/i.test(String(opts.nonstop || ""))
  };
}

/* ------------------------------------------------------------------ */
/* commands                                                            */
/* ------------------------------------------------------------------ */

const HELP =
  "<b>✈️ AB Travels price bot</b>\n\n" +
  "<b>Normal message bhi chalega</b>\n" +
  "<code>DXB to KHI 15 December</code> — abhi ka price\n" +
  "<code>KHI UET 15 December har ghantay</code> — track\n" +
  "<code>DXB KHI 15 Dec har 30 minute kal raat 10 baje tak</code>\n" +
  "Kisi flight ka filter: <code>EK601 DXB KHI 15 December</code> ya <code>/price DXB KHI 15-12-2026 flight=EK601</code>\n\n" +
  "<b>Price</b>\n" +
  "<code>/price KHI DXB 01-12-2026</code>\n" +
  "<code>/price KHI DXB 01-12-2026 15-12-2026</code> round trip\n" +
  "Options: <code>adults=2 cabin=business market=AE nonstop</code>\n\n" +
  "<b>Tracking (khud check karta rahega)</b>\n" +
  "<code>/watch KHI DXB 01-12-2026</code>\n" +
  "<code>/watch KHI DXB 01-12-2026 target=85000 every=10</code>\n" +
  "Specific flight + end time (Pakistan): <code>/watch KHI UET 15-12-2026 flight=PK310 every=60 until=2026-12-14T22:00</code>\n" +
  "<code>/interval 123 60</code> · <code>/pause 123</code> · <code>/resume 123</code>\n" +
  "<code>/list</code> · <code>/stop 1</code> · <code>/stop all</code>\n\n" +
  "<b>Urgent (har minute)</b>\n" +
  "<code>/urgent 1 60</code> — watch #1 har minute, 60 minute tak\n\n" +
  "<b>Quiet hours (default 02:00–09:00 PKT)</b>\n" +
  "<code>/quiet</code> — status · <code>/quiet on</code> · <code>/quiet off</code>\n" +
  "<code>/quiet 02:00-09:00</code> — custom window (Pakistan time)\n\n" +
  "<b>Reminders (team ko alarm)</b>\n" +
  "<code>/remind Air Arabia: Usama ki booking 1 bje expire hogi</code>\n" +
  "1 ghanta pehle (12 baje) aur 30 min pehle (12:30) remind · <code>lead=60,30,10</code> se apni marzi\n" +
  "<code>/remind Call Sarmad 30 min baad</code> · <code>/reminds</code> list · <code>/unremind R12</code> ya <code>/unremind all</code>\n\n" +
  "<b>Book link</b> <code>/book 1</code> · <b>Budget</b> <code>/budget</code>\n\n" +
  "<b>Team (dono ko alerts)</b>\n" +
  "<code>/id</code> — apna chat ID\n" +
  "Owner: <code>/share 123456789</code> — member add (us ka ID)\n" +
  "<code>/share</code> — team list · <code>/unshare 123456789</code> — remove\n\n" +
  "<i>Har check = 1 Ignav search. 30+ min watches par har check ke baad price update; chhote/urgent par sirf target/5% alerts. /list /stop /budget /quiet /help = 0 searches.</i>";

async function doPrice(env, chat, r, extra, flight) {
  const want = String(flight || "").toUpperCase().replace(/\s/g, "");
  const t = await takeBudget(env);
  if (!t.ok) {
    return send(env, chat, "📊 Aaj ka search budget (" + t.cap + ") khatam — " + t.used + " searches ho chuke.\nKal dobara try karein, ya Worker mein <code>MAX_DAILY_REQUESTS</code> barha dein.");
  }
  await send(env, chat, "🔎 Search ho rahi hai: " + routeTitle(r) + (want ? " · " + esc(want) : "") + " …");
  const j = await ignavCall(env, r.ret ? "/fares/round-trip" : "/fares/one-way", routePayload(r));
  const ind = cheapestFare(j, want);
  const list = (j.itineraries || []).filter(function (it) {
    const p = it && it.price;
    if (!p || (p.status && p.status !== "verified") || !(Number(p.amount) > 0)) return false;
    if (want && !legHasFlight(it.outbound, want)) return false;
    return true;
  }).sort(function (a, b) { return Number(a.price.amount) - Number(b.price.amount); });
  if (!list.length) {
    if (ind) {
      let m2 = routeTitle(r) + (want ? " · " + esc(want) : "") + "\n\n";
      m2 += "<b>" + esc(money(ind.price.amount, ind.price.currency)) + "</b> <i>(indicative / unverified)</i>";
      m2 += "\n" + legLine(ind.outbound, "Out");
      if (ind.inbound) m2 += "\n" + legLine(ind.inbound, "Ret");
      m2 += "\n\n⚠️ Is route par abhi koi verified fare nahi mila — ye sab se sasta indicative price hai. Booking se pehle confirm karein.";
      m2 += "\n\n🕒 " + pktNowText() + " · source: Ignav";
      return send(env, chat, m2, extra);
    }
    return send(env, chat, want
      ? "Flight <b>" + esc(want) + "</b> ka verified fare nahi mila. Flight number ya date check karein."
      : "Koi verified fare nahi mila. Date ya route badal kar dekhein.");
  }
  let msg = routeTitle(r) + (want ? " · " + esc(want) : "") + "\n\n";
  msg += list.slice(0, 5).map(offerBlock).join("\n\n");
  if (ind && Number(ind.price.amount) < Number(list[0].price.amount)) {
    msg += "\n\n💡 Sab se sasta (indicative/unverified): <b>" + esc(money(ind.price.amount, ind.price.currency)) + "</b> — booking se pehle confirm karein.";
  }
  msg += "\n\n🕒 " + pktNowText() + " · source: Ignav\n" +
    "<i>Prices indicative — booking se pehle confirm karein.</i>\n" +
    "Track karne ke liye: <code>/watch " + r.origin + " " + r.destination + " " + r.departure +
    (r.ret ? " " + r.ret : "") + (want ? " flight=" + want : "") + "</code>\n" +
    "Book links: <code>/watch</code> phir <code>/book ID</code>";
  await send(env, chat, msg, extra);
}

function legHasFlight(leg, want) {
  if (!want) return true;
  const segs = (leg && leg.segments) || [];
  for (const s of segs) {
    const code = String(s.marketing_carrier_code || "").toUpperCase();
    const number = String(s.flight_number || "").toUpperCase().replace(/\s/g, "");
    if ((number.indexOf(code) === 0 ? number : code + number) === want) return true;
  }
  return false;
}

async function cmdPrice(env, chat, args, opts) {
  const r = readRoute(args, opts);
  if (r.error) return send(env, chat, esc(r.error));
  return doPrice(env, chat, r, null, opts.flight);
}

function kb(rows) {
  return { inline_keyboard: rows };
}

function intervalButtons(id) {
  return kb([
    [
      { text: "1 min", callback_data: "iv:" + id + ":1" },
      { text: "5 min", callback_data: "iv:" + id + ":5" },
      { text: "10 min", callback_data: "iv:" + id + ":10" }
    ],
    [
      { text: "15 min", callback_data: "iv:" + id + ":15" },
      { text: "30 min", callback_data: "iv:" + id + ":30" },
      { text: "60 min", callback_data: "iv:" + id + ":60" }
    ],
    [
      { text: "⏸ Pause", callback_data: "ps:" + id },
      { text: "🔗 Book", callback_data: "bk:" + id },
      { text: "⏹ Stop", callback_data: "st:" + id }
    ]
  ]);
}

function untilLabel(ms) {
  return pktIso(ms).slice(0, 16).replace("T", " ");
}

async function createWatch(env, chat, r, o) {
  const flight = String((o && o.flight) || "").toUpperCase().replace(/\s/g, "");
  if (flight && !/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(flight)) {
    return send(env, chat, "Flight misaal: <code>EK601</code>");
  }
  const until = Number((o && o.until) || 0);
  if (until && until <= Date.now()) {
    return send(env, chat, "Tracking ka end time future mein hona chahiye.");
  }
  const have = await watches(env, chat);
  if (have.length >= MAX_WATCHES) {
    return send(env, chat, "Max " + MAX_WATCHES + " watches. Pehle <code>/stop ID</code> karein.");
  }
  const team = (await teamChat(env)) || String(chat);
  const everyRaw = Number((o && o.every) || DEFAULT_EVERY);
  const every = Math.min(1440, Math.max(1, Math.floor(isFinite(everyRaw) ? everyRaw : DEFAULT_EVERY)));
  const target = Number((o && o.target) || 0);
  const usedIds = have.map(function (x) { return String(x.id); });
  let id = "";
  do { id = String(Math.floor(100 + Math.random() * 900)); } while (usedIds.indexOf(id) >= 0);
  const w = {
    id: id, chat: String(chat), origin: r.origin, destination: r.destination,
    departure: r.departure, ret: r.ret, adults: r.adults, cabin: r.cabin,
    market: r.market, nonstop: r.nonstop, every: every, baseEvery: every,
    flight: flight, until: until, paused: false,
    target: isFinite(target) && target > 0 ? target : 0,
    createdAt: Date.now(), lastCheckAt: 0, lastAmount: null, lastAlertAt: 0, lastAlertAmount: null
  };
  await env.KV.put("w:" + team + ":" + id, JSON.stringify(w), { expirationTtl: WATCH_TTL });
  await addWatchKey(env, "w:" + team + ":" + id);

  let nowTxt = "";
  try {
    const t = await takeBudget(env);
    if (!t.ok) throw new Error("Aaj ka budget (" + t.cap + ") khatam — abhi live price nahi de sakta.");
    const best = bestFare(await ignavCall(env, w.ret ? "/fares/round-trip" : "/fares/one-way", routePayload(w)), w.flight);
    if (best) {
      w.lastAmount = Number(best.price.amount);
      w.lastCurrency = best.price.currency || "PKR";
      w.lastBestId = best.ignav_id || "";
      w.lastCheckAt = Date.now();
      await env.KV.put("w:" + team + ":" + id, JSON.stringify(w), { expirationTtl: WATCH_TTL });
      nowTxt = "\n\nAbhi sab se sasta: <b>" + esc(money(w.lastAmount, w.lastCurrency)) + "</b>" +
        (best.outbound && best.outbound.segments && best.outbound.segments[0]
          ? " — " + esc(String(best.outbound.segments[0].marketing_carrier_code || "") + " " + String(best.outbound.segments[0].flight_number || ""))
          : "") +
        "\n🕒 " + pktNowText() + " · source: Ignav";
    }
  } catch (e) {
    nowTxt = "\n\n<i>Abhi price check nahi hua: " + esc(e.message) + "</i>";
  }

  await send(env, chat,
    "✅ <b>Watch #" + id + " on</b>\n" + routeTitle(w) +
    "\nHar <b>" + every + " min</b> check" +
    (w.flight ? "\nFlight: " + esc(w.flight) : "") +
    (w.until ? "\nBand: " + esc(untilLabel(w.until)) + " PKT" : "") +
    (w.target ? "\nTarget: <b>" + esc(money(w.target, w.lastCurrency || "PKR")) + "</b> ya kam" : "\nAlert jab price gir jaye (5%+)") +
    nowTxt +
    "\n\nNeeche se interval badlein ya band karein.\nUrgent (har minute): <code>/urgent " + id + " 60</code>",
    { reply_markup: intervalButtons(id) });

  const teamList = await allowedChats(env);
  for (const c of teamList) {
    if (String(c) === String(chat)) continue;
    try {
      await send(env, c, "👥 Naya watch #" + id + " add hua — " + routeTitle(w) +
        " · har " + every + " min" + (w.until ? " · band " + esc(untilLabel(w.until)) + " PKT" : ""));
    } catch (e) { /* ignore */ }
  }
  return id;
}

async function cmdWatch(env, chat, args, opts) {
  const r = readRoute(args, opts);
  if (r.error) return send(env, chat, esc(r.error));
  let until = 0;
  if (opts.until) {
    const m = String(opts.until).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/i);
    if (!m || !isoOk(m[1]) || Number(m[2]) > 23 || Number(m[3]) > 59) {
      return send(env, chat, "End time misaal: <code>until=2026-12-14T22:00</code> (Pakistan time)");
    }
    until = Date.parse(m[1] + "T" + m[2] + ":" + m[3] + ":00+05:00");
    if (until <= Date.now()) return send(env, chat, "Tracking ka end time future mein hona chahiye.");
  }
  return createWatch(env, chat, r, {
    every: opts.every, target: opts.target, flight: opts.flight, until: until
  });
}

async function handleNatural(env, chat, text) {
  const p = parseNatural(text);
  if (!p.route && !p.date) {
    return send(env, chat, "Samajh nahi aaya — misaal: <code>DXB to KHI 15 December</code>\n\n" + HELP);
  }
  if (!p.route) return send(env, chat, "Route samajh nahi aaya. Misaal: <code>DXB to KHI 15 December</code>");
  if (!p.date) {
    return send(env, chat, "Date samajh nahi aayi. Misaal: <code>DXB to KHI 15 December</code> ya <code>kal</code>.");
  }
  if (p.date < todayIso()) return send(env, chat, "Ye date guzar gayi hai: " + esc(p.date) + ". Nayi date bhejein.");
  const r = {
    origin: p.route.origin, destination: p.route.destination, departure: p.date,
    ret: "", adults: 1, cabin: "economy", market: "PK", nonstop: false
  };
  if (p.watch) {
    return createWatch(env, chat, r, {
      every: p.every || DEFAULT_EVERY, target: p.target, flight: p.flight, until: p.until.ms
    });
  }
  return doPrice(env, chat, r, {
    reply_markup: kb([[
      { text: "👁 Track har 60 min", callback_data: "np:" + encodeURIComponent([r.origin, r.destination, r.departure, p.flight || "", "60"].join("|")) },
      { text: "⚙️ Interval", callback_data: "np:" + encodeURIComponent([r.origin, r.destination, r.departure, p.flight || "", "choose"].join("|")) }
    ]])
  }, p.flight);
}


/* Strongly consistent index. Each watch has its own Durable Object storage key.
   Bootstrap once from KV (including watches missed by the old shared index). */
export class WatchIndex {
  constructor(state, env) {
    this.state = state;
    state.blockConcurrencyWhile(async () => {
      if (await state.storage.get("initialized")) return;
      let cursor;
      do {
        const page = await env.KV.list({ prefix: "w:", limit: 1000, cursor });
        for (const k of page.keys) {
          if (k.name !== WATCH_INDEX && /^w:[^:]+:[^:]+$/.test(k.name)) {
            await state.storage.put("watch:" + k.name, true);
          }
        }
        cursor = page.list_complete === false ? page.cursor : undefined;
      } while (cursor);
      await state.storage.put("initialized", true);
    });
  }
  async fetch(request) {
    const b = await request.json();
    // Reminder store - same Durable Object, serial writes (no lost updates).
    if (b.action === "remind-list") {
      const items = await this.state.storage.list({ prefix: "remind:" });
      return jres(Array.from(items.values()));
    }
    if (b.action === "remind-add") {
      const r = (b.payload && b.payload.reminder) || null;
      if (!r || !r.id) return jres({ ok: false }, 400);
      const items = await this.state.storage.list({ prefix: "remind:" });
      if (items.size >= 60) return jres({ ok: false, full: true });
      await this.state.storage.put("remind:" + r.id, r);
      return jres({ ok: true });
    }
    if (b.action === "remind-remove") {
      const id = (b.payload && b.payload.id) || "";
      if (!id) return jres({ ok: false }, 400);
      await this.state.storage.delete("remind:" + id);
      return jres({ ok: true });
    }
    if (b.action === "remind-replace") {
      const list = (b.payload && Array.isArray(b.payload.list)) ? b.payload.list : [];
      const existing = await this.state.storage.list({ prefix: "remind:" });
      for (const key of existing.keys()) await this.state.storage.delete(key);
      for (const r of list.slice(0, 60)) await this.state.storage.put("remind:" + r.id, r);
      return jres({ ok: true });
    }
    if (b.action === "remind-clear") {
      const existing = await this.state.storage.list({ prefix: "remind:" });
      for (const key of existing.keys()) await this.state.storage.delete(key);
      return jres({ ok: true, removed: existing.size });
    }
    // Claim: poora read-modify-write Durable Object ke andar hota hai, is liye
    // ek doosre waqt naya reminder add kar raha ho to wo kho nahi jata.
    if (b.action === "remind-claim") {
      const now = Date.now();
      const items = await this.state.storage.list({ prefix: "remind:" });
      const fired = [];
      for (const r of items.values()) {
        let pending = false;
        const slots = [];
        for (const s of (r.slots || [])) {
          if (s.done) { slots.push(s); continue; }
          if (s.at > now) { pending = true; slots.push(s); continue; }
          s.done = true;
          slots.push(s);
          fired.push({ id: r.id, text: r.text, event: r.event, rel: r.rel, slot: s });
        }
        if (pending) await this.state.storage.put("remind:" + r.id, Object.assign({}, r, { slots: slots }));
        else await this.state.storage.delete("remind:" + r.id);
      }
      return jres({ fired: fired });
    }
    if (b.action === "add" || b.action === "remove") {
      if (!/^w:[^:]+:[^:]+$/.test(String(b.key || ""))) return jres({ error: "key" }, 400);
      if (b.action === "add") await this.state.storage.put("watch:" + b.key, true);
      else await this.state.storage.delete("watch:" + b.key);
      return jres({ ok: true });
    }
    const keys = await this.state.storage.list({ prefix: "watch:" });
    return jres([...keys.keys()].map(k => k.slice(6)));
  }
}
async function watchIndexCall(env, action, key) {
  if (!env.WATCH_INDEX_DO) throw new Error("WATCH_INDEX_DO binding missing");
  const stub = env.WATCH_INDEX_DO.get(env.WATCH_INDEX_DO.idFromName("team-watches"));
  const r = await stub.fetch("https://watch-index/", {
    method: "POST", body: JSON.stringify({ action, key })
  });
  if (!r.ok) throw new Error("Watch index unavailable");
  return r.json();
}
async function watchKeys(env) { return watchIndexCall(env, "list"); }
async function addWatchKey(env, key) { await watchIndexCall(env, "add", key); }
async function removeWatchKey(env, key) { await watchIndexCall(env, "remove", key); }

async function watches(env, chat) {
  const out = [];
  const team = (await teamChat(env)) || String(chat);
  const prefix = "w:" + team + ":";
  const keys = (await watchKeys(env)).filter(function (k) { return k.indexOf(prefix) === 0; });
  for (const key of keys) {
    const raw = await env.KV.get(key);
    if (!raw) continue; // KV may not yet reflect a just-created watch.
    try { out.push(JSON.parse(raw)); } catch (e) { /* skip */ }
  }
  out.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
  return out;
}

async function cmdList(env, chat) {
  const ws = await watches(env, chat);
  if (!ws.length) return send(env, chat, "Koi watch nahi. <code>/watch KHI DXB 01-12-2026</code> se shuru karein.");
  let msg = "<b>Aap ke watches</b>\n";
  for (const w of ws) {
    msg += "\n<b>#" + w.id + "</b> " + esc(w.origin) + " → " + esc(w.destination) + " · " + esc(prettyDate(w.departure)) +
      (w.ret ? " ↔ " + esc(prettyDate(w.ret)) : "") +
      "\n   every " + (w.every || DEFAULT_EVERY) + " min" +
      (w.urgentUntil ? " ⚡" : "") +
      (w.paused ? " ⏸ paused" : "") +
      (w.flight ? " · " + esc(w.flight) : "") +
      (w.target ? " · target " + esc(money(w.target, w.lastCurrency || "PKR")) : "") +
      (w.until ? "\n   band: " + esc(untilLabel(w.until)) + " PKT" : "") +
      (w.lastAmount != null ? "\n   last: " + esc(money(w.lastAmount, w.lastCurrency || "PKR")) +
        (w.lastCheckAt ? " (" + Math.round((Date.now() - w.lastCheckAt) / 60000) + " min pehle)" : "") : "") +
      "\n   <code>/urgent " + w.id + " 60</code> · <code>/stop " + w.id + "</code>";
  }
  await send(env, chat, msg);
}

async function cmdStop(env, chat, arg) {
  const ws = await watches(env, chat);
  const team = (await teamChat(env)) || String(chat);
  if (!arg) return send(env, chat, "ID dein: <code>/stop 1</code> ya <code>/stop all</code>.");
  if (/^all$/i.test(arg)) {
    for (const w of ws) {
      const key = "w:" + team + ":" + w.id;
      await env.KV.delete(key);
      await removeWatchKey(env, key);
    }
    return send(env, chat, "🗑 " + ws.length + " watch band kar diye.");
  }
  const id = String(arg).replace(/[^0-9]/g, "");
  if (!ws.some(function (w) { return String(w.id) === id; })) {
    return send(env, chat, "Watch #" + esc(arg) + " nahi mila. <code>/list</code> dekhein.");
  }
  await env.KV.delete("w:" + team + ":" + id);
  await removeWatchKey(env, "w:" + team + ":" + id);
  await send(env, chat, "🗑 Watch #" + id + " band.");
}

async function cmdPause(env, chat, arg, on) {
  const id = String(arg || "").replace(/[^0-9]/g, "");
  if (!id) return send(env, chat, "Misaal: <code>/pause 123</code> ya <code>/resume 123</code>");
  const team = (await teamChat(env)) || String(chat);
  const key = "w:" + team + ":" + id;
  const raw = await env.KV.get(key);
  if (!raw) return send(env, chat, "Watch #" + id + " nahi mila. <code>/list</code> dekhein.");
  const w = JSON.parse(raw);
  w.paused = !!on;
  await env.KV.put(key, JSON.stringify(w), { expirationTtl: WATCH_TTL });
  return send(env, chat, (on ? "⏸ Watch #" + id + " paused." : "▶️ Watch #" + id + " dobara chalu.") +
    "\n<code>/interval " + id + " 15</code> se interval badal sakte hain.");
}

async function handleCallback(env, cq) {
  const chat = cq && cq.message && cq.message.chat && cq.message.chat.id;
  const data = String((cq && cq.data) || "");
  if (!chat) return;
  if (!env.KV) return;
  if (!(await isAllowed(env, chat))) {
    try { await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: "Private bot", show_alert: true }); } catch (e) { /* ignore */ }
    return;
  }
  try { await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: "OK" }); } catch (e) { /* ignore */ }
  const team = (await teamChat(env)) || String(chat);
  const parts = data.split(":");
  const kind = parts[0];

  if (kind === "iv") {
    const id = String(parts[1] || "").replace(/[^0-9]/g, "");
    const mins = Number(parts[2]);
    const key = "w:" + team + ":" + id;
    const raw = await env.KV.get(key);
    if (!raw) return send(env, chat, "Watch nahi mila. <code>/list</code> dekhein.");
    const w = JSON.parse(raw);
    w.every = Math.min(1440, Math.max(1, mins || DEFAULT_EVERY));
    w.baseEvery = w.every;
    w.urgentUntil = 0;
    w.paused = false;
    await env.KV.put(key, JSON.stringify(w), { expirationTtl: WATCH_TTL });
    return send(env, chat, "✅ Watch #" + id + " ab har <b>" + w.every + " min</b> check hoga.\n" +
      "<i>Har check 1 Ignav search hai.</i>\n<code>/urgent " + id + " 60</code> se har minute.", { reply_markup: intervalButtons(id) });
  }

  if (kind === "st") {
    const id = String(parts[1] || "").replace(/[^0-9]/g, "");
    await env.KV.delete("w:" + team + ":" + id);
    await removeWatchKey(env, "w:" + team + ":" + id);
    return send(env, chat, "🗑 Watch #" + id + " band.");
  }

  if (kind === "ps") {
    const id = String(parts[1] || "").replace(/[^0-9]/g, "");
    const key = "w:" + team + ":" + id;
    const raw = await env.KV.get(key);
    if (!raw) return send(env, chat, "Watch nahi mila.");
    const w = JSON.parse(raw);
    w.paused = !w.paused;
    await env.KV.put(key, JSON.stringify(w), { expirationTtl: WATCH_TTL });
    return send(env, chat, w.paused ? "⏸ Watch #" + id + " paused." : "▶️ Watch #" + id + " chalu.");
  }

  if (kind === "bk") {
    const id = String(parts[1] || "").replace(/[^0-9]/g, "");
    return cmdBook(env, chat, id);
  }

  if (kind === "np") {
    const v = String(parts.slice(1).join(":"));
    let f = [];
    try { f = decodeURIComponent(v).split("|"); } catch (e) { f = []; }
    const r = {
      origin: String(f[0] || "").toUpperCase(), destination: String(f[1] || "").toUpperCase(),
      departure: String(f[2] || ""), ret: "", adults: 1, cabin: "economy", market: "PK", nonstop: false
    };
    if (!/^[A-Z]{3}$/.test(r.origin) || !/^[A-Z]{3}$/.test(r.destination) || !isoOk(r.departure)) {
      return send(env, chat, "Ye button purana ho gaya. Route dobara bhejein.");
    }
    const flight = String(f[3] || "");
    if (f[4] === "choose") {
      const enc = encodeURIComponent([r.origin, r.destination, r.departure, flight].join("|"));
      return send(env, chat, "Interval chunein — watch #? ban jayega:", {
        reply_markup: kb([
          [
            { text: "1 min", callback_data: "np2:" + enc + ":1" },
            { text: "5 min", callback_data: "np2:" + enc + ":5" },
            { text: "10 min", callback_data: "np2:" + enc + ":10" }
          ],
          [
            { text: "15 min", callback_data: "np2:" + enc + ":15" },
            { text: "30 min", callback_data: "np2:" + enc + ":30" },
            { text: "60 min", callback_data: "np2:" + enc + ":60" }
          ]
        ])
      });
    }
    return createWatch(env, chat, r, { every: Number(f[4]) || 60, flight: flight });
  }

  if (kind === "np2") {
    let f = [];
    try { f = decodeURIComponent(parts[1] || "").split("|"); } catch (e) { f = []; }
    const r = {
      origin: String(f[0] || "").toUpperCase(), destination: String(f[1] || "").toUpperCase(),
      departure: String(f[2] || ""), ret: "", adults: 1, cabin: "economy", market: "PK", nonstop: false
    };
    if (!/^[A-Z]{3}$/.test(r.origin) || !/^[A-Z]{3}$/.test(r.destination) || !isoOk(r.departure)) {
      return send(env, chat, "Ye button purana ho gaya. Route dobara bhejein.");
    }
    return createWatch(env, chat, r, { every: Number(parts[2]) || 60, flight: String(f[3] || "") });
  }
}

async function cmdUrgent(env, chat, args) {
  const id = String(args[0] || "").replace(/[^0-9]/g, "");
  const mins = Math.min(720, Math.max(1, Math.floor(Number(args[1] || 60)) || 60));
  if (!id) return send(env, chat, "Misaal: <code>/urgent 1 60</code> (watch #1, 60 minute har minute check)");
  const team = (await teamChat(env)) || String(chat);
  const key = "w:" + team + ":" + id;
  const raw = await env.KV.get(key);
  if (!raw) return send(env, chat, "Watch #" + id + " nahi mila. <code>/list</code> dekhein.");
  const w = JSON.parse(raw);
  w.urgentUntil = Date.now() + mins * 60000;
  w.every = 1;
  await env.KV.put(key, JSON.stringify(w), { expirationTtl: WATCH_TTL });
  await send(env, chat,
    "⚡ <b>Urgent mode on</b> — watch #" + id + " har <b>1 minute</b> check hoga, <b>" + mins + " min</b> tak.\n" +
    "<i>Har check 1 Ignav search use karta hai. Budget: <code>/budget</code>.</i>");
}

async function cmdInterval(env, chat, args) {
  const id = String(args[0] || '').replace(/[^0-9]/g, '');
  const mins = Number(args[1]);
  if (!id || !Number.isInteger(mins) || mins < 1 || mins > 1440) {
    return send(env, chat, 'Misaal: <code>/interval 123 60</code> (har 60 minute).');
  }
  const team = (await teamChat(env)) || String(chat);
  const key = 'w:' + team + ':' + id;
  const raw = await env.KV.get(key);
  if (!raw) return send(env, chat, 'Watch nahi mila. <code>/list</code> dekhein.');
  const w = JSON.parse(raw);
  w.every = mins;
  w.baseEvery = mins;
  w.urgentUntil = 0;
  await env.KV.put(key, JSON.stringify(w), { expirationTtl: WATCH_TTL });
  return send(env, chat, 'Watch #' + esc(id) + ' ab har <b>' + mins + ' min</b> check hoga. Har check Ignav request hai.');
}

async function cmdBook(env, chat, arg) {
  const id = String(arg || "").replace(/[^0-9]/g, "");
  if (!id) return send(env, chat, "Misaal: <code>/book 1</code>");
  const ws = await watches(env, chat);
  const w = ws.filter(function (x) { return String(x.id) === id; })[0];
  if (!w || !w.lastBestId) return send(env, chat, "Pehle us route ka price check hona chahiye. <code>/list</code> se ID lein.");
  const t = await takeBudget(env);
  if (!t.ok) return send(env, chat, "Aaj ka search budget (" + t.cap + ") khatam.");
  let j = null;
  try {
    j = await ignavCall(env, "/fares/booking-links", { ignav_id: w.lastBestId });
  } catch (e) {
    return send(env, chat, "⚠️ Booking links nahi mile: " + esc(e.message) + "\nOffer expire ho gaya ho to <code>/watch</code> dobara chalayein.");
  }
  const opts = (j && j.booking_options) || [];
  if (!opts.length) return send(env, chat, "Booking links nahi mile (offer expire ho sakta hai). Dobara <code>/watch</code> chalayein.");
  let msg = "<b>Book — " + esc(w.origin) + " → " + esc(w.destination) + "</b>\n";
  for (const o of opts.slice(0, 3)) {
    msg += "\n<i>" + esc((o.legs || []).join(" + ") || "offer") + "</i>\n";
    for (const l of (o.links || []).slice(0, 3)) msg += "• " + esc(l.provider || "link") + ": " + esc(l.url) + "\n";
  }
  msg += "\n<i>Price booking page par confirm karein.</i>";
  await send(env, chat, msg);
}

async function cmdBudget(env, chat, arg) {
  const cap = budgetCap(env);
  if (arg && /^\d+$/.test(arg)) {
    return send(env, chat, "Daily cap env se set hota hai: Worker → Settings → Variables → <code>MAX_DAILY_REQUESTS</code>. Abhi: <b>" + cap + "</b>.");
  }
  const used = Number((await env.KV.get(budgetKey())) || 0);
  await send(env, chat, "📊 <b>Aaj ka search budget</b>\n" + used + " / " + cap + " use hua — " + Math.max(0, cap - used) + " baqi.\n" +
    "<i>Ignav free allowance 1,000 searches (one-time). Har minute check = 60/hour.</i>");
}

async function cmdQuiet(env, chat, args) {
  const owner = await teamChat(env);
  const q = await getQuiet(env);
  const arg = String((args && args[0]) || "").trim().toLowerCase();
  const isOwner = !owner || String(owner) === String(chat);

  if (!arg) {
    return send(env, chat,
      "🌙 <b>Quiet hours</b>\n" +
      "Status: <b>" + (q.enabled ? "ON" : "OFF") + "</b>" +
      (q.enabled ? " · " + esc(q.start + "–" + q.end + " PKT") : "") + "\n" +
      "<i>Is waqt koi automatic check nahi hota — Ignav searches bachti hain.</i>\n\n" +
      (isOwner
        ? "<code>/quiet on</code> · <code>/quiet off</code>\n<code>/quiet 02:00-09:00</code> (Pakistan time)"
        : "Sirf owner quiet hours change kar sakta hai."));
  }
  if (!isOwner) return send(env, chat, "Sirf owner quiet hours change kar sakta hai.");

  if (arg === "on" || arg === "off") {
    q.enabled = arg === "on";
    await saveQuiet(env, q);
    return send(env, chat,
      "🌙 Quiet hours <b>" + (q.enabled ? "ON" : "OFF") + "</b>" +
      (q.enabled ? " · " + esc(q.start + "–" + q.end + " PKT") : "") + ".");
  }

  const range = parseQuietRange(arg);
  if (range) {
    q.enabled = true;
    q.start = range.start;
    q.end = range.end;
    await saveQuiet(env, q);
    return send(env, chat,
      "🌙 Quiet hours <b>ON</b> · " + esc(q.start + "–" + q.end + " PKT") + ".\n" +
      "<i>Is waqt koi automatic check nahi hoga.</i>");
  }

  return send(env, chat, "Misaal: <code>/quiet on</code> · <code>/quiet off</code> · <code>/quiet 02:00-09:00</code>");
}

async function cmdShare(env, chat, args) {
  const owner = await teamChat(env);
  if (!owner || String(owner) !== String(chat)) {
    const extra = await sharedChats(env);
    const list = await allowedChats(env);
    return send(env, chat,
      "👥 <b>Team access</b>\n" +
      list.map(function (c) {
        const role = String(c) === String(owner) ? " (owner)" : "";
        return "• <code>" + esc(c) + "</code>" + role;
      }).join("\n") +
      (extra.length ? "" : "\n\nSirf aap abhi allowed hain.") +
      "\n\n<i>Naya member add sirf owner kar sakta hai: <code>/share ID</code></i>");
  }

  const raw = String((args && args[0]) || "").replace(/[^0-9-]/g, "");
  if (!raw) {
    const list = await allowedChats(env);
    let msg = "👥 <b>Team access</b>\n" + list.map(function (c) {
      return "• <code>" + esc(c) + "</code>" + (String(c) === String(owner) ? " (owner)" : "");
    }).join("\n");
    msg += "\n\n<b>Add:</b> <code>/share 123456789</code>\n<b>Remove:</b> <code>/unshare 123456789</code>";
    msg += "\n<i>Sarmad se kahein bot par <code>/id</code> bheje, phir wo number yahan add karein.</i>";
    return send(env, chat, msg);
  }

  const id = String(Number(raw));
  if (!/^-?\d+$/.test(id)) return send(env, chat, "Chat ID sahi nahi. Misaal: <code>/share 123456789</code>");
  if (id === String(owner)) return send(env, chat, "Ye aap ka hi chat ID hai (owner).");

  const list = await sharedChats(env);
  if (list.indexOf(id) >= 0) return send(env, chat, "✅ <code>" + esc(id) + "</code> pehle se team mein hai.");

  if (list.length >= 10) return send(env, chat, "Max 10 team members. Pehle <code>/unshare ID</code> karein.");

  list.push(id);
  await env.KV.put("share", JSON.stringify(list));

  await send(env, chat, "✅ <code>" + esc(id) + "</code> team mein add ho gaya.\nAb us chat ko bhi alerts jayenge aur wo <code>/list</code>, <code>/watch</code>, <code>/stop</code> sab chala sakta hai.");
  try {
    await send(env, id, "👋 <b>AB Travels price bot — access mil gaya.</b>\n\nAb aap bhi tracks dekh sakte hain aur price alerts aap ko bhi aayenge.\n\n<code>/list</code> — sab tracks\n<code>/price DXB KHI 15-12-2026</code> — price\n<code>/help</code> — poori madad");
  } catch (e) {
    await send(env, chat, "⚠️ Add to ho gaya, lekin us chat ko welcome message nahi gaya (shayad us ne bot ko /start nahi kiya). Us se kahein pehle bot par <code>/start</code> bheje.");
  }
}

async function cmdUnshare(env, chat, arg) {
  const owner = await teamChat(env);
  if (!owner || String(owner) !== String(chat)) {
    return send(env, chat, "Sirf owner team members remove kar sakta hai.");
  }
  const raw = String(arg || "").replace(/[^0-9-]/g, "");
  if (!raw) return send(env, chat, "Misaal: <code>/unshare 123456789</code>");
  const id = String(Number(raw));
  const list = await sharedChats(env);
  const next = list.filter(function (c) { return c !== id; });
  if (next.length === list.length) return send(env, chat, "Ye ID team mein nahi mila. <code>/share</code> se list dekhein.");
  await env.KV.put("share", JSON.stringify(next));
  await send(env, chat, "🗑 <code>" + esc(id) + "</code> team se remove ho gaya.");
  try { await send(env, id, "🔒 Aap ka access band kar diya gaya hai."); } catch (e) { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* Reminders                                                            */
/*   /remind Air Arabia: Usama ki booking 1 bje expire hogi             */
/*   -> team ko 12:00 aur 12:30 par alarm (1 ghanta + 30 min pehle).    */
/*   Stored in one KV key ("reminds"); the every-minute cron fires      */
/*   due slots. Reminders ignore quiet hours (explicit alarms).         */
/* ------------------------------------------------------------------ */

const REMIND_KEY = "reminds";
const MAX_REMINDS = 60;
const REMIND_DEFAULT_LEADS = [60, 30]; // minutes before the event

/* Reminders bhi Durable Object mein rakhein - ek KV key pe read-modify-write se
   do reminders ek saath add ho to ek gayab ho jati thi (wahi bug jo watch
   index mein tha). DO ke andar har write serialize hota hai. */
async function remindDoCall(env, action, payload) {
  if (!env.WATCH_INDEX_DO) throw new Error("WATCH_INDEX_DO binding missing");
  const stub = env.WATCH_INDEX_DO.get(env.WATCH_INDEX_DO.idFromName("team-watches"));
  const r = await stub.fetch("https://watch-index/", {
    method: "POST", body: JSON.stringify({ action: action, payload: payload || null })
  });
  if (!r.ok) throw new Error("Reminder store unavailable");
  return r.json();
}
async function readReminds(env) {
  if (env.WATCH_INDEX_DO) {
    try {
      const res = await remindDoCall(env, "remind-list");
      return Array.isArray(res) ? res : [];
    } catch (e) { /* fall through to KV */ }
  }
  if (!env.KV) return [];
  try {
    const raw = await env.KV.get(REMIND_KEY);
    let a = [];
    try { a = JSON.parse(raw || "[]"); } catch (e) { a = []; }
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}

async function writeReminds(env, list) {
  if (env.WATCH_INDEX_DO) {
    try {
      await remindDoCall(env, "remind-replace", { list: list });
      return;
    } catch (e) { /* fall through to KV */ }
  }
  if (!env.KV) return;
  await env.KV.put(REMIND_KEY, JSON.stringify((list || []).slice(0, MAX_REMINDS)));
}
/* Naya reminder add karein - DO use karte waqt ye atomic hai. */
async function addRemind(env, r) {
  if (env.WATCH_INDEX_DO) {
    try {
      const res = await remindDoCall(env, "remind-add", { reminder: r });
      return !!(res && res.ok);
    } catch (e) { /* fall through to KV */ }
  }
  const list = await readReminds(env);
  if (list.length >= MAX_REMINDS) return false;
  list.push(r);
  await writeReminds(env, list);
  return true;
}
/* Cron ke liye: jo slots due hain unhe atomically claim karein (do baar fire
   na ho) aur baqi list wapas dein. */
async function claimDueReminders(env) {
  if (env.WATCH_INDEX_DO) {
    const res = await remindDoCall(env, "remind-claim");
    const fired = (res && Array.isArray(res.fired)) ? res.fired : [];
    return fired.map(function (item) {
      return { r: { id: item.id, text: item.text, event: item.event, rel: item.rel, slots: [item.slot] }, slot: item.slot };
    });
  }
  // KV fallback (DO binding ke bina) - purana read-modify-write
  const now = Date.now();
  const fired = [];
  const list = await readReminds(env);
  if (!list.length) return fired;
  const next = [];
  for (const r of list) {
    let pending = false;
    for (const s of (r.slots || [])) {
      if (s.done) continue;
      if (s.at > now) { pending = true; continue; }
      s.done = true;
      fired.push({ r: r, slot: s });
    }
    if (pending) next.push(r);
  }
  if (fired.length) await writeReminds(env, next);
  return fired;
}

function hhmm12(hm) {
  const parts = String(hm).split(":");
  let h = Number(parts[0]);
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return h + ":" + parts[1] + " " + ap;
}

function pktEventText(ms) {
  // "10 Nov 2026 1:00 PM PKT"
  return prettyDate(pktIso(ms).slice(0, 10)) + " " + hhmm12(pktIso(ms).slice(11, 16)) + " PKT";
}

// "1 bje" = 1 PM (1–7 baje, bina subah/raat ke, dopahar maane jate hain)
function parseEventWhen(text) {
  const t = String(text || "");
  const lower = t.toLowerCase();
  const now = Date.now();
  let m = lower.match(/\b(\d{1,3})\s*(min|mins|minute|minutes|minit|minits)\b/);
  if (m) return { event: now + Number(m[1]) * 60000, rel: true };
  m = lower.match(/\b(\d{1,2})\s*(hour|hours|ghanta|ghantay|ghante)\b/);
  if (m) return { event: now + Number(m[1]) * 3600000, rel: true };
  m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(?:baje|bje|bajay|o'?clock|am|pm)\b/i);
  let h = 0, mi = 0;
  if (m) {
    h = Number(m[1]);
    mi = Number(m[2] || 0);
  } else {
    m = t.match(/\b(\d{1,2}):(\d{2})\b/);
    if (!m) return null;
    h = Number(m[1]);
    mi = Number(m[2]);
  }
  if (h > 23 || mi > 59) return null;
  const pm = /\bpm\b|shaam|sham|raat|evening|night/.test(lower);
  const am = /\bam\b|subah|morning/.test(lower);
  // "raat 12 bje" = midnight (00:00), noon sirf "12 bje" ya "12 pm" par
  const midnight = (pm && !am) && h === 12 && /\braat\b|\bnight\b|\bmidnight\b/.test(lower);
  if (midnight) h = 0;
  else if ((pm && !am && h < 12) || (!pm && !am && h >= 1 && h <= 7)) h += 12;
  else if (am && h === 12) h = 0;
  // "kal raat 10 bje" = kal raat 10 baje. naturalDate "kal raat" ko flight
  // context (jis mein "raat" sirf "tak" ka hissa hai) ke liye ignore karta hai,
  // is liye reminder ke liye date alag se nikaalein.
  const explicitDate = /\b(kal|aaj|tomorrow|today)\b|\b\d{1,2}[-/.]\d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b/.test(lower);
  let date = naturalDate(t);
  if (!date) {
    if (/\b(kal|tomorrow)\b/.test(lower)) date = addDaysIso(pktToday(), 1);
    else if (/\b(aaj|today)\b/.test(lower)) date = pktToday();
    else date = pktToday();
  }
  let event = Date.parse(date + "T" + ("0" + h).slice(-2) + ":" + ("0" + mi).slice(-2) + ":00+05:00");
  if (!isFinite(event)) return null;
  if (!explicitDate && event <= now + 60000) event += 86400000;
  return { event: event, rel: false };
}

function parseLeads(opts) {
  const raw = String((opts && opts.lead) || "").trim();
  if (!raw) return REMIND_DEFAULT_LEADS.slice();
  const arr = raw.split(/[,;\s]+/).map(Number).filter(function (n) { return isFinite(n) && n >= 0 && n <= 10080; });
  const uniq = Array.from(new Set(arr)).sort(function (a, b) { return b - a; });
  return uniq.length ? uniq : REMIND_DEFAULT_LEADS.slice();
}

async function cmdRemind(env, chat, args, opts) {
  if (!env.KV) return send(env, chat, "KV binding missing — Worker settings mein KV namespace (variable name KV) add karein.");
  const text = args.join(" ").trim();
  if (!text) return send(env, chat,
    "Reminder likhein — misaal:\n" +
    "<code>/remind Air Arabia: Usama ki booking 1 bje expire hogi</code> → 1 ghanta pehle (12 baje) aur 30 min pehle (12:30) remind\n" +
    "<code>/remind Call Sarmad 30 min baad</code>\n" +
    "Option: <code>lead=60,30,10</code> (kitne minute pehle; 0 = waqt par)");
  const when = parseEventWhen(text);
  if (!when) return send(env, chat,
    "Waqt samajh nahi aaya. Misaal:\n" +
    "<code>/remind Usama ki booking 1 bje expire hogi</code>\n" +
    "<code>/remind Report 9:30</code>\n" +
    "<code>/remind Call Sarmad 30 min baad</code>");
  const leads = parseLeads(opts);
  const slots = (when.rel ? [0] : leads).map(function (l) {
    return { lead: when.rel ? 0 : l, at: l === 0 ? when.event : when.event - l * 60000, done: false };
  }).filter(function (s) { return s.at > Date.now() - 30000; }).sort(function (a, b) { return a.at - b.at; });
  // Event qareeb hai aur lead times nikal chuke hain - kam az kam event ke waqt
  // par to ek reminder lag jaye (warna user ko kuch hi nahi milta).
  if (!slots.length && !when.rel && when.event > Date.now() + 30000) {
    slots.push({ lead: 0, at: when.event, done: false });
  }
  if (!slots.length) return send(env, chat, "Ye waqt guzar chuka hai — reminder nahi lag saka.");
  const list = await readReminds(env);
  if (list.length >= MAX_REMINDS) return send(env, chat, "Max " + MAX_REMINDS + " reminders. Pehle <code>/unremind ID</code> se purana hata dein.");
  let id = "";
  do { id = "R" + (1 + Math.floor(Math.random() * 899)); } while (list.some(function (r) { return r.id === id; }));
  const r = { id: id, chat: String(chat), text: text.slice(0, 300), event: when.event, rel: !!when.rel, slots: slots, createdAt: Date.now() };
  const added = await addRemind(env, r);
  if (!added) return send(env, chat, "Reminder save nahi hua - thori der baad dobara try karein.");
  let msg = "✅ <b>Reminder #" + id + " set</b>\n" + esc(r.text) + "\n";
  if (when.rel) {
    msg += "\n⏰ Remind: <b>" + pktEventText(slots[0].at) + "</b>";
  } else {
    msg += "\nEvent: <b>" + pktEventText(when.event) + "</b>";
    msg += "\n⏰ Remind: " + slots.map(function (s) {
      return pktEventText(s.at) + (s.lead > 0 ? " (" + s.lead + " min pehle)" : " (waqt par)");
    }).join(" · ");
  }
  msg += "\n\nHatane: <code>/unremind " + id + "</code> · list: <code>/reminds</code>";
  return send(env, chat, msg);
}

function remindText(r, s) {
  let t = "⏰ <b>REMINDER</b>\n";
  t += esc(r.text) + "\n";
  if (!r.rel) t += "\nEvent: " + pktEventText(r.event) + (s.lead > 0 ? " (" + s.lead + " min baqi)" : " (waqt ho gaya)") + "\n";
  t += "\n🕒 " + pktNowText();
  return t;
}

async function checkReminders(env) {
  if (!env.KV && !env.WATCH_INDEX_DO) return;
  let fired = [];
  try {
    fired = await claimDueReminders(env);
  } catch (e) { return; }
  for (const item of fired) {
    try { await notifyAll(env, remindText(item.r, item.slot)); } catch (e) { /* ignore */ }
  }
}

async function cmdReminds(env, chat) {
  const list = (await readReminds(env)).filter(function (r) { return (r.slots || []).some(function (s) { return !s.done; }); });
  if (!list.length) return send(env, chat, "Koi reminder nahi. <code>/remind Usama ki booking 1 bje expire hogi</code> se lagayein.");
  const rows = [];
  for (const r of list) for (const s of r.slots) if (!s.done) rows.push({ at: s.at, id: r.id, txt: r.text });
  rows.sort(function (a, b) { return a.at - b.at; });
  let msg = "⏰ <b>Upcoming reminders</b>\n";
  for (const row of rows) msg += "\n<b>" + pktEventText(row.at) + "</b> · #" + row.id + " · " + esc(row.txt.slice(0, 80));
  msg += "\n\nHatane: <code>/unremind R12</code> · sab band: <code>/unremind all</code>";
  return send(env, chat, msg);
}

async function cmdUnremind(env, chat, arg) {
  const list = await readReminds(env);
  const a = String(arg || "").trim();
  if (!a) return send(env, chat, "Reminder ID dein: <code>/unremind R12</code> ya <code>/unremind all</code>");
  if (/^all$/i.test(a)) {
    if (!list.length) return send(env, chat, "Koi reminder nahi.");
    if (env.WATCH_INDEX_DO) {
      try { await remindDoCall(env, "remind-clear"); } catch (e) { /* ignore */ }
    } else {
      await writeReminds(env, []);
    }
    return send(env, chat, "✅ " + list.length + " reminders band kar diye.");
  }
  const id = a.toUpperCase();
  const idx = list.findIndex(function (r) { return String(r.id).toUpperCase() === id; });
  if (idx < 0) return send(env, chat, "Reminder #" + esc(a) + " nahi mila. <code>/reminds</code> dekhein.");
  const removed = list[idx];
  if (env.WATCH_INDEX_DO) {
    try { await remindDoCall(env, "remind-remove", { id: removed.id }); } catch (e) { /* ignore */ }
  } else {
    list.splice(idx, 1);
    await writeReminds(env, list);
  }
  return send(env, chat, "✅ Reminder #" + esc(removed.id) + " band: " + esc(removed.text.slice(0, 120)));
}

/* ------------------------------------------------------------------ */
/* webhook + scheduler                                                 */
/* ------------------------------------------------------------------ */

async function handleUpdate(env, upd) {
  const msg = (upd && (upd.message || upd.edited_message)) || null;
  if (!msg) return;
  const chat = msg.chat && msg.chat.id;
  if (!chat) return;
  const text = String(msg.text || "").trim();
  if (!text) return;

  const parsed = parseCmd(text);
  const cmd = parsed.cmd;

  if (cmd === "/start" || cmd === "start") {
    const owner = await teamChat(env);
    if (!owner) {
      await env.KV.put("owner", String(chat));
      await send(env, chat, "👋 <b>AB Travels price bot ready.</b>\n\nYe bot sirf aap ka hai — aap ka chat lock ho gaya hai.\nTeam member add karne ke liye: <code>/share ID</code>.\n\n" + HELP);
    } else if (await isAllowed(env, chat)) {
      await send(env, chat, "👋 Welcome back.\n\n" + HELP);
    } else {
      await send(env, chat, "🔒 This bot is private.\n\nApna chat ID: <code>" + esc(chat) + "</code>\nOwner se kahein: <code>/share " + esc(chat) + "</code>");
    }
    return;
  }
  if (cmd === "/help" || cmd === "help" || cmd === "/commands") return send(env, chat, HELP);
  if (cmd === "/id") return send(env, chat, "Chat ID: <code>" + esc(chat) + "</code>");

  const args = parsed.args.slice();

  // Team commands answer everyone (owner-only actions are enforced inside),
  // so a new member can always see who has access.
  if (cmd === "/share" || cmd === "/team" || cmd === "/access") return cmdShare(env, chat, args);
  if (cmd === "/unshare") return cmdUnshare(env, chat, args[0]);

  const owner = await teamChat(env);
  if (!owner) return send(env, chat, "Pehle <code>/start</code> bhejein — bot aap ke naam lock ho jayega.");
  if (!(await isAllowed(env, chat))) {
    return send(env, chat, "🔒 This bot is private.\n\nApna chat ID: <code>" + esc(chat) + "</code>\nOwner se kahein: <code>/share " + esc(chat) + "</code>");
  }

  if (cmd === "/price" || cmd === "/fare" || cmd === "/fares") return cmdPrice(env, chat, args, parsed.opts);
  if (cmd === "/watch" || cmd === "/track") return cmdWatch(env, chat, args, parsed.opts);
  if (cmd === "/list" || cmd === "/watches") return cmdList(env, chat);
  if (cmd === "/stop" || cmd === "/delete") return cmdStop(env, chat, args[0]);
  if (cmd === "/urgent") return cmdUrgent(env, chat, args);
  if (cmd === "/interval") return cmdInterval(env, chat, args);
  if (cmd === "/pause") return cmdPause(env, chat, args[0], true);
  if (cmd === "/resume") return cmdPause(env, chat, args[0], false);
  if (cmd === "/book" || cmd === "/booking") return cmdBook(env, chat, args[0]);
  if (cmd === "/budget" || cmd === "/usage") return cmdBudget(env, chat, args[0]);
  if (cmd === "/quiet" || cmd === "/night") return cmdQuiet(env, chat, args);
  if (cmd === "/remind" || cmd === "/reminder") return cmdRemind(env, chat, args, parsed.opts);
  if (cmd === "/reminds" || cmd === "/reminders") return cmdReminds(env, chat);
  if (cmd === "/unremind" || cmd === "/unreminder") return cmdUnremind(env, chat, args && args[0]);

  // Anything that is not a command is treated as a normal message:
  // "DXB to KHI 15 December", "KHI UET 15-12-2026 har ghantay", "kal raat 10 baje tak" ...
  if (!cmd.startsWith("/")) {
    // keep the old shorthand "KHI DXB 01-12-2026" working
    if (args.length + 1 >= 2 && readRoute([cmd.toUpperCase()].concat(args), parsed.opts).origin) {
      return cmdPrice(env, chat, [cmd.toUpperCase()].concat(args), parsed.opts);
    }
    return handleNatural(env, chat, text);
  }
  await send(env, chat, "Samajh nahi aaya.\n\n" + HELP);
}

function routeText(w) {
  return esc(w.origin) + " → " + esc(w.destination) + " · " + esc(prettyDate(w.departure)) +
    (w.ret ? " ↔ " + esc(prettyDate(w.ret)) : "");
}

/* First line is the phone-notification preview: route + current price, so the
   full message does not need to be opened. Keep it plain text (no tags). */
function headline(w, p) {
  return routeText(w) + " · " + money(p.amount, p.currency);
}

function alertText(w, best, old, ind) {
  const p = best.price || {};
  let s = "<b>" + esc(headline(w, p)) + "</b>\n";
  s += "🚨 <b>Price alert</b> — watch #" + w.id;
  if (old != null && Number(old) > 0 && Number(p.amount) < Number(old)) {
    const pct = ((Number(old) - Number(p.amount)) / Number(old)) * 100;
    s += "  <i>(pehle " + esc(money(old, p.currency)) + ", −" + pct.toFixed(1) + "%)</i>";
  }
  if (w.target) s += "  <i>(target " + esc(money(w.target, p.currency)) + ")</i>";
  s += "\n";
  if (ind && Number(ind.price.amount) < Number(p.amount)) {
    s += "\n💡 Sab se sasta (indicative/unverified): " + esc(money(ind.price.amount, ind.price.currency)) + " — booking se pehle confirm karein";
  }
  s += "\n" + legLine(best.outbound, "Out");
  if (best.inbound) s += "\n" + legLine(best.inbound, "Ret");
  s += "\n\n🕒 " + pktNowText() + " · source: Ignav · status: verified";
  s += "\n<code>/book " + w.id + "</code> · <code>/stop " + w.id + "</code>";
  return s;
}

function updateText(w, best, old, ind) {
  const p = best.price || {};
  let s = "<b>" + esc(headline(w, p)) + "</b>\n";
  s += "⏱ <b>Price update</b> — watch #" + w.id;
  if (old != null && Number(old) > 0) {
    const diff = Number(p.amount) - Number(old);
    const pct = Math.abs((diff / Number(old)) * 100);
    s += "  <i>pehle " + esc(money(old, p.currency));
    if (Math.abs(diff) >= 1) s += " (" + (diff < 0 ? "▼ " : "▲ ") + pct.toFixed(1) + "%)";
    else s += " (no change)";
    s += "</i>";
  }
  if (w.target) s += "  <i>(target " + esc(money(w.target, p.currency)) + ")</i>";
  s += "\n";
  if (ind && Number(ind.price.amount) < Number(p.amount)) {
    s += "\n💡 Sab se sasta (indicative/unverified): " + esc(money(ind.price.amount, ind.price.currency)) + " — booking se pehle confirm karein";
  }
  s += "\n" + legLine(best.outbound, "Out");
  if (best.inbound) s += "\n" + legLine(best.inbound, "Ret");
  s += "\n\n🕒 " + pktNowText() + " · source: Ignav · every " + (w.every || DEFAULT_EVERY) + " min";
  s += "\n<code>/list</code> · <code>/pause " + w.id + "</code> · <code>/stop " + w.id + "</code>";
  return s;
}

async function checkAll(env) {
  if (!env.KV) return;
  const quiet = await getQuiet(env);
  const nowMin = pktMinutes();
  const keys = await watchKeys(env);
  const now = Date.now();
  for (const key of keys) {
    const raw = await env.KV.get(key);
    if (!raw) continue; // KV propagation can lag behind the strongly consistent index.
    let w = null;
    try { w = JSON.parse(raw); } catch (e) { continue; }
    if (!w || !w.chat) continue;
    if (inQuiet(quiet, nowMin)) continue;

    const ttl = { expirationTtl: WATCH_TTL };

    if (w.until && now >= w.until) {
      await env.KV.delete(key);
      await removeWatchKey(env, key);
      try { await notifyAll(env, '⏱ Watch #' + esc(w.id) + ' ka waqt poora; tracking band.'); } catch (e) { /* ignore */ }
      continue;
    }

    // urgent mode expired?
    if (w.urgentUntil && now > w.urgentUntil) {
      w.every = w.baseEvery || DEFAULT_EVERY;
      w.urgentUntil = 0;
      await env.KV.put(key, JSON.stringify(w), ttl);
      await notifyAll(env, "⏱ Urgent mode khatam — watch #" + w.id + " ab har " + w.every + " min. /urgent " + w.id + " 60 se dobara on.");
      continue;
    }

    const every = Math.max(1, Number(w.every) || DEFAULT_EVERY);
    if (w.paused) continue;
    if (w.lastCheckAt && now - w.lastCheckAt < every * 60000 - 20000) continue;

    let j = null;
    try {
      const t = await takeBudget(env);
      if (!t.ok) continue; // budget exhausted: silently wait for tomorrow
      j = await ignavCall(env, w.ret ? "/fares/round-trip" : "/fares/one-way", routePayload(w));
    } catch (e) {
      // tell the owner at most once an hour, never crash the cron
      if (e && e.code !== "BUDGET" && now - (w.lastErrorAt || 0) > 3600000) {
        w.lastErrorAt = now;
        await env.KV.put(key, JSON.stringify(w), ttl);
        try { await notifyAll(env, "⚠️ Watch #" + w.id + " check fail: " + esc(e.message)); } catch (e2) { /* ignore */ }
      }
      continue;
    }

    const best = bestFare(j, w.flight);
    const ind = cheapestFare(j, w.flight);
    w.lastCheckAt = now;
    if (!best) {
      await env.KV.put(key, JSON.stringify(w), ttl);
      continue;
    }

    const amount = Number(best.price.amount);
    const cur = best.price.currency || w.lastCurrency || "PKR";
    const old = w.lastAmount == null ? null : Number(w.lastAmount);
    w.lastAmount = amount;
    w.lastCurrency = cur;
    w.lastBestId = best.ignav_id || w.lastBestId || "";

    const target = Number(w.target) || 0;
    const firstBelow = target > 0 && amount <= target && !(w.lastAlertAmount != null && Number(w.lastAlertAmount) <= target);
    const dropped = old != null && amount < old && amount <= old * (1 - DROP_PCT);
    const cooldownOk = now - (w.lastAlertAt || 0) > 10 * 60000;
    const alertNow = (firstBelow || dropped) && cooldownOk;

    await env.KV.put(key, JSON.stringify(w), ttl);

    if (alertNow) {
      w.lastAlertAt = now;
      w.lastAlertAmount = amount;
      await env.KV.put(key, JSON.stringify(w), ttl);
      try { await notifyAll(env, alertText(w, best, old, ind)); } catch (e) { /* ignore */ }
    } else if (every >= PERIODIC_MIN_EVERY && !w.urgentUntil) {
      // The request has already been spent — send the price it saw.
      try { await notifyAll(env, updateText(w, best, old, ind)); } catch (e) { /* ignore */ }
    }
  }
}

/* ------------------------------------------------------------------ */
/* HTTP entry points                                                   */
/* ------------------------------------------------------------------ */

async function proxyIgnav(request, env, path, hdrs) {
  if (request.method !== "POST") return jres({ error: { message: "POST only" } }, 405, hdrs);
  const allow = String(env.ALLOWED_ORIGIN || "").trim().replace(/\/+$/, "");
  if (allow && allow !== "*") {
    const origin = String(request.headers.get("Origin") || "").replace(/\/+$/, "");
    const referer = String(request.headers.get("Referer") || "");
    if (origin !== allow && referer.indexOf(allow + "/") !== 0) {
      return jres({ error: { code: "origin", message: "This worker only serves " + allow } }, 403, hdrs);
    }
  }
  if (!env.IGNAV_API_KEY) {
    return jres({ error: { code: "no_key", message: "IGNAV_API_KEY secret is not set in the Worker." } }, 500, hdrs);
  }
  const t = await takeProxyBudget(env);
  if (!t.ok) {
    return jres({ error: { code: "budget", message: "Aaj ki proxy limit (" + t.cap + ") khatam. Kal try karein ya MAX_DAILY_PROXY barhayein." } }, 429, hdrs);
  }
  const body = await request.text();
  const r = await fetch(IGNAV_API + path, {
    method: "POST",
    headers: { "X-Api-Key": env.IGNAV_API_KEY, "Content-Type": "application/json" },
    body: body
  });
  const txt = await r.text();
  return new Response(txt, {
    status: r.status,
    headers: Object.assign({ "Content-Type": "application/json" }, hdrs)
  });
}

/* ------------------------------------------------------------------ */
/* app -> Telegram notification relay                                  */
/*   The hisab app cannot reach api.telegram.org on some networks      */
/*   (ISP blocks it), so it POSTs here and the Worker forwards it.     */
/*   Body: { title, text, chats? }   Origin must be the app.           */
/* ------------------------------------------------------------------ */

const NOTIFY_RATE = 120; // max notifications per hour

function notifyOriginOk(env, request) {
  const origin = String(request.headers.get("Origin") || "").replace(/\/+$/, "");
  if (!origin) return false;
  const allow = String((env && env.ALLOWED_ORIGIN) || "").trim().replace(/\/+$/, "");
  if (allow && allow !== "*" && origin === allow) return true;
  return /^https:\/\/(?:ali122|abtravels)\.github\.io$/i.test(origin) ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

async function notifyRelay(request, env, hdrs) {
  if (request.method !== "POST") return jres({ ok: false, error: "POST only" }, 405, hdrs);
  const internal = !!env.NOTIFY_KEY && request.headers.get("X-Notify-Key") === env.NOTIFY_KEY;
  if (!internal && !notifyOriginOk(env, request)) return jres({ ok: false, error: "origin" }, 403, hdrs);
  if (!env.TELEGRAM_BOT_TOKEN) return jres({ ok: false, error: "no_token" }, 500, hdrs);

  let body = {};
  try { body = (await request.json()) || {}; } catch (e) { body = {}; }
  const title = String(body.title || "AB Travels").slice(0, 90);
  const text = String(body.text || "").slice(0, 3500);
  if (!text.trim()) return jres({ ok: false, error: "empty" }, 400, hdrs);

  let chats = Array.isArray(body.chats) ? body.chats : String(body.chats || "").split(/[,;\s]+/);
  chats = chats
    .map(function (c) { return String(c == null ? "" : c).replace(/[^0-9-]/g, ""); })
    .filter(function (c) { return /^-?\d{4,20}$/.test(c); })
    .slice(0, 10);
  if (!chats.length) chats = await allowedChats(env);
  const allowed = await allowedChats(env);
  chats = [...new Set(chats)].filter(c => allowed.includes(c));
  if (!chats.length) return jres({ ok: false, error: "no_chats" }, 400, hdrs);

  // soft hourly cap so a stuck page cannot spam the team
  try {
    const key = "notify:" + new Date().toISOString().slice(0, 13);
    const used = Number((await env.KV.get(key)) || 0);
    if (used >= NOTIFY_RATE) return jres({ ok: false, error: "rate" }, 429, hdrs);
    await env.KV.put(key, String(used + 1), { expirationTtl: 7200 });
  } catch (e) { /* KV down: still send */ }

  const html = title + "\n" + text;
  const extra = {
    parse_mode: undefined,
    reply_markup: { inline_keyboard: [[{ text: "📱 Open app", url: "https://abtravels.github.io/travel-office-hisab/" }]] }
  };
  const sent = [], failed = [], errors = [];
  await Promise.all(chats.map(async c => {
    try { await send(env, c, html, extra); sent.push(c); } catch (e) { failed.push(c); errors.push(String(e.message || 'Telegram send failed').slice(0,300)); }
  }));
  return jres({ ok: sent.length > 0 && failed.length === 0, sent: sent, failed: failed, errors: errors }, failed.length ? 502 : 200, hdrs);
}

function page(title, body) {
  return new Response(
    "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>" + title + "</title><style>body{font-family:system-ui,Segoe UI,Arial;max-width:720px;margin:40px auto;padding:0 16px;line-height:1.55}" +
    "code{background:#f2f2f2;padding:2px 5px;border-radius:4px}li{margin:6px 0}.ok{color:#0a7a32;font-weight:700}.bad{color:#b00020;font-weight:700}" +
    "h1{font-size:22px}</style></head><body>" + body + "</body></html>",
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

async function setupPage(env, url) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return page("Setup", "<h1>❌ Telegram token missing</h1><p>Worker → Settings → Variables and Secrets mein <code>TELEGRAM_BOT_TOKEN</code> add karein (secret), phir ye page dobara kholein.</p>");
  }
  const hook = url.origin + "/telegram";
  const body = { url: hook, allowed_updates: ["message", "callback_query"], drop_pending_updates: false };
  if (env.TELEGRAM_WEBHOOK_SECRET) body.secret_token = env.TELEGRAM_WEBHOOK_SECRET;
  try {
    await tg(env, "setWebhook", body);
    let info = null;
    try { info = await Promise.race([tg(env, "getWebhookInfo", {}), new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 9000))]); } catch (e) { /* ignore */ }
    return page("Setup OK", "<h1>✅ Bot connected</h1><p>Webhook: <code>" + esc(hook) + "</code></p>" +
      "<p>Pending updates: " + esc(info && info.pending_update_count != null ? info.pending_update_count : "?") + "</p>" +
      "<p>Ab Telegram mein apna bot kholein aur <code>/start</code> bhejein.</p>" +
      "<p><a href=\"/\">Worker status</a></p>");
  } catch (e) {
    return page("Setup failed", "<h1>❌ Webhook set nahi hua</h1><p>" + esc(e.message) + "</p>");
  }
}

/* Telegram Cloudflare se 10-25s le leta hai - status page har baar wait na kare,
   is liye webhook info KV mein cache hoti hai (cron har 10 min refresh karta hai). */
const WEBHOOK_CACHE_KEY = "webhook_info";
const WEBHOOK_CACHE_TTL = 15 * 60 * 1000;

async function cachedWebhookInfo(env, allowFetch) {
  let cached = null;
  try {
    const raw = env.KV ? await env.KV.get(WEBHOOK_CACHE_KEY) : null;
    if (raw) {
      const c = JSON.parse(raw);
      if (c && c.info && c.at && (Date.now() - c.at) < WEBHOOK_CACHE_TTL) cached = c.info;
    }
  } catch (e) { /* ignore */ }
  if (cached) return cached;
  if (!allowFetch) return null;
  try {
    const info = await Promise.race([
      tg(env, "getWebhookInfo", {}),
      new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 12000))
    ]);
    try {
      if (env.KV) await env.KV.put(WEBHOOK_CACHE_KEY, JSON.stringify({ info: info, at: Date.now() }), { expirationTtl: 7200 });
    } catch (e2) { /* ignore */ }
    return info;
  } catch (e) {
    return null;
  }
}

async function statusPage(env) {
  const rows = [];
  rows.push("<li>Ignav key: " + (env.IGNAV_API_KEY ? "<span class=\"ok\">set</span>" : "<span class=\"bad\">missing</span>") + "</li>");
  rows.push("<li>Telegram token: " + (env.TELEGRAM_BOT_TOKEN ? "<span class=\"ok\">set</span>" : "<span class=\"bad\">missing</span>") + "</li>");
  rows.push("<li>KV binding (KV): " + (env.KV ? "<span class=\"ok\">ok</span>" : "<span class=\"bad\">missing</span>") + "</li>");
  let quiet = null;
  try { quiet = await getQuiet(env); } catch (e) { quiet = null; }
  rows.push("<li>Quiet hours: " + (quiet && quiet.enabled ? "<span class=\"ok\">on</span> " + esc(quiet.start + "–" + quiet.end + " PKT") : "<span class=\"bad\">off</span>") + "</li>");
  let used = "?", owner = "?", team = [];
  if (env.KV) {
    try { used = Number((await env.KV.get(budgetKey())) || 0); } catch (e) { used = "?"; }
    try { owner = (await env.KV.get("owner")) || "(none — send /start)"; } catch (e) { owner = "?"; }
    try { team = await allowedChats(env); } catch (e) { team = []; }
  }
  let info = "";
  if (env.TELEGRAM_BOT_TOKEN) {
    const w = await cachedWebhookInfo(env, true);
    if (w) {
      info = "<li>Webhook: " + (w.url ? "<span class=\"ok\">connected</span> <code>" + esc(w.url) + "</code>" : "<span class=\"bad\">not set</span> - <a href=\"/setup\">open /setup</a>") +
        (w.last_error_message ? "<br><small>last error: " + esc(w.last_error_message) + "</small>" : "") + "</li>";
    } else {
      info = "<li>Webhook: <span style=\"color:var(--gold)\">check slow</span> <small>(Telegram jawab nahi de raha - bot par message bhej kar test karein)</small></li>";
    }
  }
  return page("AB Travels worker", "<h1>✈️ AB Travels worker <small>v2.56</small></h1><ul>" + rows.join("") + info +
    "<li>Today's searches: <b>" + esc(used) + "</b> / " + budgetCap(env) + "</li>" +
    "<li>Owner chat: <code>" + esc(owner) + "</code></li>" +
    "<li>Team alerts: " + (team.length ? team.map(function (c) { return "<code>" + esc(c) + "</code>"; }).join(", ") : "<i>sirf owner</i>") + "</li></ul>" +
    "<p>" + (env.TELEGRAM_BOT_TOKEN ? (info.indexOf("not set") >= 0 ? "<a href=\"/setup\">Connect the bot</a>" : "Bot connected.") : "") + "</p>" +
    "<p><small>App proxy: <code>/health</code> <code>/fares</code> <code>/round-trip</code> <code>/booking-links</code> <code>/notify</code></small></p>");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const hdrs = cors(env);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: hdrs });

    if (path === "/") return statusPage(env);
    if (path === "/setup") return setupPage(env, url);

    if (path === "/health") {
      if (!env.IGNAV_API_KEY) return jres({ error: { code: "no_key", message: "IGNAV_API_KEY secret is not set in the Worker." } }, 500, hdrs);
      const r = await fetch(IGNAV_API + "/health", { headers: { "X-Api-Key": env.IGNAV_API_KEY } });
      const txt = await r.text();
      return new Response(txt, { status: r.status, headers: Object.assign({ "Content-Type": "application/json" }, hdrs) });
    }
    if (path === "/fares") return proxyIgnav(request, env, "/fares/one-way", hdrs);
    if (path === "/round-trip") return proxyIgnav(request, env, "/fares/round-trip", hdrs);
    if (path === "/search") return proxyIgnav(request, env, "/fares/search", hdrs);
    if (path === "/booking-links") return proxyIgnav(request, env, "/fares/booking-links", hdrs);
    if (path === "/notify") return notifyRelay(request, env, hdrs);

    if (path === "/telegram") {
      if (request.method !== "POST") return new Response("ok");
      if (env.TELEGRAM_WEBHOOK_SECRET) {
        const got = request.headers.get("x-telegram-bot-api-secret-token");
        if (got !== env.TELEGRAM_WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
      }
      let upd = null;
      try { upd = await request.json(); } catch (e) { return new Response("ok"); }
      if (!env.TELEGRAM_BOT_TOKEN || !env.KV) {
        return new Response("ok"); // misconfigured, but never make Telegram retry forever
      }
      if (upd && upd.callback_query) {
        const cb = handleCallback(env, upd.callback_query).catch(function (e) {
          try { console.error("callback failed:", e && (e.stack || e.message) || e); } catch (e2) { /* ignore */ }
        });
        if (ctx && ctx.waitUntil) ctx.waitUntil(cb);
        return new Response("ok");
      }
      const job = handleUpdate(env, upd).catch(function (e) {
        try {
          const m = upd && (upd.message || upd.edited_message);
          const chat = m && m.chat && m.chat.id;
          if (chat) return send(env, chat, "⚠️ Error: " + esc((e && e.message) || e));
        } catch (e2) { /* ignore */ }
      });
      if (ctx && ctx.waitUntil) ctx.waitUntil(job);
      return new Response("ok");
    }

    return jres({ error: { message: "not found" } }, 404, hdrs);
  },

  async scheduled(controller, env, ctx) {
    const job = Promise.all([
      checkAll(env).catch(function () { /* never crash the cron */ }),
      checkReminders(env).catch(function () { /* reminders must not crash the cron */ }),
      // webhook info cache refresh (Telegram se seedha, background mein)
      (async function () {
        try {
          const raw = env.KV ? await env.KV.get(WEBHOOK_CACHE_KEY) : null;
          const c = raw ? JSON.parse(raw) : null;
          if (!c || !c.at || (Date.now() - c.at) > 10 * 60 * 1000) await cachedWebhookInfo(env, true);
        } catch (e) { /* ignore */ }
      })()
    ]);
    if (ctx && ctx.waitUntil) ctx.waitUntil(job);
  }
};
