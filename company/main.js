/* AB Travels — language toggle, WhatsApp links, quote form.
   No backend, no storage: the form only builds a WhatsApp message. */
(function () {
  "use strict";

  var WA_NUMBER = "923143176560";
  var WA_BASE = "https://wa.me/" + WA_NUMBER;
  var STORE_KEY = "abt-lang";

  var EN = {
    title: "AB Travels — Air Tickets, Umrah Packages & Visa Services",
    desc: "AB Travels (Ahmed Brothers Travels) books domestic and international air tickets, Umrah and Hajj packages, visa files, hotels and tours. Send your route on WhatsApp and get clear fares the same day.",
    waText: "Assalam o Alaikum AB Travels!\nI would like a quote.\nRoute:\nDates:\nPassengers:",
    "a11y.skip": "Skip to content",
    "brand.sub": "Ahmed Brothers Travels",
    "nav.services": "Services",
    "nav.why": "Why us",
    "nav.how": "How it works",
    "nav.contact": "Contact",
    "cta.wa": "WhatsApp",
    "cta.quote": "Get a quote on WhatsApp",
    "cta.quote2": "Message us on WhatsApp",
    "cta.call": "Call now",

    "hero.eyebrow": "Air tickets · Umrah · Visa · Tours",
    "hero.h1": "Tickets, Umrah and visas — sorted without the runaround.",
    "hero.lead": "Send us your route and dates on WhatsApp. We compare fares, share clear options, and hand over a proper e-ticket with an invoice — usually the same day.",
    "hero.chip1": "Same-day quotes",
    "hero.chip2": "Family & group bookings",
    "hero.chip3": "Visa file support",

    "pass.tag": "Umrah · Return",
    "pass.from": "Karachi",
    "pass.to": "Jeddah",
    "pass.pax": "Passengers",
    "pass.paxv": "2 adults",
    "pass.fare": "Fare",
    "pass.farev": "Ask today",
    "pass.bag": "Baggage",
    "pass.note": "Sample route — tell us yours and we’ll quote it.",

    "services.kicker": "What we do",
    "services.h2": "Everything for one trip, in one place",
    "services.lead": "One team for the ticket, the visa file, the hotel and the airport pickup — so you are not chasing three different people.",
    "s1.t": "Air tickets",
    "s1.d": "Domestic and international, one-way or return. We compare airlines and quote the total — no hidden add-ons.",
    "s2.t": "Umrah & Hajj",
    "s2.d": "Ticket, visa, hotel and transport in one package — with family and group options.",
    "s3.t": "Visa services",
    "s3.d": "Tourist, visit, family and student files. We check documents, guide the form and track appointments.",
    "s4.t": "Hotel booking",
    "s4.d": "Makkah, Madinah and worldwide stays — near-Haram options for every budget.",
    "s5.t": "Tours & transport",
    "s5.d": "Airport transfers, city tours and custom family itineraries.",
    "s6.t": "Group & family tickets",
    "s6.d": "Wedding groups, corporate travel and student groups — seats held together.",

    "why.kicker": "Why AB Travels",
    "why.h2": "Straight answers, no runaround",
    "w1": "Fares compared across airlines",
    "w1d": "We don’t quote the first fare we see — we check a few and tell you the difference.",
    "w2": "Everything on WhatsApp",
    "w2d": "No app, no login, no office visit needed. Your chat is your file.",
    "w3": "Paperwork, sorted",
    "w3d": "Document checklist, form filling and appointment reminders for visa files.",
    "w4": "Invoice with every booking",
    "w4d": "A clear invoice for company claims and visa files — not just a ticket screenshot.",
    "wc.k": "Fastest way",
    "wc.t": "One message with route, dates and passengers is enough to start.",
    "wc.or": "or call",

    "how.kicker": "How it works",
    "how.h2": "Three steps and you’re flying",
    "h1t": "Tell us the plan",
    "h1d": "Route, dates and passengers — a WhatsApp message is enough. Visa files can be sent as photos.",
    "h2t": "Get clear options",
    "h2d": "Two or three fares with the total price, baggage allowance and timings written out.",
    "h3t": "Confirm and fly",
    "h3d": "Pay, receive your e-ticket and invoice, and we stay on chat until you land.",

    "contact.kicker": "Contact",
    "contact.h2": "Send your route, get a fare",
    "contact.lead": "WhatsApp is fastest. Calls and email work too.",
    "c.wa": "WhatsApp",
    "c.waNote": "Fastest — send route and dates",
    "c.phone1": "Mobile",
    "c.phone2": "Alternate number",
    "c.email": "Email",
    "c.hoursT": "Timing",
    "c.hours": "Message anytime — we reply during business hours, 7 days a week.",

    "form.t": "Quick quote request",
    "form.note": "This opens WhatsApp with your details filled in. Nothing is stored on this website.",
    "form.name": "Your name",
    "form.phone": "Mobile number",
    "form.service": "Service",
    "opt.air": "Air ticket",
    "opt.umrah": "Umrah / Hajj package",
    "opt.visa": "Visa services",
    "opt.hotel": "Hotel booking",
    "opt.tour": "Tour / transport",
    "opt.other": "Something else",
    "form.details": "Trip details",
    "form.ph": "e.g. Karachi to Jeddah, 20 Nov, 2 adults",
    "form.submit": "Send on WhatsApp",
    "form.sent": "WhatsApp is opening — press send there.",
    "form.err": "Please add your name and a valid mobile number.",

    "footer.about": "Air tickets, Umrah and Hajj packages, visa files, hotels and tours.",
    "footer.links": "Quick links",
    "footer.contact": "Contact",
    "footer.rights": "All rights reserved.",

    msgName: "Name",
    msgPhone: "Mobile",
    msgService: "Service",
    msgDetails: "Details",
    msgGreeting: "Assalam o Alaikum AB Travels!"
  };

  var UR = {
    title: "اے بی ٹریولز — ایئر ٹکٹ، عمرہ پیکج اور ویزا سروسز",
    desc: "اے بی ٹریولز گھریلو اور بین الاقوامی ایئر ٹکٹ، عمرہ و حج پیکج، ویزا فائل، ہوٹل اور ٹورز کا کام کرتا ہے۔ اپنا روٹ واٹس ایپ پر بھیجیں اور اسی دن صاف ریٹ حاصل کریں۔",
    waText: "السلام علیکم اے بی ٹریولز!\nمجھے ریٹ چاہیے۔\nروٹ:\nتاریخ:\nمسافر:",
    "a11y.skip": "مواد پر جائیں",
    "brand.sub": "احمد برادرز ٹریولز",
    "nav.services": "خدمات",
    "nav.why": "ہم کیوں؟",
    "nav.how": "طریقہ کار",
    "nav.contact": "رابطہ",
    "cta.wa": "واٹس ایپ",
    "cta.quote": "واٹس ایپ پر قیمت لیں",
    "cta.quote2": "واٹس ایپ پر پیغام بھیجیں",
    "cta.call": "ابھی کال کریں",

    "hero.eyebrow": "ایئر ٹکٹ · عمرہ · ویزا · ٹورز",
    "hero.h1": "ٹکٹ، عمرہ اور ویزا — بغیر بھاگ دوڑ کے",
    "hero.lead": "اپنا روٹ اور تاریخیں واٹس ایپ پر بھیجیں۔ ہم ریٹ کا موازنہ کر کے صاف آپشنز دیتے ہیں، اور مناسب ای ٹکٹ کے ساتھ انوائس بھی — عموماً اسی دن۔",
    "hero.chip1": "اسی دن ریٹ",
    "hero.chip2": "فیملی اور گروپ بکنگ",
    "hero.chip3": "ویزا فائل میں مدد",

    "pass.tag": "عمرہ · ریٹرن",
    "pass.from": "کراچی",
    "pass.to": "جدہ",
    "pass.pax": "مسافر",
    "pass.paxv": "2 افراد",
    "pass.fare": "کرایہ",
    "pass.farev": "آج پوچھیں",
    "pass.bag": "سامان",
    "pass.note": "یہ صرف نمونہ ہے — اپنا روٹ بتائیں، ہم ریٹ بھیج دیں گے۔",

    "services.kicker": "ہم کیا کرتے ہیں",
    "services.h2": "ایک سفر کی ساری چیزیں، ایک ہی جگہ",
    "services.lead": "ٹکٹ، ویزا فائل، ہوٹل اور ایئرپورٹ پک اپ — سب ایک ہی ٹیم سے، تین مختلف لوگوں کے پیچھے نہیں بھاگنا پڑے گا۔",
    "s1.t": "ایئر ٹکٹ",
    "s1.d": "گھریلو اور بین الاقوامی، ایک طرفہ یا ریٹرن۔ کئی ایئرلائنز کا موازنہ کر کے کل قیمت بتاتے ہیں — کوئی چھپا خرچ نہیں۔",
    "s2.t": "عمرہ و حج",
    "s2.d": "ٹکٹ، ویزا، ہوٹل اور ٹرانسپورٹ ایک ہی پیکج میں — فیملی اور گروپ آپشنز کے ساتھ۔",
    "s3.t": "ویزا سروسز",
    "s3.d": "ٹورسٹ، وزٹ، فیملی اور اسٹوڈنٹ فائل۔ کاغذات چیک، فارم بھرنے میں رہنمائی اور اپائنٹمنٹ کی یاد دہانی۔",
    "s4.t": "ہوٹل بکنگ",
    "s4.d": "مکہ، مدینہ اور دنیا بھر میں قیام — ہر بجٹ کے لیے حرم کے قریب آپشنز۔",
    "s5.t": "ٹورز و ٹرانسپورٹ",
    "s5.d": "ایئرپورٹ ٹرانسفر، شہر کی سیر اور فیملی کے لیے اپنی مرضی کا پلان۔",
    "s6.t": "گروپ و فیملی ٹکٹ",
    "s6.d": "شادی کے گروپ، کمپنی کے سفر اور اسٹوڈنٹ گروپ — سب کی سیٹیں ایک ساتھ۔",

    "why.kicker": "اے بی ٹریولز کیوں؟",
    "why.h2": "سیدھی بات، کوئی چکر نہیں",
    "w1": "کئی ایئرلائنز کے ریٹ کا موازنہ",
    "w1d": "ہم سب سے پہلا ریٹ نہیں دے دیتے — چند ایئرلائنز دیکھ کر فرق بتاتے ہیں۔",
    "w2": "سارا کام واٹس ایپ پر",
    "w2d": "کوئی ایپ، لاگ ان یا دفتر آنا ضروری نہیں۔ آپ کی چیٹ ہی آپ کی فائل ہے۔",
    "w3": "کاغذات کی مکمل مدد",
    "w3d": "ویزا فائل کے لیے ڈاکومنٹ لسٹ، فارم اور اپائنٹمنٹ کی یاد دہانی۔",
    "w4": "ہر بکنگ کے ساتھ انوائس",
    "w4d": "کمپنی کے خرچ یا ویزا فائل کے لیے صاف انوائس — صرف ٹکٹ کی تصویر نہیں۔",
    "wc.k": "سب سے تیز طریقہ",
    "wc.t": "روٹ، تاریخ اور مسافروں کی تعداد — ایک پیغام سے شروعات ہو جاتی ہے۔",
    "wc.or": "یا کال کریں",

    "how.kicker": "طریقہ کار",
    "how.h2": "تین قدم اور سفر تیار",
    "h1t": "اپنا پلان بتائیں",
    "h1d": "روٹ، تاریخ اور مسافر — ایک واٹس ایپ پیغام کافی ہے۔ ویزا کاغذات کی تصاویر بھیج دیں۔",
    "h2t": "صاف آپشنز لیں",
    "h2d": "دو یا تین ریٹ، کل قیمت، سامان کی حد اور اوقات لکھ کر۔",
    "h3t": "کنفرم کریں اور اڑیں",
    "h3d": "ادائیگی کریں، ای ٹکٹ اور انوائس لیں — لینڈنگ تک ہم چیٹ پر موجود رہتے ہیں۔",

    "contact.kicker": "رابطہ",
    "contact.h2": "روٹ بھیجیں، ریٹ لیں",
    "contact.lead": "واٹس ایپ سب سے تیز ہے۔ کال اور ای میل بھی کر سکتے ہیں۔",
    "c.wa": "واٹس ایپ",
    "c.waNote": "سب سے تیز — روٹ اور تاریخ بھیجیں",
    "c.phone1": "موبائل",
    "c.phone2": "دوسرا نمبر",
    "c.email": "ای میل",
    "c.hoursT": "اوقات",
    "c.hours": "کسی بھی وقت پیغام بھیجیں — ہم ہفتے کے ساتوں دن کاروباری اوقات میں جواب دیتے ہیں۔",

    "form.t": "فوری ریٹ کی درخواست",
    "form.note": "یہ آپ کی تفصیل کے ساتھ واٹس ایپ کھولے گا۔ اس ویب سائٹ پر کچھ محفوظ نہیں ہوتا۔",
    "form.name": "آپ کا نام",
    "form.phone": "موبائل نمبر",
    "form.service": "سروس",
    "opt.air": "ایئر ٹکٹ",
    "opt.umrah": "عمرہ / حج پیکج",
    "opt.visa": "ویزا سروسز",
    "opt.hotel": "ہوٹل بکنگ",
    "opt.tour": "ٹور / ٹرانسپورٹ",
    "opt.other": "کچھ اور",
    "form.details": "سفر کی تفصیل",
    "form.ph": "مثلاً کراچی سے جدہ، 20 نومبر، 2 افراد",
    "form.submit": "واٹس ایپ پر بھیجیں",
    "form.sent": "واٹس ایپ کھل رہا ہے — وہاں send دبائیں۔",
    "form.err": "براہ کرم اپنا نام اور درست موبائل نمبر لکھیں۔",

    "footer.about": "ایئر ٹکٹ، عمرہ و حج پیکج، ویزا فائل، ہوٹل اور ٹورز۔",
    "footer.links": "فوری لنکس",
    "footer.contact": "رابطہ",
    "footer.rights": "جملہ حقوق محفوظ ہیں۔",

    msgName: "نام",
    msgPhone: "موبائل",
    msgService: "سروس",
    msgDetails: "تفصیل",
    msgGreeting: "السلام علیکم اے بی ٹریولز!"
  };

  var LANG = { en: EN, ur: UR };
  var current = "en";

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function waHref(lang) {
    return WA_BASE + "?text=" + encodeURIComponent(LANG[lang].waText);
  }

  function setMeta(name, value) {
    var el = document.querySelector('meta[name="' + name + '"]');
    if (el) el.setAttribute("content", value);
  }

  function applyLang(lang) {
    var dict = LANG[lang] || EN;
    current = lang;

    document.documentElement.setAttribute("lang", lang === "ur" ? "ur" : "en");
    document.documentElement.setAttribute("dir", lang === "ur" ? "rtl" : "ltr");

    qsa("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (dict[key] != null) el.textContent = dict[key];
    });
    qsa("[data-i18n-ph]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-ph");
      if (dict[key] != null) el.setAttribute("placeholder", dict[key]);
    });

    document.title = dict.title;
    setMeta("description", dict.desc);

    qsa(".js-wa").forEach(function (a) { a.setAttribute("href", waHref(lang)); });

    var btn = qs("#langBtn");
    if (btn) {
      if (lang === "ur") {
        btn.textContent = "EN";
        btn.setAttribute("aria-label", "Switch to English");
        btn.setAttribute("lang", "en");
      } else {
        btn.textContent = "اردو";
        btn.setAttribute("aria-label", "Switch to Urdu");
        btn.setAttribute("lang", "ur");
      }
    }

    var msg = qs("#formMsg");
    if (msg && msg.dataset.state === "sent") msg.textContent = dict["form.sent"];

    try { localStorage.setItem(STORE_KEY, lang); } catch (e) {}
  }

  function savedLang() {
    try {
      var v = localStorage.getItem(STORE_KEY);
      if (v === "ur" || v === "en") return v;
    } catch (e) {}
    return "en";
  }

  // ---- language switch ----
  var langBtn = qs("#langBtn");
  if (langBtn) {
    langBtn.addEventListener("click", function () {
      applyLang(current === "ur" ? "en" : "ur");
    });
  }

  // ---- mobile menu ----
  var menuBtn = qs("#menuBtn");
  var nav = qs("#nav");
  if (menuBtn && nav) {
    var closeNav = function () {
      nav.classList.remove("open");
      menuBtn.setAttribute("aria-expanded", "false");
      menuBtn.setAttribute("aria-label", "Open menu");
    };
    menuBtn.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
      menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });
    qsa("a", nav).forEach(function (a) { a.addEventListener("click", closeNav); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeNav();
    });
    document.addEventListener("click", function (e) {
      if (!nav.contains(e.target) && !menuBtn.contains(e.target)) closeNav();
    });
  }

  // ---- quote form -> WhatsApp ----
  var form = qs("#qform");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var dict = LANG[current];
      var name = (qs("#fName").value || "").trim();
      var phone = (qs("#fPhone").value || "").trim();
      var digits = phone.replace(/\D/g, "");
      var serviceEl = qs("#fService");
      var service = serviceEl.options[serviceEl.selectedIndex].textContent.trim();
      var details = (qs("#fDetails").value || "").trim();
      var msgEl = qs("#formMsg");

      if (name.length < 2 || digits.length < 7) {
        msgEl.textContent = dict["form.err"];
        msgEl.className = "form-msg err";
        msgEl.dataset.state = "err";
        (name.length < 2 ? qs("#fName") : qs("#fPhone")).focus();
        return;
      }

      var lines = [
        dict.msgGreeting,
        dict.msgName + ": " + name,
        dict.msgPhone + ": " + phone,
        dict.msgService + ": " + service
      ];
      if (details) lines.push(dict.msgDetails + ": " + details);

      var url = WA_BASE + "?text=" + encodeURIComponent(lines.join("\n"));
      msgEl.textContent = dict["form.sent"];
      msgEl.className = "form-msg";
      msgEl.dataset.state = "sent";

      var win = window.open(url, "_blank", "noopener");
      if (!win) window.location.href = url;
    });
  }

  // ---- footer year ----
  var yr = qs("#yr");
  if (yr) yr.textContent = String(new Date().getFullYear());

  applyLang(savedLang());
})();
