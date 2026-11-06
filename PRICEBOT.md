# Telegram price bot — setup (free)

Aap ka apna Telegram bot: route bhejein, sasta fare wapas aata hai. Price girne par khud
alert karta hai, aur urgent ticket ke liye **har minute** check kar sakta hai.

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
   | `MAX_DAILY_REQUESTS` | Text (optional) | daily search cap, default `60` |

5. Worker → **Settings → Bindings → Add → KV namespace**:
   - Variable name: **`KV`**
   - KV namespace: **Create new** (naam maslan `abtravels-bot`) → Save
6. Worker → **Settings → Triggers → Cron Triggers → Add**:
   - Cron expression: `*/1 * * * *`  (har minute)
7. Worker URL kholein: `https://YOUR-WORKER.workers.dev`
   - Sab green hona chahiye. Phir `https://YOUR-WORKER.workers.dev/setup` kholein →
     **✅ Bot connected**.
8. Telegram mein apna bot kholein → **`/start`** bhejein.
   Pehla `/start` bot ko aap ke naam lock karta hai; koi doosra insaan use nahi kar sakta.

App mein: **Settings → Flight prices → Worker URL** mein wahi `https://YOUR-WORKER.workers.dev`
daal kar **Save & test connection** → green badge.

---

## 3. Commands

```
/price KHI DXB 01-12-2026
/price KHI DXB 01-12-2026 15-12-2026        round trip
/price KHI DXB 01-12-2026 adults=2 cabin=business market=AE nonstop
```

```
/watch KHI DXB 01-12-2026                    price girne par alert
/watch KHI DXB 01-12-2026 target=85000 every=10
/urgent 1 60                                 watch #1 har minute, 60 min tak
/list
/stop 1        /stop all
/book 1                                      airline/OTA booking links
/budget                                      aaj ke searches
```

Date `01-12-2026`, `2026-12-01`, `today`, `tomorrow` — sab chalte hain.
Bare message bhi chalta hai: `KHI DXB 01-12-2026`.

### Alerts kab aate hain
- **Target hit**: fare `target=` se kam ya barabar.
- **Drop**: pichli price se **5% ya zyada** kami.
- Sirf `verified` fares par alert; ek alert ke baad 10 minute ka cooldown.

---

## 4. Free limits (zaroori)

| Cheez | Free limit | Bot ka behaviour |
|---|---|---|
| Ignav | **1,000 searches total** (monthly nahi), phir $2/1,000 | daily budget default **60** (`MAX_DAILY_REQUESTS`) |
| Cloudflare Worker | 100,000 requests/day | cron = 1,440/day |
| KV | 1,000 writes/day | bot check par 1 write, budget ke andar |

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
| `This bot is private` | Pehla `/start` kisi aur ne kiya tha. KV se `owner` key delete karein, phir `/start` |
| `IGNAV_API_KEY secret is not set` | Worker → Variables and Secrets mein secret add karein |
| `KV binding ... not set` | Worker → Bindings mein KV namespace, variable name **KV** |
| `Unauthorized` / 401 from Ignav | Key ghalat ya expire; dashboard se nayi key |
| `search budget khatam` | Aaj ka cap poora; kal try karein ya `MAX_DAILY_REQUESTS` barhayein |
| Alerts nahi aa rahe | Cron trigger `*/1 * * * *` add hai? `/list` mein `urgent`/`every` check karein |
| Cron free plan par late chalta hai | Cloudflare kabhi 1–2 min late kar sakta hai; urgent mode phir bhi kaam karta hai |

---

## Security

- Bot token aur Ignav key **sirf Worker** par (secrets). App, backup, GitHub sync, share links
  mein kabhi nahi jate.
- Bot private hai: pehla `/start` owner set karta hai. Chahein to `TELEGRAM_WEBHOOK_SECRET`
  bhi set karein (Telegram ke har request par verify hota hai).
- Kisi ko bot ka username dein to wo `/start` nahi kar sakta (owner already set) — sirf aap
  commands chala sakte hain.
