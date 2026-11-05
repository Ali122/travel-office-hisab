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
Current version: **2.06** (merged friend's v2.04/v2.05 dialog + date work with Price Lookup).

## Price Lookup - Ignav (v2.11) - Cloudflare Worker proxy
- Amadeus Self-Service was decommissioned 17 July 2026 (all free keys disabled) - that integration is removed.
- New provider: Ignav (ignav.com). First 1,000 successful requests are a one-time free allowance (not monthly); after that $2 per 1,000. Failed requests are not billed. API key stays in a Cloudflare Worker proxy (browser calls are blocked by Ignav). Setup: Settings -> Flight prices - Ignav -> copy worker code -> deploy on Cloudflare -> set IGNAV_API_KEY secret -> paste Worker URL.
- Price Lookup tab: one-way, round-trip and multi-city (2 legs), airport autocomplete, adults, cabin class, non-stop, market (PKR/AED/SAR/GBP/USD/INR/QAR), max results; results show airline + flight number, times, duration, stops/via airports and price, with Copy fare and Book/links.
- Security: the Ignav API key is stripped from backup files, GitHub sync payloads, undo snapshots and share links (same treatment as the GitHub PAT); it stays on the device and survives restores.

## Price Lookup fix (v2.08): Ignav requires a server proxy
- Cause of 'check connection': Ignav's API is not callable from browser JavaScript (key must stay server-side). Direct calls fail.
- Fix: one-click Cloudflare Worker proxy code inside Settings (free plan). Worker adds the key server-side and exposes /health, /fares, /round-trip, /booking-links with CORS.
