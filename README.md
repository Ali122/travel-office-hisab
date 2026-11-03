# Travel Office Hisab â€” AB Travels

Single-file web app for a travel agency's monthly accounts. No build step, no server:
open `index.html` in any browser. The whole UI is in English.

**Live app:** https://ali122.github.io/travel-office-hisab/

## What it does

- Monthly accounts: income, expenses, ticket profit, net profit
- Tickets / Umrah bookings â€” paid / unpaid, per-month filter
- Partners: Umair & Sarmad â€” share earned, withdrawals, balance
- Father (Owner) withdrawals; Waseem commission & salary (Staff)
- Loan tracker, charity at a configurable rate (per-month override possible)
- Client pending payments (bakaya) with per-month filter
- Month-wise imports from Google Sheets (one file per month) via Apps Script web app
- Live sync to a private GitHub repo (`HisabData.json`) so phone and PC stay together
- Trusted Google sync links can auto-provision GitHub sync on devices (after Apps Script has a `GITHUB_TOKEN` script property)
- Password-protected `?tkcfg=` setup links to configure another device without handwriting the token
- Manual timestamped JSON snapshots to the same private repo for known-good restores
- Excel (CSV) report: one selected month, all months in one file, or one file per month

## GitHub live sync

1. Create a private GitHub repo, for example `travel-office-hisab-backup`.
2. Create a fine-grained Personal Access Token with **Contents â†’ Read and write** for that repo.
3. In the app: Settings â†’ **GitHub Sync** â†’ paste the token + repo â†’ **Save token & sync**.
4. The latest data loads automatically (or use **Push now** / **Pull now**). Google Sheet remains only for monthly imports.

The app keeps data in `localStorage`, syncs a JSON copy to the private GitHub repo, and keeps manual backups under `backups/` in that repo.

To connect another device without handwriting the token:

1. Settings â†’ **GitHub Sync** â†’ enter token + repo, or use the token already saved on this device.
2. Click **Create password-protected token setup link**.
3. Choose a strong password. The link contains only the encrypted token.
4. Send the link through one channel (for example WhatsApp) and the password separately (for example a phone call or SMS).
5. On the other device, open the link, enter the password, and the token is saved there automatically.

The static app cannot enforce a password server-side; anyone with both the link and password can use the token. Delete the setup link after the new device is connected, and keep the password strong.

To auto-configure trusted devices with the existing Google sync link:

1. In Apps Script paste the new code (shown in Settings).
2. In Apps Script project settings, add script property `GITHUB_TOKEN` (the same fine-grained PAT) and optionally `GITHUB_REPO`.
3. Update the existing web app deployment (same `/exec` URL).
4. A device that opens the link with `?sync=...` receives the token/repo automatically and then loads all settings/data from GitHub.

Anyone who has that Apps Script URL can request the token. Share it ONLY with people you fully trust.

## Google Sheets imports

1. Put the Apps Script code (shown inside the app: Settings â†’ Google Sheets import setup) into
   the Sheet's **Extensions â†’ Apps Script**.
2. Add Apps Script script property `GITHUB_TOKEN` (same fine-grained PAT) and optionally `GITHUB_REPO`.
3. Deploy/update as a **Web app** (execute as: me, access: anyone).
4. In the app: Settings â†’ paste the deployment URL + the Sheet **File ID** â†’ **Test import**.
5. Each month has its own Sheet file â€” change the File ID, then **Import**.
6. Use **Copy sync link** to send the trusted link to devices that should auto-import and auto-connect GitHub.

Google Sheets now also acts as the trusted bootstrap for GitHub sync: opening the link can fetch the private token from the Apps Script and save it in the browser. Anyone with that link can do the same, so share it only with people you fully trust.

## Version

Current version is shown in Settings and in the header badge. Bump `APP_VER` on every release.

## Files

- `index.html` â€” the whole application (HTML + CSS + JS + embedded Apps Script code)
- `logo.png` â€” AB Travels logo (header + favicon)

## Checking that the GitHub token is attached

Settings -> **GitHub Sync** shows a permanent badge under the token field:

- red **"No token attached"** -> GitHub sync is off
- green **"Token attached and saved on this device: ghp_...1234 • Repo: ..."** -> the token is stored in this browser (survives reloads); the token is masked, never shown in full

The badge is rebuilt on every render, so it does not disappear after saving. For a live check of the token + repo + network, press **Push now** or **Pull now** - the status line reports the real result. Sync also auto-pushes after edits and auto-pulls on load.

