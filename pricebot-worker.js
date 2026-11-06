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
const MAX_DAILY = 60;     // fare searches per day, protects the free allowance
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

function bestFare(j) {
  const list = (j && j.itineraries) || [];
  let best = null;
  for (const it of list) {
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
  "<b>Price poochhein</b>\n" +
  "<code>/price KHI DXB 01-12-2026</code>\n" +
  "<code>/price KHI DXB 01-12-2026 15-12-2026</code> round trip\n" +
  "Options: <code>adults=2 cabin=business market=AE nonstop</code>\n\n" +
  "<b>Tracking (khud check karta rahega)</b>\n" +
  "<code>/watch KHI DXB 01-12-2026</code>\n" +
  "<code>/watch KHI DXB 01-12-2026 target=85000 every=10</code>\n" +
  "<code>/list</code> · <code>/stop 1</code> · <code>/stop all</code>\n\n" +
  "<b>Urgent (har minute)</b>\n" +
  "<code>/urgent 1 60</code> — watch #1 har minute, 60 minute tak\n\n" +
  "<b>Book link</b> <code>/book 1</code> · <b>Budget</b> <code>/budget</code>";

async function cmdPrice(env, chat, args, opts) {
  const r = readRoute(args, opts);
  if (r.error) return send(env, chat, esc(r.error));
  const t = await takeBudget(env);
  if (!t.ok) {
    return send(env, chat, "📊 Aaj ka search budget (" + t.cap + ") khatam — " + t.used + " searches ho chuke.\nKal dobara try karein, ya Worker mein <code>MAX_DAILY_REQUESTS</code> barha dein.");
  }
  await send(env, chat, "🔎 Search ho rahi hai: " + routeTitle(r) + " …");
  const j = await ignavCall(env, r.ret ? "/fares/round-trip" : "/fares/one-way", routePayload(r));
  const list = (j.itineraries || []).filter(function (it) {
    const p = it && it.price;
    return p && (!p.status || p.status === "verified") && Number(p.amount) > 0;
  }).sort(function (a, b) { return Number(a.price.amount) - Number(b.price.amount); });
  if (!list.length) return send(env, chat, "Koi verified fare nahi mila. Date ya route badal kar dekhein.");
  let msg = routeTitle(r) + "\n\n";
  msg += list.slice(0, 5).map(offerBlock).join("\n\n");
  msg += "\n\n<i>Prices indicative — booking se pehle confirm karein.</i>\n" +
    "Track karne ke liye: <code>/watch " + r.origin + " " + r.destination + " " + r.departure +
    (r.ret ? " " + r.ret : "") + "</code>\n" +
    "Book links: <code>/watch</code> phir <code>/book ID</code>";
  await send(env, chat, msg);
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

async function cmdWatch(env, chat, args, opts) {
  const r = readRoute(args, opts);
  if (r.error) return send(env, chat, esc(r.error));
  const have = await watches(env, chat);
  if (have.length >= MAX_WATCHES) {
    return send(env, chat, "Max " + MAX_WATCHES + " watches. Pehle <code>/stop ID</code> karein.");
  }
  const id = String(Math.floor(100 + Math.random() * 900));
  const everyRaw = Number(opts.every || DEFAULT_EVERY);
  const every = Math.min(1440, Math.max(1, Math.floor(isFinite(everyRaw) ? everyRaw : DEFAULT_EVERY)));
  const target = opts.target ? Number(String(opts.target).replace(/[^0-9.]/g, "")) : 0;
  const w = {
    id: id, chat: String(chat), origin: r.origin, destination: r.destination,
    departure: r.departure, ret: r.ret, adults: r.adults, cabin: r.cabin,
    market: r.market, nonstop: r.nonstop, every: every, baseEvery: every,
    target: isFinite(target) && target > 0 ? target : 0,
    createdAt: Date.now(), lastCheckAt: 0, lastAmount: null, lastAlertAt: 0, lastAlertAmount: null
  };
  await env.KV.put("w:" + chat + ":" + id, JSON.stringify(w), { expirationTtl: WATCH_TTL });

  let nowTxt = "";
  try {
    const t = await takeBudget(env);
    if (!t.ok) throw new Error("Aaj ka budget (" + t.cap + ") khatam — abhi live price nahi de sakta.");
    const best = bestFare(await ignavCall(env, w.ret ? "/fares/round-trip" : "/fares/one-way", routePayload(w)));
    if (best) {
      w.lastAmount = Number(best.price.amount);
      w.lastCurrency = best.price.currency || "PKR";
      w.lastBestId = best.ignav_id || "";
      w.lastCheckAt = Date.now();
      await env.KV.put("w:" + chat + ":" + id, JSON.stringify(w), { expirationTtl: WATCH_TTL });
      nowTxt = "\n\nAbhi sab se sasta: <b>" + esc(money(w.lastAmount, w.lastCurrency)) + "</b>" +
        (best.outbound && best.outbound.segments && best.outbound.segments[0]
          ? " — " + esc(String(best.outbound.segments[0].marketing_carrier_code || "") + " " + String(best.outbound.segments[0].flight_number || ""))
          : "");
    }
  } catch (e) {
    nowTxt = "\n\n<i>Abhi price check nahi hua: " + esc(e.message) + "</i>";
  }

  await send(env, chat,
    "✅ <b>Watch #" + id + " on</b>\n" + routeTitle(w) +
    "\nHar <b>" + every + " min</b> check" +
    (w.target ? "\nTarget: <b>" + esc(money(w.target, w.lastCurrency || "PKR")) + "</b> ya kam" : "\nAlert jab price gir jaye (5%+)") +
    nowTxt +
    "\n\nUrgent (har minute): <code>/urgent " + id + " 60</code>\nBand karna: <code>/stop " + id + "</code>");
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
      (w.target ? " · target " + esc(money(w.target, w.lastCurrency || "PKR")) : "") +
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
  if (cmd === "/book" || cmd === "/booking") return cmdBook(env, chat, args[0]);
  if (cmd === "/budget" || cmd === "/usage") return cmdBudget(env, chat, args[0]);

  // bare "KHI DXB 01-12-2026" also searches
  if (!cmd.startsWith("/") && args.length + 1 >= 2) {
    return cmdPrice(env, chat, [cmd.toUpperCase()].concat(args), parsed.opts);
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
  s += "\n\n<code>/book " + w.id + "</code> · <code>/stop " + w.id + "</code>";
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

    // urgent mode expired?
    if (w.urgentUntil && now > w.urgentUntil) {
      w.every = w.baseEvery || DEFAULT_EVERY;
      w.urgentUntil = 0;
      await env.KV.put(k.name, JSON.stringify(w), ttl);
      await send(env, w.chat, "⏱ Urgent mode khatam — watch #" + w.id + " ab har " + w.every + " min. /urgent " + w.id + " 60 se dobara on.");
      continue;
    }

    const every = Math.max(1, Number(w.every) || DEFAULT_EVERY);
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

    const best = bestFare(j);
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
  if (!env.IGNAV_API_KEY) {
    return jres({ error: { code: "no_key", message: "IGNAV_API_KEY secret is not set in the Worker." } }, 500, hdrs);
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
  const body = { url: hook, allowed_updates: ["message"], drop_pending_updates: false };
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
