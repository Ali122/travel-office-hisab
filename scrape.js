/**
 * Sasta Ticket route-price scraper.
 *
 * Runs in GitHub Actions with Playwright Chromium because sastaticket.pk is
 * behind an AWS WAF challenge. Saves the route-level "from PKR ..." price in
 * data/sasta/<origin>-<destination>.json for the Travel Office Hisab app.
 *
 * This is deliberately small and polite:
 *  - only the configured top routes
 *  - public SEO pages only
 *  - one request per route per run, with a short delay
 *  - no login, no CAPTCHA bypass, no booking flow
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const OUT_DIR = path.join(__dirname, "data", "sasta");
const BASE = "https://www.sastaticket.pk/flights/cheap-flights-from-";
const UA = "ABTravelsPriceBot/1.0 (+https://ali122.github.io/travel-office-hisab/)";

// Keep this list small. Each route is one page load.
const ROUTES = [
  { from: "KHI", to: "DXB", fromSlug: "karachi", toSlug: "dubai" },
  { from: "LHE", to: "DXB", fromSlug: "lahore", toSlug: "dubai" },
  { from: "ISB", to: "DXB", fromSlug: "islamabad", toSlug: "dubai" },
  { from: "KHI", to: "JED", fromSlug: "karachi", toSlug: "jeddah" },
  { from: "LHE", to: "JED", fromSlug: "lahore", toSlug: "jeddah" },
  { from: "MUX", to: "DXB", fromSlug: "multan", toSlug: "dubai" },
  { from: "KHI", to: "LHE", fromSlug: "karachi", toSlug: "lahore" },
  { from: "KHI", to: "ISB", fromSlug: "karachi", toSlug: "islamabad" },
  { from: "LHE", to: "KHI", fromSlug: "lahore", toSlug: "karachi" },
  { from: "ISB", to: "KHI", fromSlug: "islamabad", toSlug: "karachi" },
  { from: "KHI", to: "PEW", fromSlug: "karachi", toSlug: "peshawar" },
  { from: "KHI", to: "DOH", fromSlug: "karachi", toSlug: "doha" },
  { from: "KHI", to: "AUH", fromSlug: "karachi", toSlug: "abu-dhabi" },
  { from: "KHI", to: "SHJ", fromSlug: "karachi", toSlug: "sharjah" },
  { from: "KHI", to: "RUH", fromSlug: "karachi", toSlug: "riyadh" },
  { from: "KHI", to: "MED", fromSlug: "karachi", toSlug: "madinah" }
];

function fileFor(route) {
  return path.join(OUT_DIR, (route.from + "-" + route.to).toLowerCase() + ".json");
}

function extractPrice(text) {
  const t = String(text || "").replace(/\u00a0/g, " ");
  const patterns = [
    /Cheap Flights from[\s\S]{0,160}?\(PKR\s*([\d,]+)\)/i,
    /cheapest one-way[\s\S]{0,180}?PKR\s*([\d,]+)/i,
    /fare starts from\s*PKR\s*([\d,]+)/i,
    /from\s*PKR\s*([\d,]+)/i
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) return Number(String(m[1]).replace(/,/g, ""));
  }
  return 0;
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "en-PK",
    timezoneId: "Asia/Karachi",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  });
  const results = [];
  const errors = [];

  for (const route of ROUTES) {
    const url = BASE + route.fromSlug + "-to-" + route.toSlug;
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40000 });
      // WAF/JS route pages may need a moment. Do not try to solve a CAPTCHA.
      await page.waitForTimeout(2500);
      let heading = "";
      try { heading = await page.locator("h1").first().innerText({ timeout: 10000 }); } catch (e) {}
      let amount = extractPrice(heading);
      if (!amount) {
        let body = "";
        try { body = await page.locator("body").innerText({ timeout: 10000 }); } catch (e) {}
        amount = extractPrice(body);
      }
      if (!amount) throw new Error("price not found on page");
      const out = {
        v: 1,
        provider: "sasta",
        origin: route.from,
        destination: route.to,
        currency: "PKR",
        amount: amount,
        price_basis: "per_person",
        taxes_included: null,
        fare_breakdown: null,
        source_url: url,
        observed_at: new Date().toISOString(),
        headline: heading.replace(/\s+/g, " ").trim().slice(0, 240)
      };
      writeJson(fileFor(route), out);
      results.push({ origin: route.from, destination: route.to, amount: amount, file: "data/sasta/" + path.basename(fileFor(route)) });
      console.log(route.from + "-" + route.to + ": PKR " + amount);
    } catch (err) {
      const msg = String((err && err.message) || err).slice(0, 240);
      errors.push({ origin: route.from, destination: route.to, error: msg });
      console.error(route.from + "-" + route.to + ": " + msg);
      // Keep the last known good file if one exists.
    } finally {
      await page.close().catch(() => {});
      await new Promise((r) => setTimeout(r, 900));
    }
  }

  writeJson(path.join(OUT_DIR, "index.json"), {
    v: 1,
    provider: "sasta",
    observed_at: new Date().toISOString(),
    results: results,
    errors: errors
  });
  await browser.close();
  console.log("Sasta scrape done. OK=" + results.length + " Failed=" + errors.length);
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
