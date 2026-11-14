# Travel Office Hisab — AB Travels

## Default tab: hamesha Sales (v2.72)
- **Har dafa app khulne par Sales tab** khulta hai. Pehle pichhla khula tab yaad rehta tha — kisi ne Expense/Settings par chhor diya ho to dobara wahi khulta tha.
- Tab badalna andar waisa hi hai; sirf nayi opening par shuruaat **Sales** se hoti hai (mobile quick bar ka highlight bhi Sales par aata hai).

## Phone quick bar: Expense button (v2.71)
- Neeche ki quick bar (sirf phones/tablets) ab: **Sales · Invoice · Files · Expense · Pending · ☰ Menu** — Expense Pending se pehle, ek tap door.
- 400px se chhoti screens par icon/label thora chhota kar diya, taake 6 buttons mein kuch kata na jaye.
- Naya tab nahi bana — wahi purana **Expenses** screen khulta hai (`data-tab="exp"`), is liye form, hisaab aur sync par koi asar nahi.

## Modern look (v2.69 / v2.70)
- **Cards:** kone 14px → **16px**, padding 16px, aur layered shadow (oper halki line + neeche narm gehri parchhai). Mouse wale device par card par hover karne se shadow thora ubharta hai.
- **Buttons:** kone 12px, primary/green par halki rangeeli parchhai (glow), dabane par halka "press" effect.
- **Fields:** kone 12px; focus par purana sakht outline hataya — ab **narm ring** (border + 3px halka halo) aata hai, dark aur OLED mein bhi.
- **Stat tiles (Summary/Monthly):** label 11px bold, number 21px tabular figures ke sath — figures ab line par line seedhe rehte hain.
- **Bottom quick bar:** ab **frosted glass** (translucent + blur) — peeche ka content halka dikhta hai, iOS jaisa look. OLED mein pure black frosted.
- **Sidebar:** halka vertical gradient aur active item par gold-tinted gradient (pehle flat grey tha).
- **Scrollbars:** patli, rounded, theme ke rang mein (pehle default moti grey).
- **Chhote touches:** "👁 Show totals" chip ab solid pill (dashed nahi), success banner par hari left accent line, toast rounded + blur, row action sheet ke oper wale kone rounded.
- Sirf **shakl** badli hai — koi button, tab, form ya hisaab ka kaam nahi badla. `prefers-reduced-motion` walon ke liye animation band.
- Poori tarah **CSS-only** change — Worker redeploy ki zaroorat nahi.
- **v2.70 fix:** card ki nayi padding un cards par bhi lag rahi thi jinki apni padding thi — Sales register ka toolbar card ke andar ghus gaya tha (square corners + adhoori line). Ab `sheet-bar` / `sheet-card` / ayat card ki padding waisi hi hai. Drawer ka scrollbar bhi patla aur drawer ke rang mein kar diya (dark/OLED mein patli lakeer jaisi dikh raha tha).

## Notification fixes: ab fail hone par sabab nazar aata hai (v2.68)
- **File add karne par notification na aane ki wajah chhupi hui thi** — app relay ki ghalti chup chaap nigal leti thi (`catch → false`). Ab:
  - fail hone par neeche **toast** aata hai: `⚠ Telegram notification nahi gayi — <sabab>` (maslan `origin`, `no_chats`, `relay 500`).
  - **Settings → 🤖 Team notifications** mein aakhri koshish ka nateeja tareekh ke saath likha hota hai (✓ gayi / ✗ nahi gayi + sabab).
  - Test button bhi ab asal sabab dikhata hai.
- **Purani/galat Chat IDs** ke sabab notification band na hon: agar Worker `no_chats` kahe to app **khud team list** (bot ke allowed chats) par dobara bhej deti hai.
- **Network / Worker 5xx** par ek dafa khud retry (Cloudflare → Telegram kabhi 15–40s leta hai).
- **Paste ki hui file** (clipboard se PDF/image) ab bhi team ko notify karti hai — pehle yeh jaan bujh kar "silent" thi. Sirf note ke dabbe ke andar Ctrl+V karne par notification nahi jati.
- Upload ke baad agar notifications Settings se **off** hain to message mein saaf likha aata hai.
- ⚠ Ek dafa check kar lein: **Settings → Team notifications** mein "Send notifications for new tickets and files" tick hona chahiye.

## Sales register: mouse wheel ab page bhi scroll karta hai (v2.66)
- **Masla:** register par mouse rakh kar wheel ghumane se sirf andar ki list scroll hoti thi aur page upar/neeche nahi hota tha — register se mouse hatana parta tha. Wajah: `.sheet-scroll` par `overscroll-behavior:contain` tha, jo list ke aakhir par bhi scroll ko page tak nahi jane deta.
- **Fix:** ab chaining normal hai (`overscroll-behavior:auto`) — list khatam hone par page khud aage scroll ho jata hai.
- **Chhoti list (maslan November ki kam sales):** agar rows itni kam hain ke andar scroll ki zaroorat hi nahi, to andar ka scroll box **hata diya jata hai** (`fit` class, JS se naapa jata hai) — poora page ek hi scroll mein chalta hai. List lambi ho to frozen header/columns wala box waise hi kaam karta hai.

## Drawer polish (v2.65)
- Drawer khulte hi active tab beech mein aa jata hai — lekin **MENU heading aur ✕ (close) button ab sticky** hain, is liye neeche wale tab (Settings, Monthly Accounts) par bhi band karne ka button hamesha nazar aata hai.
- Quick bar ke active tab ka gold accent bar thora neeche shift kiya taake bar ke top border par crop na ho.

## App ka naya link + origin fix (v2.64)
- **GitHub account ka naam badal gaya hai**, is liye app ka purana link `ali122.github.io/travel-office-hisab/` ab **404** deta hai. Naya live link: **https://abtravels.github.io/travel-office-hisab/** — bookmarks/home-screen icon dobara banayein.
- **Notification relay** (`pricebot-worker.js` ka `/notify`) sirf `ali122.github.io` origin qabool karta tha — naye host se aane wali Telegram notifications 403 ho rahi thin. Ab **dono hosts** (`ali122` aur `abtravels`) allowed hain, aur Telegram ke "📱 Open app" button ka URL naya hai.
- Worker redeploy zaroori hai (`npx wrangler deploy -c wrangler.pricebot.toml`). Redeploy se pehle bhi kaam chalana ho to Cloudflare → Worker → Settings → Variables mein `ALLOWED_ORIGIN = https://abtravels.github.io` set kar dein.
- Hardcoded purane links (`og:image`, company site ke canonical/og/schema URLs, staff portal ka logo, `scrape.js` UA) sab naye host par.
- **Bottom bar ka highlight fix:** Sales/Summary/Settings jaise pages par ab ghalat tab highlight nahi hota (quick bar sirf apne 4 tabs par active dikhati hai).
- Drawer khulte waqt seedha active tab par scroll ho jata hai.
- Invoice ka pehla heading ab **TYPE & AIRLINE** hai (pehle "INVOICE TYPE" heading ke neeche wahi "Invoice type" label dobara aata tha).

## Phone UI — neeche ki quick bar, chhota header, saaf forms (v2.63)
- **Neeche ki quick bar (sirf phones par):** Sales · Invoice · Files · Pending · ☰ Menu. Pehle har tab badalne ke liye ☰ kholna parta tha (2 taps); ab char sab se zyada use hone wale tabs ek tap mein, aur jo tab khula hai wo highlight rehta hai. Menu button wahi purana drawer kholta hai.
- **Header chhota:** phone par verse ki Urdu line ab ek line (tap kar ke poori khulti hai) aur Arabic font thora chhota — screen par ~30px zyada jagah. 410px se chhoti screen par theme/update buttons ab doosri line par nahi girte.
- **Tab badalne par page upar se shuru hota hai** — pehle agla tab beech mein khulta tha (jaise Invoice seedha "Trip type" par).
- **Header ki asli height naapi jati hai** (`--header-h`) — is liye "＋ New sale" jaisa jump target ab header ke neeche chhupta nahi.
- **Sales form ke boxes par labels** (Client name, Contact number, Detail, Cost price, Sale price) — pehle sirf placeholder tha, type karne ke baad box pehchanna mushkil tha.
- **Settings mein search box** — 13-screen lambi Settings mein sirf milte julte cards dikhte hain (khali karein to sab wapas).
- **Invoice form mein section headings** — Invoice type · Passengers · Flight details · Baggage & options.
- **Summary:** backup reminder ab summary ke **neeche** (pehle sab se upar bara button tha).
- **Buttons ka apna look:** bina rang wale `.btn` ab grey UA dabbe nahi (CSV button ka blue-on-grey text khatam); checkbox/radio ka ek hi style; naya focus-friendly accent.
- **Pichhla tab yaad rehta hai** — app dobara kholne par wahi tab khulta hai.
- Mobile ki quick bar aur `main` ka bottom padding safe-area (iPhone home bar) ka khayal rakhte hain.

## GitHub account renamed: Ali122 → abtravels (2026-11-13)
- New links: app **https://abtravels.github.io/travel-office-hisab/** · company website **https://abtravels.github.io/**
- Old `ali122.github.io` links stopped working (GitHub does not redirect Pages sites); repo links on github.com still redirect.
- Updated everywhere in code: price bot relay origin + Telegram "Open app" button, `scrape.js` user agent, staff portal logo URL, app's default GitHub backup repo (`abtravels/travel-office-hisab-backup`), staff portal default `GITHUB_REPO`, and the website's canonical/OG/JSON-LD URLs.

## Company website (2026-11-13)
- Public AB Travels website: **https://abtravels.github.io/** — files live in the separate repo `abtravels/abtravels.github.io` (`index.html`, `style.css`, `main.js`, `assets/logo.png`). Static, free GitHub Pages, no build step or dependencies.
- The old path `/travel-office-hisab/company/` now holds a small redirect page to the root site (query strings are preserved, so shared links keep working).
- **English + اردو** toggle in the header: switches text, `<html lang/dir>` (full RTL), page title, meta description and the prefilled WhatsApp message, then remembers the choice in `localStorage` (`abt-lang`).
- Contact shown: WhatsApp **0314-3176560**, mobile **0314-3176560**, alternate **0310-3311199**, email **ahmedbrothers053@gmail.com**. No street address is published yet.
- The quote form has **no backend**: on submit it validates name/phone and opens `wa.me` with the details prefilled. Nothing is stored on the website.
- Tested 320–1920px, English/Urdu, mobile menu, form validation, all links, no console errors, no horizontal overflow.

## Sales register uses the full laptop width (v2.62)
- On a laptop/desktop the **Sales** tab now stretches to the window instead of sitting in an 820px column, so both side margins are used and the table no longer needs left/right scrolling at 1280px and wider.
- Cell padding is slightly tighter on wide screens so Cost, Sale, Profit, Status, Type, Detail, Pax, Phone and actions all fit in one view.
- Other tabs keep their normal width; phones/tablets below 1000px keep the sideways-scroll grid unchanged.

## Sales register column order (v2.61)
- Columns now run **Cost → Sale → Profit → Status**, then Type, Detail, Pax, Phone and the actions button. The Σ footer row follows the same order.
- CSV export already uses Cost, Sale, Profit, so both views match.

## Sales register — top totals panel removed (v2.60)
- The **Cost / Sale / Profit / Persons** strip above the sales grid is gone. Those figures are already in **Monthly summary** and in the grid's Σ footer row, so the register is now shorter on mobile.
- Nothing else changed: month filter, search, grid columns, row actions and the Σ footer totals still work the same.

## Sales register refinements (v2.59)
- **Month khud current month par khulta hai** — pehle har dafa "All months" aata tha. Agar is mahine koi sale na ho to sab se naya mahina jis mein sales hain khulta hai; sales hi na hon to "All months".
- **Actions ab ek chhota `⋯` button** — us par tap (ya row par tap) se neeche menu khulta hai: ✔ Paid · 🧾 Invoice · ✏ Edit · **📝 Detail** · 📅 Date · ✕ Delete. Row ke andar baqi buttons chhupe rehte hain, is liye **actions ke liye left/right scroll khatam** — ye column hamesha daayen freeze hai (mobile par bhi).
- **Naya sale sab se oper** — pehle ek hi date ki sales naam ke hisab se lag jati thin; ab date ke andar **jo sale baad mein add hui wo pehle** dikhti hai (latest first).
- **Date column mein sirf din** (jab koi mahina chuna ho) — `7`, `9` waghera; "All months" par poori tareekh `07/11/26`. Mahina/year upar filter aur sheet title mein pehle se likha hota hai.
- **Detail ab form se bhi bhar jata hai** — Add New Sale form mein naya **Detail** box (route / PNR / note, e.g. `KHI-DXB EK601`). Purani sale ka detail badalne ke liye row ke `⋯` → **📝 Detail** (khali chhodein to purana rahega, mitane ke liye `-`).

## Sales register — Google Sheets jaisa grid (v2.58)
- **Sales tab** ka list ab **spreadsheet jaisa** hai: row numbers (#), column headers, poori grid lines, aur har sale ek chhoti single-line row mein — lambi cards khatam, is liye neeche scroll kam karna parta hai.
- **Header row aur Date column frozen** hain — 600 sales hon to bhi naam/tareekh samne rehte hain, sirf andar ka hissa scroll hota hai.
- **Khaas columns pehle**: Date · Client · **Sale** · **Profit** · **Status** (Paid/Unpaid + baqi raqam) — phir Cost, Type, Detail, Pax, Phone.
- **Bari screen par Actions column daayen frozen** — scroll karte waqt bhi ✔ Paid / 🧾 Invoice / ✏ Edit / 📅 Date / ✕ Delete samne rehte hain.
- **Kisi bhi row par tap** karein to neeche chhota menu khulta hai: ✔ Paid · 🧾 Invoice · ✏ Edit · 📅 Date · ✕ Delete (mobile par bhi asaan).
- Upar wahi ek patli patti: **Month filter + Search**. Search karte hi **totals bhi update** hote hain (jitni rows nazar aa rahi hain unka Sale/Profit).
- Neeche **Σ totals row** (Cost / Sale / Profit / Persons) — bilkul sheets ke TOTAL jaisa.
- **⬇ CSV** button — jo rows nazar aa rahi hain wo CSV file ban jati hain, Google Sheets ya Excel mein seedha khul jati hain.
- **"＋ New sale"** button form kholta hai; sale save hote hi form band ho kar naya row sheet mein samne aa jata hai.
- "Move sales to another month" aur "Clean up sales" (duplicates / clear all) ab alag chhote collapsed cards mein — main view saaf rehta hai.
- Chhota fix: Pending Payments ke reminder messages par ab **toast** (neeche confirmation) aata hai; pehle `notify` galti se local variable tha.

## Contact number + payment reminders (v2.57)
- **Add New Sale** form mein ab **Contact number** ka box hai. Number sale par save hota hai aur client record mein bhi (purana number khali ho to).
- Sale likhte hi client ka naam likhte hi number bhi auto-fill ho jata hai (client suggestions).
- Sale ka ✏ (edit) par bhi contact number poocha jata hai — purani sales ka number wahin add kar sakte hain.
- **Pending Payments** mein har unpaid sale aur client entry par number dikhta hai, aur teen buttons milte hain:
  - **📞 Call** — phone par seedha call (tel: link).
  - **💬 WhatsApp** — payment reminder message bhar kar WhatsApp khulta hai (naam + raqam + tareekh).
  - **🔔 Remind team** — Telegram par team ko yaad dila deta hai (naam, raqam, number).
- Pending Payments ke top par **"Remind team: all pending"** button — poori pending list (naam + raqam + number) ek message mein team ko bhej deta hai.
- Sales list mein bhi unpaid sale ke saath contact number dikhta hai.

## Telegram reliability (v2.55 / v2.56)
- **"Webhook: timeout"** ka asal reason: status page har baar Telegram API pe wait karta tha, aur Cloudflare → Telegram ki raasta 15–40s leti hai (kabhi block bhi hoti hai). Ab webhook info **KV mein cache** hoti hai (cron har 10 min refresh karta hai) — status page ab foran jawab deta hai aur sach dikhata hai.
- `tg()` mein **ek retry** add hua hai (timeout / network error / flood-control par dobara try), aur timeout 20s → 40s barha hai — Telegram temporarily slow ho to notification drop nahi hoti.
- App ka relay request timeout 30s → 70s (worker ke retry ka intezaar karta hai).
- Worker live: **v2.56** — status page par `Webhook: connected`, relay dono team chats par OK.

## Reminder fixes + UI polish (v2.54)
- **"kal raat 10 bje"** ab **kal** raat 10 baje par lagta hai (pehle aaj raat par lag jata tha).
- **"raat 12 bje"** ab raat 12:00 (midnight) hai — pehle dopahar 12:00 ban jata tha.
- Notification messages mein dobara "PKT PKT" nahi aata (pehle har reminder message mein "PKT PKT" likha tha).
- Reminders ab Durable Object mein store hote hain: do `/remind` ek saath bhejne par dono bachte hain, aur cron ke chalne ke beech naya reminder add karne par purana delete nahi hota.
- Event qareeb ho (lead times nikal chuke hon) to reminder **event ke waqt** par bhi lag jata hai — pehle "waqt guzar chuka hai" error aa jata tha.
- Invoice par "PASSENGERS (3)" likha ho to 3 rows dikhti hain (khali naam/NIC bhi).
- UI: mobile par header ki ayat 2 lines par clamp hoti hai (tap se poori khulti hai), sale form ke "Status / Method / Commission" ke labels ab visible hain, keyboard focus ring add hua hai.
- Checks: `python -m unittest discover -s tests -v` — price bot aur staff worker ke behaviour checks (Node ya headless Chrome se, offline).

## Reminder fixes (v2.52 / v2.53 — dost ka kaam)

## No added-by names anywhere (v2.51)
- Ticket Files and the staff portal no longer show **who uploaded** a file. The "Aap ka naam (uploads par)" box is gone from the app.
- New uploads do not store an uploader name at all; Telegram notifications already carry no added-by name.
- Old files and backups that still contain `uploadedBy` keep working — the field is simply never displayed.
- Staff portal: deploy `staff-worker` again (`npx wrangler deploy` in `staff-worker/`) to get the same change there.

## Sale — number of persons (v2.50)
- The **Add New Sale** form now has a **Number of persons** field (default **1**, 1–99). It is stored on the sale as `persons`.
- It is **informational only**: cost, sale, profit and all monthly totals stay exactly as entered — increasing persons never multiplies them.
- Sales list shows a 👥 badge when persons is above 1, and the Ticket Summary line shows the total person count for the filtered month.
- The sale edit (✏) prompt now also asks for the person count, and creating an invoice from a sale pre-fills the invoice passenger count from it.
- Older sales without the field are treated as 1 person; imports and backups keep working unchanged.

## Passenger IDs stay aligned (v2.49)
- Multi-passenger invoices keep blank lines in the NIC/Passport box, so a passenger with no NIC does not take the next passenger's ID. Applies to the app invoice form and the staff portal form.

## Multi-city proxy (v2.47)
- The price bot Worker forwards `/search` to Ignav's `/fares/search` endpoint, using the existing proxy budget and configuration.
- Run `python -m unittest discover -s tests -v` for the offline release checks. These checks do not exercise live bookings, payments, or Ignav.

## Price alert preview (v2.46)
- Bot price notifications now start with the **route + current price** on the first line (e.g. `KHI → DXB · 15 Dec 2026 · PKR 85,400`), so the phone notification preview shows everything without opening the message.
- Applies to both `alertText` (target/drop alert) and `updateText` (periodic price update); the change details (previous price, target, fare legs) follow on later lines.
- `pricebot-worker.js` v2.46 redeploy karein (`npx wrangler deploy -c wrangler.pricebot.toml`); bindings/secrets wahi rahenge.

## Price Lookup — children & infants (v2.45)
- Price Lookup now supports **adults, children (2–11), infants on lap (<2) and infants in seat**, using Ignav's official request fields (`adults`, `children`, `infants_on_lap`, `infants_in_seat`). Fields are sent only when above zero, so a plain 1-adult search sends exactly the same request as before.
- Validation: one lap infant per adult, and at most 9 seated passengers (adults + children + infants in seat).
- Ignav returns one **party total** per fare (`PriceModel` has amount/currency/status only, no per-person split), so results are labelled "party total".
- **One search = one Ignav request**, regardless of passenger count. The proxy `MAX_DAILY_PROXY` and bot `MAX_DAILY_REQUESTS` budgets count requests, not passengers; failed requests are not billed.
- UI-only `__max` / `__party` fields are stripped before sending (Ignav uses `additionalProperties: false` and rejects unknown fields).

## Setup guide fix (v2.44)
- The app's Telegram price-bot setup card now lists the required `WATCH_INDEX_DO` Durable Object binding (`WatchIndex`, SQLite, migration `watch-index-v1`) and the `npx wrangler deploy -c wrangler.pricebot.toml` path. Pasting only the Worker code is not enough for v2.42+.

## Audit fixes (v2.42)
- Browser notification requests are verified by the HTTPS origin check (the app-side bot token is no longer required; the old token field is optional/legacy). Staff continues to use the shared `NOTIFY_KEY` secret.
- Concurrent watch-index changes use a SQLite Durable Object instead of overwriting one KV array. First use imports existing watch keys from KV, including keys missed by the old index. Cron does not list KV every minute.
- Staff invoices preserve blank passenger ID slots so IDs stay paired with names.
- Price bot deploy: `npx wrangler deploy -c wrangler.pricebot.toml`. Requires `WATCH_INDEX_DO` binding and `watch-index-v1` migration (`WatchIndex`, SQLite); pasting code alone into an unconfigured Worker is insufficient.

Single-file web app for a travel agency's monthly accounts. No build step, no server:
open `index.html` in any browser. The whole UI is in English.

**Live app:** https://abtravels.github.io/travel-office-hisab/

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
- Staff can add partial payments on receivables and unpaid tickets, view/add/edit clients (no delete), create their own bookings, create ticket/Umrah invoices for any client (save + print), print/share invoices for their own bookings, open/share the shared Ticket Files, and use PNR Lookup. Saved staff invoices appear in the owner app's Invoice tab too.
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

## Ticket Files: links, notes and pasted documents (v2.35)
- New **Paste link / document** card in Ticket Files:
  - **Link** — e.g. a Google Drive or airline booking URL. Stored as a clickable entry with Open link / Copy / WhatsApp.
  - **Note / document text** — paste a document's text (max 4,000 characters). Stored in the synced data with View / Copy / WhatsApp.
  - **📋 Paste from clipboard** — a PDF/image in the clipboard is uploaded as a file; text/URL fills the form. Pasting a PDF/image into the note box also works.
- **These entries never send a push notification.** Notifications remain only for real ticket-file uploads, new sales, staff bookings and staff payments.
- Links are the cheapest option for big documents: keep the file on Drive and paste the link, so GitHub storage is not used.
- Staff portal shows links with Open/Copy and notes with View/Copy.

## GitHub storage — not unlimited
- GitHub Free is **not unlimited**: recommended repo size is under **1 GB** (soft; GitHub may contact you above it), a single file is capped at **100 MB**, and Git LFS gives 1 GB free (not used here).
- Each Ticket File upload is one commit. Deleting a file removes it from the current tree but the old copy stays in git history, so the repo does not shrink immediately.
- A typical 200 KB ticket PDF ≈ 5,000 files per 1 GB. That is years of normal use, but use Drive links for big documents and delete old ticket files occasionally.
- GitHub Pages (the app itself) is limited to 1 GB site size and 100 GB/month soft bandwidth; the app is under 1 MB.

## Notification server setting (v2.36)
- Team notifications ab **configurable ntfy server** use karti hain. Naya field: **Settings → Team notifications → Notification server** (default `https://ntfy.sh`).
- Kyun: kuch networks/ISPs (jaise ghar ka broadband) `ntfy.sh` ko block kar dete hain — phone par "TLS error" ya "check internet" aata hai, halanki office Wi-Fi par pehle kaam kar raha tha.
- Working public mirrors: `https://ntfy.envs.net`, `https://ntfy.adminforge.de`, `https://ntfy.mzte.de`. Server field mein daal kar **Save & send test** karein, aur phone ke ntfy app mein bhi wahi server add karein.
- **Copy subscribe link** ab usi server ka link deta hai; staff Worker bhi wahi server use karta hai (redeploy zaroori).
- Default waisa hi hai, is liye purane users ka behaviour nahi badla.

## Version
Current version: **2.69** (v2.69 modern look: narm kone, layered card shadows, ring-focus fields, frosted bottom bar, patli scrollbars; v2.68 notification failures visible + retry; v2.67 PC par mouse wheel register ke upar ho to bhi PAGE scroll hota hai; v2.66 sales register wheel/scroll fix; v2.65 sticky drawer header + quick-bar accent tweak; v2.64 new GitHub Pages link `abtravels.github.io` + relay origin allowlist for both hosts; v2.63 phone UI: bottom quick bar, chhota header, settings search, invoice section headings, labelled sale form, scroll fixes; v2.62 sales register full laptop width; v2.53 reminder times now shown as 12-hour am/pm; v2.52 Telegram reminders in the price bot; v2.50 Sale "Number of persons" field; v2.49 passenger ID alignment; v2.48 added-by names removed from Telegram notifications; v2.47 multi-city proxy + offline release checks; v2.46 route and current price on the first line of price alerts; v2.45 children/infants in Price Lookup; v2.44 WATCH_INDEX_DO Durable Object setup card + `wrangler.pricebot.toml`; v2.42–v2.43 SQLite Durable Object watch index, relay authentication, optional relay token; v2.41 stopped the every-minute KV.list; v2.40 sync of Telegram token/chat IDs/relay/Ignav proxy/OCR key; GitHub PAT and Ignav API key stay device-local).

## Price bot: KV list limit fix (v2.41)
- Cloudflare KV free plan mein **1,000 list requests/day** hoti hain. Bot ka cron har minute `KV.list` chalata tha (1,440/day), is liye ~15 ghante mein 90% usage email aa jati thi.
- Ab watches ek hi `w:index` KV key mein track hoti hain; cron sirf `get` karta hai. Pehli baar index missing ho to ek dafa `KV.list` se migrate hota hai, phir nahi. Cron `*/1 * * * *` hi rehta hai, urgent mode bhi kaam karta hai.
- `pricebot-worker.js` v2.41 redeploy karein; KV binding aur secrets wahi rahenge.

## Notifications: Telegram via Worker relay (v2.39)
- Telegram notifications ab **Worker relay** se jati hain: app → `ab-travels-ignav.umair5075.workers.dev/notify` → `api.telegram.org`.
- Kyun: kuch ISPs ghar ke broadband par `api.telegram.org` bhi block karte hain. Pehle app seedha Telegram par `no-cors` se bhejti thi — fail hone par bhi "Test bhej diya" dikhta tha aur message kahin nahi jata tha.
- Naya Settings field **Notification relay (Worker URL)** (default `https://ab-travels-ignav.umair5075.workers.dev`); khali chhorne par default use hota he.
- Relay Telegram ka response check karta hai; failed requests ko success nahi dikhata. Browser request ke liye device-local bot token zaroori hai.
- `/notify` origin aur token verify karta hai, sirf bot ke allowed team chats ko bhejta hai, aur 120/hour soft cap hai.
- **Staff portal** `PRICEBOT` service binding se relay use karta hai. Dono Workers par same `NOTIFY_KEY` secret set karein. Chat IDs synced settings se aati hain; khali hon to bot ki team use hoti hai.

## Team notifications via Telegram — ntfy removed (v2.37)
- The ntfy system (topic/server settings, ntfy.sh push) is fully removed after repeated mobile delivery problems. Telegram is now the notification channel: reliable push on every phone, no battery settings, no extra app beyond Telegram.
- New Settings card **🤖 Team notifications (Telegram)**: paste the **bot token** (from @BotFather — the same token the price bot uses) and **chat IDs** of every team member (each member messages the bot once, then copies their ID from `https://api.telegram.org/bot<TOKEN>/getUpdates`). Save & send test.
- Sends directly from the browser via the Bot API (`sendMessage`, no-cors GET) — no worker changes needed. Fires on: new sale/ticket, new Ticket Files upload, invoice saved to Ticket Files.
- `tgBotToken` is device-local and stripped from sync/backups (like the PAT and Ignav key). Leftover `ntfyTopic`/`ntfyServer`/`ntfyOn` keys are stripped from sync and deleted locally when the Telegram card is saved — this also silences the staff worker's ntfy calls (its code reads the removed topic key). Staff booking/payment notifications will need a small staff-worker update later if wanted.



## Price bot: sab se sasta indicative fare bhi dikhega (v2.38)
- `/price` replies, watch ke price updates aur alerts mein ab verified best ke ilawa **sab se sasta unverified (indicative) fare** bhi show hota hai: `💡 Sab se sasta (indicative/unverified): PKR … — booking se pehle confirm karein` — sirf tab jab wo verified best se sasta ho.
- Ye aggregator-vs-airline-direct pricing ka farq dikhata hai (masalan airarabia.com ka direct price Ignav ke verified price se sasta ho sakta hai).
- Agar kisi route par koi **verified fare hi na mile**, to `/price` ab blank message ke bajaye indicative cheapest dikhata hai warning ke saath.
- Alerts aur triggers waise hi **verified-only** hain — sirf display/labels badle hain, alert behaviour nahi.
- Worker redeploy zaroori hai: Settings → **Telegram price bot** card se naya code copy karein → Cloudflare Worker → Edit code → paste → **Deploy**.



## Telegram reminders — price bot ab alarm bhi deta hai (v2.52)
- Naya command: `/remind <kaam> <waqt>` — masalan `/remind Air Arabia: Usama ki booking 1 bje expire hogi` → team ko **12:00 aur 12:30 par alarm** (default: 1 ghanta + 30 min pehle).
- Waqt Roman Urdu mein: `1 bje` = 1 PM (1–7 baje, bina subah/raat ke, dopahar), `subah 7 bje`, `raat 11 bje`, `9:30`, `kal 1 bje`, `15 December 1 bje`, `30 min baad`, `2 ghantay baad`.
- Apne lead times: `lead=60,30,10` (comma list; `0` = event ke waqt par). `/reminds` — upcoming list · `/unremind R12` · `/unremind all`.
- Reminders quiet hours (02:00–09:00 PKT) ke doran bhi aate hain — ye explicit alarms hain.
- Storage: ek KV key `reminds`; cron har minute check karta hai, sirf fire par 1 KV write (KV.list bilkul nahi — budget-safe).
- Worker v2.52 redeploy zaroori hai (DO binding ke sath, `wrangler.pricebot.toml` recommended).



## Reminder waqt ab 12-ghantay (am/pm) mein (v2.53)
- `/remind` ke tamam messages (confirmation, alarm, `/reminds` list) ab waqt 12-ghantay ke format mein dikhate hain: `10 Nov 2026 1:00 PM PKT` (date + am/pm dono).
- Sirf display badla — reminders ka kaam waisa hi hai. Worker v2.53 redeploy zaroori hai.



## Sales register: PC par wheel hamesha PAGE scroll karta hai (v2.67)
- Masla: mouse register (Sales register grid) ke upar ho to mouse wheel pehle register ke andar ke scroll box ko pakar leta tha — page upar/neeche nahi jata tha; mouse ko register se bahar le jana parta tha.
- Ab desktop/mouse par register ka andar ka scroll box bilkul nahi banta (`@media (hover:hover) and (pointer:fine)` mein `.sheet-scroll` ka max-height hata diya gaya) — wheel ka matlab hamesha page scroll. Sticky column headers ab page ke header ke neeche chipakte hain (`top:var(--header-h)`).
- Mobile/touch par behavior nahi badla (andar ka scroll waisa hi hai). Sirf display fix — data ya save kaam par asar nahi. Worker redeploy ki zaroorat nahi.
