/* Behaviour checks for the price bot and the staff worker.
   Runs in Node or in a headless browser; nothing here talks to a real service. */
(function () {
  var W = globalThis.__worker;
  var S = globalThis.__staff;
  var results = [];
  globalThis.__results = results;

  function log(name, pass, detail) {
    results.push({ name: name, pass: !!pass, detail: String(detail) });
  }

  function finish() {
    if (globalThis.document) {
      var pre = document.getElementById("out");
      if (pre) pre.textContent = JSON.stringify(results);
      document.title = "DONE";
    }
  }

  var now = Date.now();
  var SENT = globalThis.__sent || (globalThis.__sent = []);

  function pktIsoOf(ms) { return new Date(ms + 5 * 3600 * 1000).toISOString(); }
  function show(ms) { return ms ? pktIsoOf(ms).slice(0, 16) : "null"; }

  /* ---- fake Durable Object (serializes requests like the real one) ---- */
  function makeDO() {
    var store = new Map();
    var queue = Promise.resolve();
    var storage = {
      get: function (k) { return Promise.resolve(store.has(k) ? store.get(k) : undefined); },
      put: function (k, v) { store.set(k, v); return Promise.resolve(); },
      del: function (k) { store.delete(k); return Promise.resolve(); },
      list: function (o) {
        var prefix = (o && o.prefix) || "";
        var m = new Map();
        store.forEach(function (v, k) { if (k.indexOf(prefix) === 0) m.set(k, v); });
        return Promise.resolve(m);
      }
    };
    var obj = {
      state: { storage: storage, blockConcurrencyWhile: function () { return Promise.resolve(); } },
      fetch: function (request) {
        var run = queue.then(function () { return handle(request); });
        queue = run.then(function () {}, function () {});
        return run;
      }
    };
    function handle(request) {
      return request.json().then(function (b) {
        function ok(data) { return new Response(JSON.stringify(data), { status: 200 }); }
        if (b.action === "remind-list") {
          return storage.list({ prefix: "remind:" }).then(function (items) {
            return ok(Array.from(items.values()));
          });
        }
        if (b.action === "remind-add") {
          var rem = (b.payload && b.payload.reminder) || null;
          if (!rem || !rem.id) return new Response(JSON.stringify({ ok: false }), { status: 400 });
          return storage.list({ prefix: "remind:" }).then(function (items) {
            if (items.size >= 60) return ok({ ok: false, full: true });
            return storage.put("remind:" + rem.id, rem).then(function () { return ok({ ok: true }); });
          });
        }
        if (b.action === "remind-remove") {
          return storage.del("remind:" + ((b.payload && b.payload.id) || "")).then(function () { return ok({ ok: true }); });
        }
        if (b.action === "remind-replace") {
          var repl = (b.payload && Array.isArray(b.payload.list)) ? b.payload.list : [];
          return storage.list({ prefix: "remind:" }).then(function (items) {
            var chain = Promise.resolve();
            items.forEach(function (_, key) { chain = chain.then(function () { return storage.del(key); }); });
            repl.slice(0, 60).forEach(function (r) {
              chain = chain.then(function () { return storage.put("remind:" + r.id, r); });
            });
            return chain.then(function () { return ok({ ok: true }); });
          });
        }
        if (b.action === "remind-clear") {
          return storage.list({ prefix: "remind:" }).then(function (items) {
            var chain = Promise.resolve();
            items.forEach(function (_, key) { chain = chain.then(function () { return storage.del(key); }); });
            return chain.then(function () { return ok({ ok: true, removed: items.size }); });
          });
        }
        if (b.action === "remind-claim") {
          var t = Date.now();
          return storage.list({ prefix: "remind:" }).then(function (items) {
            var fired = [];
            var chain = Promise.resolve();
            items.forEach(function (r) {
              chain = chain.then(function () {
                var pending = false;
                var slots = [];
                (r.slots || []).forEach(function (s) {
                  if (s.done) { slots.push(s); return; }
                  if (s.at > t) { pending = true; slots.push(s); return; }
                  s.done = true;
                  slots.push(s);
                  fired.push({ id: r.id, text: r.text, event: r.event, rel: r.rel, slot: s });
                });
                if (pending) return storage.put("remind:" + r.id, Object.assign({}, r, { slots: slots }));
                return storage.del("remind:" + r.id);
              });
            });
            return chain.then(function () { return ok({ fired: fired }); });
          });
        }
        if (b.action === "add" || b.action === "remove") {
          var key = String(b.key || "");
          if (!/^w:[^:]+:[^:]+$/.test(key)) return new Response(JSON.stringify({ error: "key" }), { status: 400 });
          if (b.action === "add") return storage.put("watch:" + key, true).then(function () { return ok({ ok: true }); });
          return storage.del("watch:" + key).then(function () { return ok({ ok: true }); });
        }
        return storage.list({ prefix: "watch:" }).then(function (keys) {
          return ok(Array.from(keys.keys()).map(function (k) { return k.slice(6); }));
        });
      });
    }
    return { obj: obj, store: store };
  }

  function makeKV() {
    var d = {};
    return {
      d: d,
      get: function (k) { return Promise.resolve(d[k] == null ? null : d[k]); },
      put: function (k, v) { d[k] = v; return Promise.resolve(); },
      list: function () { return Promise.resolve({ keys: [] }); }
    };
  }

  function envWithDO() {
    var doh = makeDO();
    var stub = {
      idFromName: function (n) { return n; },
      get: function () { return { fetch: function (u, o) { return doh.obj.fetch(new Request(u, o)); } }; }
    };
    return { env: { KV: makeKV(), WATCH_INDEX_DO: stub, TELEGRAM_BOT_TOKEN: "x" }, doh: doh };
  }

  (async function () {
    try {
      /* =============== time parsing =============== */
      var r = W.parseEventWhen("Air Arabia booking 1 bje expire hogi");
      log("1 bje = 1 PM (13:00)", r && pktIsoOf(r.event).slice(11, 16) === "13:00", show(r && r.event));

      r = W.parseEventWhen("Meeting kal raat 10 bje");
      var expDay = W.addDaysIso(W.pktToday(), 1);
      log("kal raat 10 bje = TOMORROW 22:00",
        r && pktIsoOf(r.event).slice(0, 10) === expDay && pktIsoOf(r.event).slice(11, 16) === "22:00",
        "got " + show(r && r.event) + " expected " + expDay + "T22:00");

      r = W.parseEventWhen("Flight raat 12 bje");
      log("raat 12 bje = 00:00 midnight", r && pktIsoOf(r.event).slice(11, 16) === "00:00", show(r && r.event));

      r = W.parseEventWhen("Report subah 7 bje");
      log("subah 7 bje = 07:00", r && pktIsoOf(r.event).slice(11, 16) === "07:00", show(r && r.event));

      r = W.parseEventWhen("Dinner shaam 7 bje");
      log("shaam 7 bje = 19:00", r && pktIsoOf(r.event).slice(11, 16) === "19:00", show(r && r.event));

      r = W.parseEventWhen("Call Sarmad 30 min baad");
      log("30 min baad = relative ~30min", r && r.rel === true && Math.abs((r.event - now) - 1800000) < 5000, show(r && r.event));

      r = W.parseEventWhen("Submit 2 ghantay baad");
      log("2 ghantay baad = relative ~120min", r && r.rel === true && Math.abs((r.event - now) - 7200000) < 5000, show(r && r.event));

      r = W.parseEventWhen("Trip 15 December 1 bje");
      log("15 December 1 bje = 2026-12-15 13:00",
        r && pktIsoOf(r.event).slice(0, 10) === "2026-12-15" && pktIsoOf(r.event).slice(11, 16) === "13:00",
        show(r && r.event));

      r = W.parseEventWhen("Report 9:30");
      log("9:30 = 09:30", r && pktIsoOf(r.event).slice(11, 16) === "09:30", show(r && r.event));

      r = W.parseEventWhen("Call at 3:30 pm");
      log("3:30 pm = 15:30", r && pktIsoOf(r.event).slice(11, 16) === "15:30", show(r && r.event));

      r = W.parseEventWhen("Meeting 12 bje");
      log("12 bje (no marker) = 12:00 PM noon", r && pktIsoOf(r.event).slice(11, 16) === "12:00", show(r && r.event));

      /* =============== formatting =============== */
      var t1 = W.pktEventText(Date.parse("2026-11-10T13:00:00+05:00"));
      log("pktEventText single PKT", (t1.match(/PKT/g) || []).length === 1, JSON.stringify(t1));

      /* =============== reminder storage =============== */
      var A = envWithDO();
      SENT.length = 0;
      await W.cmdRemind(A.env, "1", ["Air", "Arabia", "booking", "1", "bje"], {});
      var conf = SENT[0] || "";
      log("confirmation no 'PKT PKT'", conf.indexOf("PKT PKT") < 0, JSON.stringify(conf.slice(0, 240)));
      var aList = await W.readReminds(A.env);
      log("confirmation stored a reminder", aList.length === 1, "count=" + aList.length);

      /* concurrent adds */
      var B = envWithDO();
      SENT.length = 0;
      await Promise.all([
        W.cmdRemind(B.env, "1", ["Alpha", "1", "bje"], {}),
        W.cmdRemind(B.env, "1", ["Beta", "2", "bje"], {}),
        W.cmdRemind(B.env, "1", ["Gamma", "3", "bje"], {})
      ]);
      var stored = await W.readReminds(B.env);
      log("3 concurrent reminders ALL stored", stored.length === 3,
        "stored=" + stored.length + " " + JSON.stringify(stored.map(function (x) { return x.text; })));

      /* cron claim must not wipe a concurrently added reminder */
      var C = envWithDO();
      await W.writeReminds(C.env, [{
        id: "R1", chat: "1", text: "old", event: Date.now() - 1000, rel: false,
        slots: [{ lead: 0, at: Date.now() - 1000, done: false }], createdAt: Date.now()
      }]);
      SENT.length = 0;
      await Promise.all([
        W.checkReminders(C.env),
        W.cmdRemind(C.env, "1", ["New", "5", "bje"], {})
      ]);
      var afterC = await W.readReminds(C.env);
      log("cron claim keeps concurrently added reminder", afterC.some(function (x) { return x.text.indexOf("New") === 0; }),
        JSON.stringify(afterC.map(function (x) { return x.text; })));

      /* fired message */
      var D = envWithDO();
      await W.writeReminds(D.env, [{
        id: "R1", chat: "1", text: "test", event: Date.now() - 1000, rel: false,
        slots: [{ lead: 0, at: Date.now() - 1000, done: false }], createdAt: Date.now()
      }]);
      SENT.length = 0;
      await W.checkReminders(D.env);
      var firedMsg = SENT[0] || "";
      log("fired reminder no 'PKT PKT'", firedMsg.indexOf("PKT PKT") < 0, JSON.stringify(firedMsg.slice(0, 200)));

      /* fires exactly once */
      var E = envWithDO();
      await W.writeReminds(E.env, [{
        id: "R2", chat: "1", text: "once", event: Date.now() - 1000, rel: false,
        slots: [{ lead: 0, at: Date.now() - 1000, done: false }], createdAt: Date.now()
      }]);
      SENT.length = 0;
      await W.checkReminders(E.env);
      await W.checkReminders(E.env);
      log("reminder fires exactly once", SENT.length === 1, "sent=" + SENT.length);

      /* event soon still schedules */
      var F = envWithDO();
      var soon = new Date(Date.now() + 21 * 60000);
      var hh = String(soon.getUTCHours() + 5).padStart(2, "0");
      var mm = String(soon.getUTCMinutes()).padStart(2, "0");
      SENT.length = 0;
      await W.cmdRemind(F.env, "1", ["Call " + hh + ":" + mm + " bje"], {});
      var soonList = await W.readReminds(F.env);
      log("event 21min away still schedules a reminder", soonList.length === 1,
        "stored=" + soonList.length + " msg=" + JSON.stringify((SENT[0] || "").slice(0, 140)));

      /* unremind removes one */
      var G = envWithDO();
      await W.cmdRemind(G.env, "1", ["Keep", "1", "bje"], {});
      await W.cmdRemind(G.env, "1", ["Drop", "2", "bje"], {});
      var glist = await W.readReminds(G.env);
      var drop = glist.filter(function (x) { return x.text.indexOf("Drop") === 0; })[0] || {};
      SENT.length = 0;
      await W.cmdUnremind(G.env, "1", drop.id);
      var gleft = await W.readReminds(G.env);
      log("unremind removes only the target", gleft.length === 1 && gleft[0].text.indexOf("Keep") === 0,
        JSON.stringify(gleft.map(function (x) { return x.text; })));

      /* unremind all */
      var H = envWithDO();
      await W.cmdRemind(H.env, "1", ["One", "1", "bje"], {});
      await W.cmdRemind(H.env, "1", ["Two", "2", "bje"], {});
      SENT.length = 0;
      await W.cmdUnremind(H.env, "1", "all");
      var hleft = await W.readReminds(H.env);
      log("unremind all clears all", hleft.length === 0, JSON.stringify(hleft));

      /* list message */
      var I = envWithDO();
      await W.writeReminds(I.env, [{
        id: "R5", chat: "1", text: "upcoming", event: Date.now() + 3600000, rel: false,
        slots: [{ lead: 60, at: Date.now() + 3000000, done: false }], createdAt: Date.now()
      }]);
      SENT.length = 0;
      await W.cmdReminds(I.env, "1");
      var listMsg = SENT[0] || "";
      log("/reminds list no 'PKT PKT'", listMsg.indexOf("PKT PKT") < 0, JSON.stringify(listMsg.slice(0, 180)));

      log("hhmm12 00:00 = 12 AM", W.hhmm12("00:00") === "12:00 AM", W.hhmm12("00:00"));
      log("hhmm12 12:00 = 12 PM", W.hhmm12("12:00") === "12:00 PM", W.hhmm12("12:00"));
      var leads = W.parseLeads({ lead: "30,60,30,0" });
      log("parseLeads = [60,30,0]", JSON.stringify(leads) === "[60,30,0]", JSON.stringify(leads));

      /* staff worker: passenger IDs stay aligned */
      var inv = S.invoiceData({
        docType: "ticket", pax: 3, paxNames: ["Ali", "Sara", "Bilal"], paxNics: ["111", "", "333"],
        name: "Ali", nic: "111", pnr: "ABC123", from: "KHI", to: "DXB", date: "2026-12-15",
        time: "10:00", sale: 100000, received: 100000
      }).invoice;
      log("staff invoice keeps blank NIC slot", JSON.stringify(inv.paxNics) === JSON.stringify(["111", "", "333"]),
        JSON.stringify(inv.paxNics));
    } catch (e) {
      log("check chain crashed", false, (e && e.stack) || String(e));
    }
    finish();
  })();
})();
