# Travel Office Hisab — AB Travels

Single-file web app for a travel agency's monthly accounts. No build step, no server:
open `index.html` in any browser.

**Live app:** https://ali122.github.io/travel-office-hisab/

## What it does

- Monthly accounts: income, expenses, ticket profit, net
- Tickets (Umair / Umrah bookings) — paid / unpaid, per-month filter
- Partners: Umair & Sarmad — share earned ("bana"), withdrawals ("liya"), balance
- Abbu withdrawals, Waseem commission & salary
- Qarza (loan) tracker, charity (sadqa) at a configurable rate
- Bakaya (client pending payments) with per-month filter
- Month-wise import from a Google Sheet (one file per month) via Apps Script web app
- Sync to Google Sheets (`HisabData` cell) so phone and PC stay together

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
