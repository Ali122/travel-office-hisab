/**
 * AB Travels — one Cloudflare Worker, two jobs:
 *
 *   1) Ignav proxy for the hisab app  (/health, /fares, /round-trip, /booking-links)
 *      The Ignav API key stays here on the server, never in the browser.
 *
 *   2) Telegram flight-price bot      (/telegram, plus a 1-minute cron)
 *      /price KHI DXB 01-12-2026        -> cheapest fares right now
 *      /watch KHI DXB 01-12-2026        -> check automatically, alert on price drop
 *      /urgent <id> 60                  -> check every minute for 60 minutes
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
 */

const IGNAV_API = "https://ignav.com/api";
const TG_API = "https://api.telegram.org/bot";
const DEFAULT_EVERY = 15; // minutes
const MAX_DAILY = 60;     // fare searches per day for the bot, protects the free allowance
const MAX_DAILY_PROXY = 200; // fare searches per day for the browser app (best effort)
const DROP_PCT = 0.05;    // alert when the price falls at least 5%
const MAX_WATCHES = 5;
const WATCH_TTL = 60 * 60 * 24 * 120;

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
  const r = await fetch(TG_API + env.TELEGRAM_BOT_TOKEN + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });
  let j = null;
  try { j = await r.json(); } catch (e) { /* ignore */ }
  if (!j || j.ok !== true) {
    throw new Error("Telegram " + method + " failed: " + ((j && j.description) || r.status));
  }
  return j.result;
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
  "<b>Book link</b> <code>/book 1</code> · <b>Budget</b> <code>/budget</code>";

async function doPrice(env, chat, r, extra, flight) {
  const want = String(flight || "").toUpperCase().replace(/\s/g, "");
  const t = await takeBudget(env);
  if (!t.ok) {
    return send(env, chat, "📊 Aaj ka search budget (" + t.cap + ") khatam — " + t.used + " searches ho chuke.\nKal dobara try karein, ya Worker mein <code>MAX_DAILY_REQUESTS</code> barha dein.");
  }
  await send(env, chat, "🔎 Search ho rahi hai: " + routeTitle(r) + (want ? " · " + esc(want) : "") + " …");
  const j = await ignavCall(env, r.ret ? "/fares/round-trip" : "/fares/one-way", routePayload(r));
  const list = (j.itineraries || []).filter(function (it) {
    const p = it && it.price;
    if (!p || (p.status && p.status !== "verified") || !(Number(p.amount) > 0)) return false;
    if (want && !legHasFlight(it.outbound, want)) return false;
    return true;
  }).sort(function (a, b) { return Number(a.price.amount) - Number(b.price.amount); });
  if (!list.length) {
    return send(env, chat, want
      ? "Flight <b>" + esc(want) + "</b> ka verified fare nahi mila. Flight number ya date check karein."
      : "Koi verified fare nahi mila. Date ya route badal kar dekhein.");
  }
  let msg = routeTitle(r) + (want ? " · " + esc(want) : "") + "\n\n";
  msg += list.slice(0, 5).map(offerBlock).join("\n\n");
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
  const everyRaw = Number((o && o.every) || DEFAULT_EVERY);
  const every = Math.min(1440, Math.max(1, Math.floor(isFinite(everyRaw) ? everyRaw : DEFAULT_EVERY)));
  const target = Number((o && o.target) || 0);
  const id = String(Math.floor(100 + Math.random() * 900));
  const w = {
    id: id, chat: String(chat), origin: r.origin, destination: r.destination,
    departure: r.departure, ret: r.ret, adults: r.adults, cabin: r.cabin,
    market: r.market, nonstop: r.nonstop, every: every, baseEvery: every,
    flight: flight, until: until, paused: false,
    target: isFinite(target) && target > 0 ? target : 0,
    createdAt: Date.now(), lastCheckAt: 0, lastAmount: null, lastAlertAt: 0, lastAlertAmount: null
  };
  await env.KV.put("w:" + chat + ":" + id, JSON.stringify(w), { expirationTtl: WATCH_TTL });

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
      await env.KV.put("w:" + chat + ":" + id, JSON.stringify(w), { expirationTtl: WATCH_TTL });
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


async function watches(env, chat) {
  const out = [];
  const list = await env.KV.list({ prefix: "w:" + chat + ":" });
  for (const k of list.keys) {
    const raw = await env.KV.get(k.name);
    if (!raw) continue;
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
  if (!arg) return send(env, chat, "ID dein: <code>/stop 1</code> ya <code>/stop all</code>.");
  if (/^all$/i.test(arg)) {
    for (const w of ws) await env.KV.delete("w:" + chat + ":" + w.id);
    return send(env, chat, "🗑 " + ws.length + " watch band kar diye.");
  }
  const id = String(arg).replace(/[^0-9]/g, "");
  if (!ws.some(function (w) { return String(w.id) === id; })) {
    return send(env, chat, "Watch #" + esc(arg) + " nahi mila. <code>/list</code> dekhein.");
  }
  await env.KV.delete("w:" + chat + ":" + id);
  await send(env, chat, "🗑 Watch #" + id + " band.");
}

async function cmdPause(env, chat, arg, on) {
  const id = String(arg || "").replace(/[^0-9]/g, "");
  if (!id) return send(env, chat, "Misaal: <code>/pause 123</code> ya <code>/resume 123</code>");
  const key = "w:" + chat + ":" + id;
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
  const owner = await env.KV.get("owner");
  if (!owner || String(owner) !== String(chat)) {
    try { await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: "Private bot", show_alert: true }); } catch (e) { /* ignore */ }
    return;
  }
  try { await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: "OK" }); } catch (e) { /* ignore */ }
  const parts = data.split(":");
  const kind = parts[0];

  if (kind === "iv") {
    const id = String(parts[1] || "").replace(/[^0-9]/g, "");
    const mins = Number(parts[2]);
    const key = "w:" + chat + ":" + id;
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
    await env.KV.delete("w:" + chat + ":" + id);
    return send(env, chat, "🗑 Watch #" + id + " band.");
  }

  if (kind === "ps") {
    const id = String(parts[1] || "").replace(/[^0-9]/g, "");
    const key = "w:" + chat + ":" + id;
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
  const key = "w:" + chat + ":" + id;
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
  const key = 'w:' + chat + ':' + id;
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
    const owner = await env.KV.get("owner");
    if (!owner) {
      await env.KV.put("owner", String(chat));
      await send(env, chat, "👋 <b>AB Travels price bot ready.</b>\n\nYe bot sirf aap ka hai — aap ka chat lock ho gaya hai.\n\n" + HELP);
    } else if (String(owner) === String(chat)) {
      await send(env, chat, "👋 Welcome back.\n\n" + HELP);
    } else {
      await send(env, chat, "🔒 This bot is private.");
    }
    return;
  }
  if (cmd === "/help" || cmd === "help" || cmd === "/commands") return send(env, chat, HELP);
  if (cmd === "/id") return send(env, chat, "Chat ID: <code>" + esc(chat) + "</code>");

  const owner = await env.KV.get("owner");
  if (!owner) return send(env, chat, "Pehle <code>/start</code> bhejein — bot aap ke naam lock ho jayega.");
  if (String(owner) !== String(chat)) return send(env, chat, "🔒 This bot is private.");

  const args = parsed.args.slice();

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

function alertText(w, best, old) {
  const p = best.price || {};
  let s = "🚨 <b>Price alert</b> — watch #" + w.id + "\n" + routeText(w) + "\n\n";
  s += "<b>" + esc(money(p.amount, p.currency)) + "</b>";
  if (old != null && Number(old) > 0 && Number(p.amount) < Number(old)) {
    const pct = ((Number(old) - Number(p.amount)) / Number(old)) * 100;
    s += "  <i>(pehle " + esc(money(old, p.currency)) + ", −" + pct.toFixed(1) + "%)</i>";
  }
  if (w.target) s += "  <i>(target " + esc(money(w.target, p.currency)) + ")</i>";
  s += "\n" + legLine(best.outbound, "Out");
  if (best.inbound) s += "\n" + legLine(best.inbound, "Ret");
  s += "\n\n🕒 " + pktNowText() + " · source: Ignav · status: verified";
  s += "\n<code>/book " + w.id + "</code> · <code>/stop " + w.id + "</code>";
  return s;
}

async function checkAll(env) {
  if (!env.KV) return;
  const list = await env.KV.list({ prefix: "w:", limit: 100 });
  const now = Date.now();
  for (const k of list.keys) {
    const raw = await env.KV.get(k.name);
    if (!raw) continue;
    let w = null;
    try { w = JSON.parse(raw); } catch (e) { continue; }
    if (!w || !w.chat) continue;

    const ttl = { expirationTtl: WATCH_TTL };

    if (w.until && now >= w.until) {
      await env.KV.delete(k.name);
      try { await send(env, w.chat, '⏱ Watch #' + esc(w.id) + ' ka waqt poora; tracking band.'); } catch (e) { /* ignore */ }
      continue;
    }

    // urgent mode expired?
    if (w.urgentUntil && now > w.urgentUntil) {
      w.every = w.baseEvery || DEFAULT_EVERY;
      w.urgentUntil = 0;
      await env.KV.put(k.name, JSON.stringify(w), ttl);
      await send(env, w.chat, "⏱ Urgent mode khatam — watch #" + w.id + " ab har " + w.every + " min. /urgent " + w.id + " 60 se dobara on.");
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
        await env.KV.put(k.name, JSON.stringify(w), ttl);
        try { await send(env, w.chat, "⚠️ Watch #" + w.id + " check fail: " + esc(e.message)); } catch (e2) { /* ignore */ }
      }
      continue;
    }

    const best = bestFare(j, w.flight);
    w.lastCheckAt = now;
    if (!best) {
      await env.KV.put(k.name, JSON.stringify(w), ttl);
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

    await env.KV.put(k.name, JSON.stringify(w), ttl);

    if ((firstBelow || dropped) && cooldownOk) {
      w.lastAlertAt = now;
      w.lastAlertAmount = amount;
      await env.KV.put(k.name, JSON.stringify(w), ttl);
      try { await send(env, w.chat, alertText(w, best, old)); } catch (e) { /* ignore */ }
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
    try { info = await tg(env, "getWebhookInfo", {}); } catch (e) { /* ignore */ }
    return page("Setup OK", "<h1>✅ Bot connected</h1><p>Webhook: <code>" + esc(hook) + "</code></p>" +
      "<p>Pending updates: " + esc(info && info.pending_update_count != null ? info.pending_update_count : "?") + "</p>" +
      "<p>Ab Telegram mein apna bot kholein aur <code>/start</code> bhejein.</p>" +
      "<p><a href=\"/\">Worker status</a></p>");
  } catch (e) {
    return page("Setup failed", "<h1>❌ Webhook set nahi hua</h1><p>" + esc(e.message) + "</p>");
  }
}

async function statusPage(env) {
  const rows = [];
  rows.push("<li>Ignav key: " + (env.IGNAV_API_KEY ? "<span class=\"ok\">set</span>" : "<span class=\"bad\">missing</span>") + "</li>");
  rows.push("<li>Telegram token: " + (env.TELEGRAM_BOT_TOKEN ? "<span class=\"ok\">set</span>" : "<span class=\"bad\">missing</span>") + "</li>");
  rows.push("<li>KV binding (KV): " + (env.KV ? "<span class=\"ok\">ok</span>" : "<span class=\"bad\">missing</span>") + "</li>");
  let used = "?", owner = "?";
  if (env.KV) {
    try { used = Number((await env.KV.get(budgetKey())) || 0); } catch (e) { used = "?"; }
    try { owner = (await env.KV.get("owner")) || "(none — send /start)"; } catch (e) { owner = "?"; }
  }
  let info = "";
  if (env.TELEGRAM_BOT_TOKEN) {
    try {
      const w = await tg(env, "getWebhookInfo", {});
      info = "<li>Webhook: " + (w.url ? "<span class=\"ok\">connected</span> <code>" + esc(w.url) + "</code>" : "<span class=\"bad\">not set</span> — <a href=\"/setup\">open /setup</a>") +
        (w.last_error_message ? "<br><small>last error: " + esc(w.last_error_message) + "</small>" : "") + "</li>";
    } catch (e) {
      info = "<li>Webhook: <span class=\"bad\">" + esc(e.message) + "</span></li>";
    }
  }
  return page("AB Travels worker", "<h1>✈️ AB Travels worker</h1><ul>" + rows.join("") + info +
    "<li>Today's searches: <b>" + esc(used) + "</b> / " + budgetCap(env) + "</li>" +
    "<li>Owner chat: <code>" + esc(owner) + "</code></li></ul>" +
    "<p>" + (env.TELEGRAM_BOT_TOKEN ? (info.indexOf("not set") >= 0 ? "<a href=\"/setup\">Connect the bot</a>" : "Bot connected.") : "") + "</p>" +
    "<p><small>App proxy: <code>/health</code> <code>/fares</code> <code>/round-trip</code> <code>/booking-links</code></small></p>");
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
    if (path === "/booking-links") return proxyIgnav(request, env, "/fares/booking-links", hdrs);

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
    const job = checkAll(env).catch(function () { /* never crash the cron */ });
    if (ctx && ctx.waitUntil) ctx.waitUntil(job);
  }
};
