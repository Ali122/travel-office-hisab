# AB Travels â€” Staff Portal

A separate, password-protected Cloudflare Worker for staff. It reads and writes the same
private `HisabData.json` file used by the owner app, so no second database is needed.

Staff can:

- see and add **partial payments** on receivables and unpaid tickets
- view all clients, add clients and edit client details (no delete)
- create their own bookings (cost and profit are hidden)
- create **ticket or Umrah invoices for any client**, save them and print/save as PDF (cost and profit are hidden)
- print/share invoices for **their own** bookings only
- use PNR Lookup

Staff cannot see cost, profit, expenses, partners, Father withdrawals, loans, settings,
airline IDs, the GitHub token, backups or other staff data.

## 1. Install

```powershell
cd staff-worker
npm.cmd install
npx.cmd wrangler login
```

> On Windows, the `.cmd` suffix avoids PowerShell's script execution policy blocking
> `npm.ps1` / `npx.ps1`.

## 2. GitHub token

Create a **fine-grained personal access token** for the private backup repository:

- Repository: `abtravels/travel-office-hisab-backup`
- Permission: **Contents â€” Read and write**

Do not paste the token into any file in this repository.

## 3. Worker secrets

Run these from the `staff-worker` folder. Wrangler asks for the value interactively;
nothing is saved in the repo.

```powershell
npx.cmd wrangler secret put STAFF_PASSWORD
npx.cmd wrangler secret put GITHUB_TOKEN
```

Optional but recommended â€” a random string, for example 32+ characters:

```powershell
npx.cmd wrangler secret put SESSION_SECRET
```

- `STAFF_PASSWORD` â€” the password staff type on the login screen.
- `SESSION_SECRET` â€” signs the session cookie. If omitted, `STAFF_PASSWORD` is used.
- Changing either secret invalidates all existing staff sessions.
- Repository defaults are `abtravels/travel-office-hisab-backup` and branch `main`.
  Override with `GITHUB_REPO` / `GITHUB_BRANCH` if needed.

## 4. Deploy

```powershell
npm.cmd run deploy
```

The Worker name is `staff-abtravels`, so the URL will look like:

```
https://staff-abtravels.<your-subdomain>.workers.dev
```

Open the URL, enter the staff password, and test:

1. Pending Payments â†’ add a small partial payment
2. Clients â†’ search, edit, add a client
3. New Booking â†’ save an unpaid booking
4. My Invoices â†’ print a saved invoice
5. New Invoice â†’ create a ticket or Umrah invoice, save it, then open/print it
6. PNR Lookup â†’ open an airline page

Then open the owner app and press **Pull now** (or reload) to confirm the payment and
booking appear in `HisabData.json`.

## Local development

```powershell
npm.cmd run dev
```

Use a `.dev.vars` file for local secrets (it is not committed):

```
STAFF_PASSWORD=local-test-password
GITHUB_TOKEN=github_pat_xxx
SESSION_SECRET=local-random-string
```

## How writes work

- Every write reads the current file from GitHub with its `sha`, applies the change,
  and writes it back. If the owner app wrote at the same time, the Worker retries
  on a `409`/`422` conflict (up to 3 attempts).
- Receivable payment: appended to the receivable's `payments[]`.
- Ticket payment: appended to the ticket's `payments[]`; `paid: true` is set when the
  received total reaches the sale amount.
- Only tickets explicitly marked `paid: false` are treated as unpaid, matching the
  owner app.
- Staff bookings are stored with `createdBy: "staff"`, `staffBooking: true`,
  `cost: 0` and `payments: []`. The owner should add the real cost later.
- Staff invoices are appended to `invoices[]` with `createdBy: "staff"` and the same
  `d` layout the owner app uses, so they open and print in the owner app too. The staff
  portal only returns staff-created invoices; owner invoices stay hidden.
- Saving an invoice also sends a Telegram notification through the bot relay when
  notifications are enabled.
- Login is rate-limited to 8 attempts per minute per IP. Sessions last 12 hours and
  use an `HttpOnly`, `Secure`, `SameSite=Lax` cookie.

## Security notes

- Never commit `STAFF_PASSWORD`, `GITHUB_TOKEN`, `SESSION_SECRET` or `.dev.vars`.
- Use a long, unique staff password. Share the portal link only with staff.
- If a device is lost, change `STAFF_PASSWORD` â€” all sessions are logged out.
- The staff browser never receives the GitHub token. GitHub is called only by the Worker.

## Rollback

```powershell
npx.cmd wrangler rollback
```
