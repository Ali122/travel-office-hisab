# Travel Office Hisab — AB Travels

Single-file web app for a travel agency's monthly accounts. No build step, no server:
open `index.html` in any browser. The whole UI is in English.

**Live app:** https://ali122.github.io/travel-office-hisab/

## What it does

- Monthly accounts: income, expenses, ticket profit, net profit
- Tickets / Umrah bookings — paid / unpaid, per-month filter
- Partners: Umair & Sarmad — share earned, withdrawals, balance
- Father (Owner) withdrawals; Waseem commission & salary (Staff)
- Loan tracker, charity at a configurable rate (per-month override possible)
- Client pending payments (bakaya) with per-month filter
- Month-wise import from a Google Sheet (one file per month) via Apps Script web app
- Sync to Google Sheets (`HisabData` cell) so phone and PC stay together
- Excel (CSV) report: one selected month, all months in one file, or one file per month

## Google Sheet sync

1. Put the Apps Script code (shown inside the app: Settings → Google Sheet setup) into
   the Sheet's **Extensions → Apps Script**, then deploy as a **Web app** (execute as: me,
   access: anyone).
2. In the app: Settings → paste the deployment URL + the Sheet **File ID** → Test.
3. Each month has its own Sheet file — change the File ID, then **Import**.

The app keeps data in `localStorage` and pushes a JSON copy to the Sheet.

## Version

Current version is shown in Settings and in the header badge. Bump `APP_VER` on every release.

## Files

- `index.html` — the whole application (HTML + CSS + JS + embedded Apps Script code)
- `logo.png` — AB Travels logo (header + favicon)

## PDF to Word (structured, iLovePDF style)

Settings/PDF-to-Word tab: **Convert mode** -> *iLovePDF style* reads the PDF text layer,
vector lines, embedded images and page geometry directly (no canvas render needed) and
builds an editable .docx with:

- A4 page size + margins taken from the PDF
- real Word tables (detected from ruled grids), headers/footers repeated on every page
- bold/italic/font family/size, alignment and spacing
- embedded images at their original positions
- scanned pages handled via Tesseract OCR word boxes (render-free when a full-page image exists)

*Simple text only* mode keeps the original text/OCR behaviour. Engine libs (pdf.js, docx.js,
Tesseract.js) load from CDN on first use.

## Data-safety notes

- GitHub backup/sync files never contain the PAT (stripped on export, push, snapshot, share).
- Restore paths (syncPull, backup-file restore, Undo snapshot) merge missing sections
  (clients, invoices, bills, airlineIds, ...) from local state, so an older GitHub/backup
  file cannot wipe newer local data. An explicitly empty array on the remote is respected.
- Settings -> GitHub Sync shows a permanent masked-token connection badge that survives reloads.

## Version

Current version: **2.00**. Bump APP_VER and #verBadge on every release.

## PDF to Word - Exact look mode (v2.01)
- Renders every page to a high-res image (logo, shapes, colors, tables, borders) embedded as full-page background
- Adds transparent, floating, absolutely-positioned editable text frames at exact PDF positions (font family, size, bold/italic, align, white/black auto-detected from background)
- Result opens in Word looking exactly like the PDF - click any text and edit it in place. iLovePDF-style mode remains for native, reflowable Word objects (tables/headers/margins).
- The app bundles pdf.worker.min.js (~1 MB, same version as bundled pdf.js) so page rendering does not depend on a CDN worker. Do not delete it.
## Version
Current version: **2.01**. Bump APP_VER and #verBadge on every release.

## Mobile tables (v2.02)
- render() har data table ko .table-wrap (overflow-x:auto) mein wrap karta hai, aur mobile par card-style stacked rows bana deta hai (data-label ke sath) - action icons (edit/unpaid/delete/invoice/date) kabhi clip ya off-screen nahi hote.
- Invoice print preview (#invPrint) ko wrap nahi kiya jata taake PDF capture ka layout barqarar rahe.
## Version
Current version: **2.02**.

## Price Lookup (Amadeus) - v2.03
- Settings -> Amadeus - live flight prices: one-time setup = free developers.amadeus.com account (API Key + Secret) + free Cloudflare Worker proxy (~5 min, no credit card). Worker code is inside the app (copy button). API secrets NEVER reach the app or browser - only the Worker talks to Amadeus; app calls /flights and /health on your Worker URL.
- New nav tab: Price Lookup - enter From/To (IATA codes), date, adults, non-stop filter, currency (PKR/USD/AED/SAR/EUR), class, and see real-time published fares sorted by price (airline, times, stops, duration, seats, fare class, grand total). Copy any fare to clipboard to send to a client. Popular-route presets + sasta ticket/Google Flights/Kayak backup links included. Indicative fares; booking via consolidator/airline portal.
## Version
Current version: **2.03**.

## Version
Current version: **2.31** (Email share opens Gmail compose with recipient prompt; larger ayah/Urdu fonts; staff portal daily ayah; price bot v2.29 quiet hours + updates; invoice share row).

## Price Lookup - Ignav (v2.12) - Cloudflare Worker proxy
- Amadeus Self-Service was decommissioned 17 July 2026 (all free keys disabled) - that integration is removed.
- New provider: Ignav (ignav.com). First 1,000 successful requests are a one-time free allowance (not monthly); after that $2 per 1,000. Failed requests are not billed. API key stays in a Cloudflare Worker proxy (browser calls are blocked by Ignav). Setup: Settings -> Flight prices - Ignav -> copy worker code -> deploy on Cloudflare -> set IGNAV_API_KEY secret -> paste Worker URL.
- Price Lookup tab: one-way, round-trip and multi-city (2 legs), airport autocomplete, adults, cabin class, non-stop, market (PKR/AED/SAR/GBP/USD/INR/QAR), max results; results show airline + flight number, times, duration, stops/via airports and price, with Copy fare and Book/links.
- Security: the Ignav API key is stripped from backup files, GitHub sync payloads, undo snapshots and share links (same treatment as the GitHub PAT); it stays on the device and survives restores.

## Sasta route price snapshots (free)
- `.github/workflows/sasta-prices.yml` runs Playwright Chromium every 30 minutes on a public repo (free Actions minutes) and reads Sasta's public SEO route pages.
- Top 16 routes only; output is `data/sasta/<origin>-<destination>.json` with a route-level `amount`, `observed_at`, `source_url`. It is cached/indicative, not date-specific availability.
- Price Lookup fetches `data/sasta/khi-dxb.json` (etc.) and shows a **Sasta Ticket — route price · External / indicative** card under Ignav results. Missing file / failed scrape = badge hidden, manual Sasta link remains.
- The scraper does not log in, bypass CAPTCHA or book. If Sasta changes markup/WAF, the job fails gracefully and the last good JSON stays.

## Staff portal (v2.16) — separate Cloudflare Worker
- `staff-worker/` is a password-only staff portal at `staff-abtravels.<subdomain>.workers.dev`. No email or OTP; the password is a Worker secret and the browser gets a 12-hour signed `HttpOnly` cookie.
- Staff can add partial payments on receivables and unpaid tickets, view/add/edit clients (no delete), create their own bookings, print/share invoices for their own bookings, open/share the shared Ticket Files, and use PNR Lookup.
- Cost, profit, expenses, partners, Father, loans, settings, airline IDs, backups and the GitHub token never reach staff. Staff bookings are saved with `createdBy: "staff"`, `cost: 0` so the owner can add the real cost.
- Setup, secrets and testing: see `staff-worker/README.md`. The Worker writes to the same `HisabData.json`; press **Pull now** in the owner app to see staff changes.


## Price Lookup fix (v2.08): Ignav requires a server proxy
- Cause of 'check connection': Ignav's API is not callable from browser JavaScript (key must stay server-side). Direct calls fail.
- Fix: one-click Cloudflare Worker proxy code inside Settings (free plan). Worker adds the key server-side and exposes /health, /fares, /round-trip, /booking-links with CORS.

## Price Lookup — Kiwi/Tequila (v2.19)
- Second free source alongside Ignav. `KIWI_WORKER_CODE` (Settings → Kiwi prices) deploys a separate Cloudflare Worker that proxies `api.tequila.kiwi.com/v2/search` with the key stored server-side as `TEQUILA_KEY`.
- Setup: tequila.kiwi.com/portal/signup → free key → deploy worker → set secret → paste Worker URL → Save & test.
- One-way searches hit the worker's `/kiwi` endpoint in parallel with Ignav; results are converted to the same itinerary shape and merged into the sorted list with a **Kiwi** badge and a direct "Kiwi par book" deep link. Prices show as *unverified* (indicative).
- Currency follows the Pricing market selector (PKR default). `kiwiProxy` URL is device-specific (stripped from shared state, like `ignavProxy`).
## Kiwi/Tequila removed (v2.21)
- Tequila public signup closed May 2024 (invitation-only per Kiwi.com policy), so the v2.19 Kiwi integration was fully reverted — Ignav is again the only live source in Price Lookup. The v2.19 worker code remains in git history if a Tequila key is ever obtained.
## Telegram price bot (v2.24)
- New Settings card: "Telegram price bot" with a one-click copy of `pricebot-worker.js` (also kept in the repo root).
- One Cloudflare Worker does both jobs: the Ignav proxy for the app and the Telegram bot with a 1-minute cron.
- Bot commands: `/price KHI DXB 01-12-2026` (one-way or `... 15-12-2026` round trip, options `adults=2 cabin=business market=AE nonstop`), `/watch ... target=85000 every=10`, `/urgent 1 60` (every minute for 60 minutes), `/list`, `/stop 1|all`, `/book 1`, `/budget`.
- Alerts on target price hit or a 5%+ drop, max one alert per 10 minutes; only `verified` fares can alert.
- First `/start` claims the bot (owner chat stored in KV); every other chat is refused (`This bot is private`).
- Safety: daily search budget (default 60, `MAX_DAILY_REQUESTS`), reserved before each Ignav call; protects the 1,000 one-time free searches and the KV 1,000 writes/day limit.
- Secrets (`IGNAV_API_KEY`, `TELEGRAM_BOT_TOKEN`, optional `TELEGRAM_WEBHOOK_SECRET`) live only in the Worker; nothing is stored in the app or its backups.
- Setup guide: `PRICEBOT.md`.

## Mobile-friendly price bot (v2.25)
- Natural messages: `DXB to KHI 15 December`, `DXB KHI 15 Dec har 30 minute`, `EK601 DXB KHI 15 December` — Roman Urdu/English, city names or IATA codes, `kal`/`aaj`, `har ghantay`, `har 2 ghantay`.
- Tracking end time (`... kal raat 10 baje tak` or `until=2026-12-14T22:00`, Pakistan time); the watch deletes itself and tells you when time is up.
- Inline buttons on every reply: 1 / 5 / 10 / 15 / 30 / 60 min, Pause, Book, Stop; new `/interval`, `/pause`, `/resume` commands.
- Specific flight filter for both one-off prices and watches (`flight=EK601` / `EK601` in a normal message).
- Every fare and alert shows the check time (PKT) and the source (Ignav, verified only).
- App proxy now has its own best-effort daily counter (`MAX_DAILY_PROXY`, default 200) and an optional `ALLOWED_ORIGIN` check, so the public `/fares` route cannot silently drain the whole Ignav allowance. The Ignav dashboard spending limit remains the hard stop.

## Invoice overnight arrival (v2.26)
- Invoice ab arrival ki apni date dikhata hai. Agar flight raat ko utarti hai (arrival time departure se chhota, e.g. 11:05 PM → 2:05 AM), to arrival `02/12/26 (+1)` — agle din — print hoti hai, departure ki date nahi.

## Shared price bot (v2.27)
- Team access: owner `/share <chat_id>` se member add karta hai (`/unshare` se remove, max 10). Member apna ID `/id` se le sakta hai.
- Ek hi watch list sab members ke liye: koi bhi `/watch`/`/stop`/`/interval` chalaye, sab par asar hota hai.
- Price alerts, budget/end-time messages aur naya-watch notice **tamam allowed chats** ko jate hain.
- Worker status page par owner aur team chats dikhte hain; bot version `v2.27`.

## Ticket Files — shared PDF library (v2.33)
- New nav tab **Ticket Files**. Upload a saved ticket PDF/image from the PC (or drag & drop); it is stored once in the private GitHub backup repo under `tickets/` (20 MB per file, PDF/JPG/PNG).
- The invoice share row's old **LocalSend** button is now **📁 Files**: it saves the generated invoice straight into the shared library, so no download/re-upload or PC→phone transfer is needed.
- Only small metadata (client, PNR, file name, size, uploader, time) goes into `HisabData.json`, so every device that has the app (mobile, Sarmad, staff) sees the list after the normal GitHub sync. Files download on first open and are cached on the device.
- Client and PNR auto-fill from the file name when they match an existing client/ticket/invoice.
- **WhatsApp** button: on a phone the share sheet opens with the PDF already attached (no LocalSend step). On a PC the PDF downloads and WhatsApp Web opens at the client's saved number with a ready caption.
- Staff portal: new **Ticket Files** tab; the Worker proxies downloads through `/api/file?id=...`, so staff never receive the GitHub token.
- Deleting a file in the app removes it from GitHub; other devices drop it on their next sync (or **Refresh** on the tab).
- Staff Worker must be redeployed once after this version for the staff tab to appear.

## Team push notifications (v2.34)
- New Settings card **Team notifications (free push)**. Notifications use [ntfy.sh](https://ntfy.sh) — no account, email or OTP.
- Setup once: press **New topic** → **Save & send test** → install the free **ntfy** app on every phone (Play Store / App Store) → `+` → paste the topic → Subscribe. On a PC, open `https://ntfy.sh/<topic>` and press Subscribe.
- Notifications are sent automatically for: a new sale/ticket in the app, a new Ticket File upload, an invoice saved to Ticket Files, a new staff booking, and a staff payment.
- The topic is a shared secret: anyone who knows it can read the notifications (client names/PNRs are included). Share it only with the team; press **New topic** to rotate it.
- If ntfy.sh is unreachable, the app keeps working; only the notification fails (silently in the background).
- The Worker reads the topic from `HisabData.json`, so staff-originated notifications work without any extra Worker secret.

## Version
Current version: **2.34**.
