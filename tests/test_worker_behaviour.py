"""Reminder/price-bot behaviour checks.

The worker is plain JavaScript, so the checks run inside a JavaScript engine.
Node is used when available; otherwise a headless Chrome/Edge is used. If no
engine is available the suite is skipped instead of failing the release.

Nothing here contacts Telegram, Ignav or Cloudflare, and no booking, payment
or reminder is created for real - the KV and Durable Object are in-memory fakes.
"""
import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKER = ROOT / "pricebot-worker.js"
STAFF = ROOT / "staff-worker" / "src" / "index.js"
DRIVER = ROOT / "tests" / "worker_checks.js"

BROWSERS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
]

WORKER_EXPORTS = ("parseEventWhen", "pktEventText", "parseLeads", "pktToday", "addDaysIso",
                  "hhmm12", "cmdRemind", "cmdReminds", "cmdUnremind", "checkReminders",
                  "readReminds", "writeReminds")


def find_node():
    for name in ("node", "nodejs"):
        path = shutil.which(name)
        if path:
            return path
    return None


def find_browser():
    for path in BROWSERS:
        if Path(path).exists():
            return path
    return None


def replace_function(src, name, new_text):
    """Replace a whole function definition (brace matched)."""
    match = re.search(r"(?:async\s+)?function\s+%s\s*\(" % re.escape(name), src)
    if not match:
        raise RuntimeError("function %s not found" % name)
    start = match.start()
    brace = src.index("{", match.end() - 1)
    depth = 0
    i = brace
    while i < len(src):
        ch = src[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    return src[:start] + new_text + src[i + 1:]


def worker_source():
    src = WORKER.read_text(encoding="utf-8")
    src = src.replace("export class WatchIndex", "class WatchIndex")
    src = src.replace("export default", "const worker =")
    # capture outgoing messages instead of sending them
    src = replace_function(src, "send",
                           'async function send(env, chat, html, extra) {'
                           ' globalThis.__sent.push(html); return true; }')
    src = replace_function(src, "notifyAll",
                           'async function notifyAll(env, html, extra) {'
                           ' globalThis.__sent.push(html); return ["1"]; }')
    return src


def staff_source():
    src = STAFF.read_text(encoding="utf-8")
    return src.replace("export default", "const worker =")


def run_with_node(node):
    with tempfile.TemporaryDirectory() as tmp:
        worker_file = Path(tmp) / "pricebot-worker.js"
        staff_file = Path(tmp) / "staff-index.js"
        worker_file.write_text(worker_source(), encoding="utf-8")
        staff_file.write_text(staff_source(), encoding="utf-8")
        runner = Path(tmp) / "run.mjs"
        runner.write_text(
            "import fs from 'node:fs';\n"
            "globalThis.__sent = [];\n"
            "const wsrc = fs.readFileSync(process.argv[2], 'utf8');\n"
            "const ssrc = fs.readFileSync(process.argv[3], 'utf8');\n"
            "const driver = fs.readFileSync(process.argv[4], 'utf8');\n"
            "globalThis.__worker = new Function(wsrc + '\\nreturn {%s};')();" % ", ".join(WORKER_EXPORTS) + "\n"
            "globalThis.__staff = new Function(ssrc + '\\nreturn {invoiceData};')();\n"
            + driver + "\n"
            + "setTimeout(function(){ process.stdout.write(JSON.stringify(globalThis.__results || [])); }, 1500);\n",
            encoding="utf-8",
        )
        proc = subprocess.run(
            [node, str(runner), str(worker_file), str(staff_file), str(DRIVER)],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180,
        )
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr[-3000:])
        return json.loads(proc.stdout)


def run_with_browser(browser):
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "checks.html"
        page.write_text(
            "<!doctype html><meta charset='utf-8'><body><pre id='out'>running</pre>\n"
            "<script>\n"
            "globalThis.__sent = [];\n"
            "globalThis.__worker = (function(){\n" + worker_source() + "\n"
            "return { %s };\n})();\n" % ", ".join(WORKER_EXPORTS) +
            "</script>\n"
            "<script>\n"
            "globalThis.__staff = (function(){\n" + staff_source() + "\n"
            "return { invoiceData };\n})();\n"
            "</script>\n"
            "<script>\n"
            + DRIVER.read_text(encoding="utf-8") +
            "\n</script></body>",
            encoding="utf-8",
        )
        proc = subprocess.run(
            [browser, "--headless=new", "--disable-gpu", "--no-sandbox",
             "--virtual-time-budget=25000", "--dump-dom", page.as_uri()],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=240,
        )
        html = proc.stdout
        start = html.find("<pre id=\"out\">")
        end = html.find("</pre>")
        if start < 0 or end < 0:
            raise RuntimeError("no results in browser output")
        payload = html[start + len("<pre id=\"out\">"):end]
        if "[" not in payload:
            raise RuntimeError("checks did not finish")
        return json.loads(payload)


class WorkerBehaviourChecks(unittest.TestCase):
    results = None
    error = None

    @classmethod
    def setUpClass(cls):
        node = find_node()
        browser = None if node else find_browser()
        if not node and not browser:
            cls.error = "no JavaScript engine available"
            return
        try:
            cls.results = run_with_node(node) if node else run_with_browser(browser)
        except Exception as exc:  # pragma: no cover - environment dependent
            cls.error = str(exc)

    def test_no_failures(self):
        if self.error:
            self.skipTest("JavaScript checks skipped: %s" % self.error)
        self.assertTrue(self.results, "no check results")
        failed = [r for r in self.results if not r.get("pass")]
        self.assertFalse(
            failed,
            "failed checks: " + "; ".join("%s (%s)" % (r.get("name"), r.get("detail")) for r in failed),
        )

    def test_all_checks_ran(self):
        if self.error:
            self.skipTest("JavaScript checks skipped: %s" % self.error)
        self.assertGreaterEqual(len(self.results), 25)


if __name__ == "__main__":
    unittest.main()
