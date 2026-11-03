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
- Month-wise imports from Google Sheets (one file per month) via Apps Script web app
- Live sync to a private GitHub repo (`HisabData.json`) so phone and PC stay together
- Password-protected `?tkcfg=` setup links to configure another device without handwriting the token
- Manual timestamped JSON snapshots to the same private repo for known-good restores
- Excel (CSV) report: one selected month, all months in one file, or one file per month

## GitHub live sync

1. Create a private GitHub repo, for example `travel-office-hisab-backup`.
2. Create a fine-grained Personal Access Token with **Contents → Read and write** for that repo.
3. In the app: Settings → **GitHub Sync** → paste the token + repo → **Save token & sync**.
4. The latest data loads automatically (or use **Push now** / **Pull now**). Google Sheet remains only for monthly imports.

The app keeps data in `localStorage`, syncs a JSON copy to the private GitHub repo, and keeps manual backups under `backups/` in that repo.

To connect another device without handwriting the token:

1. Settings → **GitHub Sync** → enter token + repo, or use the token already saved on this device.
2. Click **Create password-protected token setup link**.
3. Choose a strong password. The link contains only the encrypted token.
4. Send the link through one channel (for example WhatsApp) and the password separately (for example a phone call or SMS).
5. On the other device, open the link, enter the password, and the token is saved there automatically.

The static app cannot enforce a password server-side; anyone with both the link and password can use the token. Delete the setup link after the new device is connected, and keep the password strong.

## Google Sheets imports

1. Put the Apps Script code (shown inside the app: Settings → Google Sheets import setup) into
   the Sheet's **Extensions → Apps Script**, then deploy as a **Web app** (execute as: me,
   access: anyone).
2. In the app: Settings → paste the deployment URL + the Sheet **File ID** → **Test import**.
3. Each month has its own Sheet file — change the File ID, then **Import**.

Google Sheets is used for monthly imports only; main app data syncs to GitHub. Old `?sync=...` share links are ignored for safety — use the password-protected token setup link instead.

## Version

Current version is shown in Settings and in the header badge. Bump `APP_VER` on every release.

## Files

- `index.html` — the whole application (HTML + CSS + JS + embedded Apps Script code)
- `logo.png` — AB Travels logo (header + favicon)
