# Telegram price bot — setup (free)

Aap ka apna Telegram bot: route bhejein, sasta fare wapas aata hai. Price girne par khud
alert karta hai, aur urgent ticket ke liye **har minute** check kar sakta hai.

**Current bot: v2.29** — default quiet hours **02:00–09:00 PKT** (`/quiet on|off`), aur
30+ minute watches par har check ke baad price update (request waste nahi hoti).

Sab kuch ek hi Cloudflare Worker par chalta hai (free plan). Wahi Worker app ka Ignav proxy
bhi hai, is liye app ki `Price Lookup` bhi isi URL se kaam karti hai.

---

## 1. Telegram bot banayein (2 minute)

1. Telegram mein **@BotFather** kholein.
2. `/newbot` bhejein → naam (maslan `AB Travels Prices`) → username (maslan `abtravels_prices_bot`).
3. BotFather **token** dega, mislan:
   `1234567890:AAH...` — ise sambhal kar rakhein.

## 2. Cloudflare Worker (5 minute)

1. [cloudflare.com](https://cloudflare.com) → free account → **Workers & Pages → Create Worker**.
2. Naam dein → **Deploy** → **Edit code**.
3. App kholein → **Settings → 🤖 Telegram price bot → “Copy bot worker code”**, aur poora code
   Worker editor mein paste karke **Deploy** karein.
   *(Ya repo ki file `pricebot-worker.js` copy karein.)*
4. Worker → **Settings → Variables and Secrets** → ye add karein:

   | Name | Type | Value |
   |---|---|---|
   | `IGNAV_API_KEY` | Secret | aap ki Ignav key |
   | `TELEGRAM_BOT_TOKEN` | Secret | BotFather wala token |
   | `TELEGRAM_WEBHOOK_SECRET` | Secret (optional) | koi bhi random word, maslan `hisab2026` |
   | `MAX_DAILY_REQUESTS` | Text (optional) | bot ke daily searches, default `60` |
   | `MAX_DAILY_PROXY` | Text (optional) | app (browser) ke daily searches, default `200` |
   | `ALLOWED_ORIGIN` | Text (optional) | sirf ye website app proxy use kar sake, maslan `https://abtravels.github.io` |

5. Worker → **Settings → Bindings → Add → KV namespace**:
   - Variable name: **`KV`**
   - KV namespace: **Create new** (naam maslan `abtravels-bot`) → Save
6. Worker → **Settings → Triggers → Cron Triggers → Add**:
   - Cron expression: `*/1 * * * *`  (har minute)
7. Worker URL kholein: `https://YOUR-WORKER.workers.dev`
   - Sab green hona chahiye. Phir `https://YOUR-WORKER.workers.dev/setup` kholein →
     **✅ Bot connected**.
8. Telegram mein apna bot kholein → **`/start`** bhejein.
   Pehla `/start` bot ko aap ke naam lock karta hai. Team member add karne ke liye
   us se bot par **`/id`** bhejwayein, phir aap **`/share <uska id>`** bhejein — dono ko
   alerts jayenge aur dono tracks dekh/edit kar sakte hain.

App mein: **Settings → Flight prices → Worker URL** mein wahi `https://YOUR-WORKER.workers.dev`
daal kar **Save & test connection** → green badge.

---

## 3. Commands

Seedha normal message bhi bhej sakte hain:

```
DXB to KHI 15 December                 abhi ka sab se sasta fare
DXB KHI 15 Dec har 30 minute           track, har 30 minute
DXB KHI 15 Dec har ghantay kal raat 10 baje tak
KHI UET 15 December har 15 minute 15 December shaam 6 baje tak
EK601 DXB KHI 15 December              sirf us flight ka fare
```

Bot har reply mein **1 / 5 / 10 / 15 / 30 / 60 min**, **Pause**, **Book** aur **Stop**
ke buttons deta hai — mobile se ek tap.

```
/price KHI DXB 01-12-2026
/price KHI DXB 01-12-2026 15-12-2026        round trip
/price KHI DXB 01-12-2026 adults=2 cabin=business market=AE nonstop flight=EK601
```

```
/watch KHI DXB 01-12-2026                    price girne par alert
/watch KHI DXB 01-12-2026 target=85000 every=10
/watch KHI UET 15-12-2026 flight=PK310 every=60 until=2026-12-14T22:00
/interval 1 30                               watch #1 ab har 30 minute
/pause 1          /resume 1
/urgent 1 60                                 watch #1 har minute, 60 min tak
/list
/stop 1        /stop all
/book 1                                      airline/OTA booking links
/budget                                      aaj ke searches
/quiet                                       quiet hours status
/quiet on                                    enable quiet hours
/quiet off                                   disable quiet hours
/quiet 02:00-09:00                           custom quiet window (Pakistan time)
/id                                          apna chat ID
/share 123456789                             (owner) team member add
/share                                       team list
/unshare 123456789                           (owner) member remove
```

Date `01-12-2026`, `2026-12-01`, `15 December`, `today`, `tomorrow`, `kal` — sab chalte hain.
`until` aur aakhri waqt **Pakistan time** mein hai; waqt poora hone par watch khud band ho jata hai.
Har fare ke saath **check ka waqt** aur **source (Ignav)** likha hota hai.

### Team / shared access
- Member pehle bot par `/start` aur `/id` bheje (us ka chat ID milega).
- Owner `/share <id>` bheje — us member ko welcome message jata hai.
- Ab dono ke liye **ek hi** watch list hai: koi bhi `/watch` lagaye, sab ko dikhega;
  price alert, budget warning, end-time message **sab allowed chats** ko jayenge.
- Owner `/unshare <id>` se access band kar sakta hai. Max 10 members.

### Searches ka hisab (kitni call lagti hai)
| Kaam | Ignav searches |
|---|---|
| Normal price message ya `/price` | **1** |
| `/watch` banate waqt | **1** (turant price) |
| Watch ka har interval check | **1** per check |
| `/list`, `/stop`, `/pause`, `/resume`, `/budget`, `/quiet`, `/help`, `/id`, `/share` | **0** |

Misaal: `every=120` + `until` agle din 13:00 → banate waqt 1 call, phir har ~2 ghante par 1 call; waqt poora hote hi watch khud delete ho jata hai (aur message aata hai).

### Alerts kab aate hain
- **Price update**: 30+ minute interval wale watches par **har check ke baad** current price
  aur pichli price se change bhejta hai (request waste nahi hoti).
- **Alert**: fare `target=` se kam ya barabar, ya pichli price se **5% ya zyada** kami.
- Chhote intervals (1/5/10/15 min) aur urgent mode mein sirf alerts — har minute price
  update se spam nahi hota.
- Sirf `verified` fares par alert; ek alert ke baad 10 minute ka cooldown.

### Quiet hours (default 02:00–09:00 PKT)
- Default **ON**: 02:00–09:00 Pakistan time mein koi automatic check nahi hota, is liye
  raat bhar Ignav searches waste nahi hoti.
- 09:00 ke baad pehla check current price ka update bhejta hai (ya target/5% alert).
- `/quiet` status · `/quiet off` band · `/quiet on` chalu · `/quiet 01:00-09:00` custom.
- Sirf owner quiet hours change kar sakta hai; team members status dekh sakte hain.

---

## 4. Free limits (zaroori)

| Cheez | Free limit | Bot ka behaviour |
|---|---|---|
| Ignav | **1,000 searches total** (monthly nahi), phir $2/1,000 | bot: daily **60** (`MAX_DAILY_REQUESTS`), app: daily **200** (`MAX_DAILY_PROXY`) |
| Cloudflare Worker | 100,000 requests/day | cron = 1,440/day |
| KV reads | 100,000/day | ~3,000/day (index + watch reads) |
| KV list | **1,000/day** | cron **KV.list nahi karta** — `w:index` se watches padhta hai |
| KV writes | 1,000/day | bot check par 1 write, budget ke andar |

> **KV list limit (important):** pehle cron har minute `KV.list` chalata tha = 1,440 list/day,
> jo free plan ki 1,000/day limit se zyada hai (90% email ~15 ghante mein aa jati thi).
> Ab watches ek `w:index` key mein hain; cron sirf index + watches `get` karta hai.
> Index pehli baar missing ho to ek dafa `KV.list` se migrate hota hai, phir kabhi nahi.
> Purana code wapas deploy na karein warna list limit dobara full ho jayegi.

**Har minute check = 60 searches/hour.** Is liye:

- Normal tracking: `every=15` (default) ya `every=30`.
- Urgent ticket: `/urgent 1 60` — sirf 1 ghante ke liye, phir khud band ho jata hai.
- Booking ho jaye to foran `/stop 1`.

1,000 free searches ka matlab: 15-minute tracking ≈ 96 searches/day → **~10 din** lagataar.
Behtar tareeqa: watch sirf us waqt lagayein jab ticket actually book karwana ho.

---

## 5. Troubleshooting

| Problem | Wajah / hal |
|---|---|
| Bot jawab nahi deta | `/setup` dobara kholein; Worker → status page par webhook `not set` na ho |
| `This bot is private` | Aap allowed list mein nahi. Owner se `/share <aap ka id>` karwayein (apna id `/id` se) |
| `IGNAV_API_KEY secret is not set` | Worker → Variables and Secrets mein secret add karein |
| `KV binding ... not set` | Worker → Bindings mein KV namespace, variable name **KV** |
| `Unauthorized` / 401 from Ignav | Key ghalat ya expire; dashboard se nayi key |
| `search budget khatam` | Aaj ka cap poora; kal try karein ya `MAX_DAILY_REQUESTS` barhayein |
| Alerts nahi aa rahe | Cron trigger `*/1 * * * *` add hai? `/list` mein `urgent`/`every` check karein |
| App "Aaj ki proxy limit" / 429 | `MAX_DAILY_PROXY` poora; kal try karein ya limit barhayein |
| Cron free plan par late chalta hai | Cloudflare kabhi 1–2 min late kar sakta hai; urgent mode phir bhi kaam karta hai |

---

## Security

- Bot token aur Ignav key **sirf Worker** par (secrets). App, backup, GitHub sync, share links
  mein kabhi nahi jate.
- Bot private rehta hai: pehla `/start` owner set karta hai; baqi log sirf owner ke
  `/share <id>` ke baad andar aa sakte hain. Chahein to `TELEGRAM_WEBHOOK_SECRET`
  bhi set karein (Telegram ke har request par verify hota hai).
- Shared members poore team ke watches dekh/edit kar sakte hain (jaan bujh kar diya gaya
  team feature hai) — sirf bharose wale logon ko `/share` karein.
- App ka proxy (`/fares` wagera) daily `MAX_DAILY_PROXY` se band hota hai, taake koi aur aap ki
  Ignav allowance khatam na kar sake. Ye **best-effort** cap hai: KV mein atomic increment nahi,
  is liye bohat zyada parallel requests par kuch calls cap se nikal sakti hain. **Asal hard stop
  Ignav dashboard ki spending limit hai** — wahan limit zaroor set karein.
- `ALLOWED_ORIGIN` set karein to sirf wahi website proxy use kar sakti hai. Lekin `curl` jaisi scripts apna Origin header khud bana sakti hain, is liye ise akela security guarantee na samjhein.
- **`/notify` relay (v2.39):** app ke notifications isi Worker se Telegram par jate hain
  (`POST /notify` with `{title, text, chats, token}`). App origin aur token verify hote hain;
  sirf allowed team chats ko send hota hai. Staff service binding shared `NOTIFY_KEY` use karti hai.
  120 messages/hour ka soft cap hai. Jo network `api.telegram.org` block karta he us par bhi
  notifications chalti hain.


## /remind — team reminders (v2.52)
- `/remind <text> <waqt>` — masalan `/remind Air Arabia: Usama ki booking 1 bje expire hogi` → default 60 + 30 min pehle (12:00, 12:30 par) team ko alarm.
- Waqt parsing: `1 bje` = 1 PM (1–7 baje bina marker dopahar), `subah/raat/shaam … baje`, `9:30`, `kal/aaj`, `15 December 1 bje`, `30 min baad`, `2 ghantay baad`. Option `lead=60,30,10,0`.
- `/reminds` — upcoming list · `/unremind R12` · `/unremind all`.
- Storage: ek KV key `reminds`; cron har minute check karta hai, sirf fire par 1 KV write. Reminders quiet hours ko ignore karte hain.


- Reminder ka waqt messages mein 12-ghantay (am/pm) format mein dikh ta hai: `10 Nov 2026 1:00 PM PKT` (v2.53).


## Reminder fixes (v2.54)
- Reminders ab **Durable Object** (`WatchIndex`, `WATCH_INDEX_DO`) mein store hote hain — pehle ek KV key pe likhte the, jahan do `/remind` ek saath bhejne par ek reminder gayab ho jati thi, aur cron ke chalne ke beech naya reminder add karne par purana delete ho jata tha. Ab har write serialize hota hai.
- Waqt parsing: "kal raat 10 bje" = **kal** raat 10 baje (pehle aaj raat par lag jata tha), "raat 12 bje" = **raat 12:00** midnight (pehle dopahar 12:00), "12 bje" bina marker = 12:00 PM.
- Messages mein "PKT PKT" dobara nahi aata.
- Event qareeb ho aur lead times nikal chuke hon to reminder **event ke waqt** par lag jata hai (pehle "waqt guzar chuka hai" error aa jata tha).
- Worker redeploy ke liye: `npx wrangler deploy -c wrangler.pricebot.toml` (ya Cloudflare dashboard → Edit code → paste → Deploy). `WATCH_INDEX_DO` binding aur secrets wahi rahenge.

