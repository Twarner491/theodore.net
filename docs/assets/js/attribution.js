/* Paid campaign touches are separate from original discovery attribution. */
(function () {
  if (window.TheodorePaidAttribution) return;
  var KEY = "attr:paid:v1", EXPERIMENT = "av-meta-nov26-v1";
  var WINDOW = 7 * 86400, RETAIN = 90 * 86400;
  var ARMS = { "av3-meta-reel-a": "reel-a", "av3-meta-species": "species", "av3-meta-photo": "photo" };
  var memory = null, entry = null, captured = "", click = null, recorded = "";
  function now() { return Math.floor(Date.now() / 1000); }
  function copy(value) { return value ? JSON.parse(JSON.stringify(value)) : null; }
  function token(value, length) {
    return typeof value === "string" && value.length <= length && /^[a-zA-Z0-9_.-]+$/.test(value) ? value : "";
  }
  function touch(value) {
    if (!value || !/^[A-Za-z0-9_-]{8,64}$/.test(value.id || "") || !Object.prototype.hasOwnProperty.call(ARMS, value.tag) || ARMS[value.tag] !== value.arm ||
        !Number.isSafeInteger(value.at) || value.at < 1 || value.at > now() + 60 || now() - value.at > RETAIN ||
        typeof value.path !== "string" || !/^\/store\/(?:[a-z0-9-]+\/)?$/.test(value.path)) return null;
    var clean = { id: value.id, arm: value.arm, tag: value.tag, at: value.at, path: value.path };
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "cart_origin"].forEach(function (name) {
      var val = token(value[name], 100); if (val) clean[name] = val;
    });
    ["ad_id", "adset_id", "campaign_id"].forEach(function (name) {
      if (typeof value[name] === "string" && /^\d{1,32}$/.test(value[name])) clean[name] = value[name];
    });
    return clean;
  }
  function saved() {
    var value = memory;
    try { var stored = localStorage.getItem(KEY); if (stored) value = JSON.parse(stored); } catch (_) {}
    if (!value || value.v !== 1 || value.experiment !== EXPERIMENT) return null;
    var first = touch(value.first), last = touch(value.last);
    if (!first || !last || last.at < first.at) return null;
    return { v: 1, experiment: EXPERIMENT, first: first, last: last,
      crossover: value.crossover === true || first.arm !== last.arm };
  }
  function id() {
    try { if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID(); } catch (_) {}
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
  function capture() {
    var href = String(location.href || location.pathname + location.search);
    if (href === captured) return;
    captured = href;
    var params; try { params = new URLSearchParams(location.search); } catch (_) { return; }
    var fbclid = token(params.get("fbclid"), 450);
    if (fbclid) click = { fbclid: fbclid, at: now(), path: location.pathname.slice(0, 256) };
    var go = params.get("go"), tag = Object.prototype.hasOwnProperty.call(ARMS, go) ? go : "";
    var content = params.get("utm_content"), utmTag = Object.prototype.hasOwnProperty.call(ARMS, content) ? content : "av3-meta-" + content;
    var campaign = params.get("utm_campaign"), medium = String(params.get("utm_medium") || "").toLowerCase(), source = String(params.get("utm_source") || "").toLowerCase();
    var recognizedUtm = campaign === EXPERIMENT && /^(paid_social|paid|cpc)$/.test(medium) && /^(meta|facebook|instagram|fb|ig)$/.test(source) && Object.prototype.hasOwnProperty.call(ARMS, utmTag);
    if (tag && recognizedUtm && tag !== utmTag) return;
    if (!tag && recognizedUtm) tag = utmTag;
    if (!tag || !/^\/store\/(?:[a-z0-9-]+\/)?$/.test(location.pathname)) return;
    var last = { id: id(), arm: ARMS[tag], tag: tag, at: now(), path: location.pathname };
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "cart_origin", "ad_id", "adset_id", "campaign_id"].forEach(function (name) {
      var val = params.get(name); if (val) last[name] = val;
    });
    last = touch(last);
    var prior = saved(), first = prior ? prior.first : last;
    memory = { v: 1, experiment: EXPERIMENT, first: first, last: last,
      crossover: !!(prior && prior.crossover) || first.arm !== last.arm };
    entry = copy(memory);
    try { localStorage.setItem(KEY, JSON.stringify(memory)); } catch (_) {}
  }
  window.TheodorePaidAttribution = Object.freeze({
    capture: capture,
    snapshot: function () { var value = saved(); return value && now() - value.last.at <= WINDOW ? copy(value) : null; },
    arrival: function () {
      var value = entry || saved();
      try { recorded = localStorage.getItem(KEY + ":recorded") || recorded; } catch (_) {}
      return value && value.last.id !== recorded && now() - value.last.at <= WINDOW ? copy(value) : null;
    },
    acknowledge: function (id) {
      if (!token(id, 64)) return;
      recorded = id;
      try { localStorage.setItem(KEY + ":recorded", id); } catch (_) {}
    },
    clickContext: function () { return copy(click); }
  });
  capture();
})();

/* Sitewide first-touch attribution.
   store.js captures a session-scoped source, but it only loads on store pages --
   and most traffic LANDS on project/writing pages (a repost on X or Instagram
   links the writeup, not the store). By the time that visitor reaches the store,
   the referrer is internal and the session reads "direct". This tiny script runs
   on EVERY page and records the first MEANINGFUL touch (a ?go=<slug> short link
   or an external referrer) in localStorage; store.js prefers it whenever its own
   session capture resolves "direct". Direct/internal landings are never locked in,
   so a later real channel touch still gets credit. No PII: a channel token, the
   landing path, and a timestamp. Host mapping mirrors evSource() in store.js. */
(function () {
  var KEY = "attr:first:v1";
  var TTL = 90 * 864e5;   // 90 days, matching the consumer check in store.js
  try {
    // Never capture on checkout/confirmation: payment redirects (Stripe 3DS, wallet
    // auth) land there with payment-infrastructure referrers that are not channels.
    if (/^\/store\/(checkout|confirmation)/.test(location.pathname)) return;
    var cur = null;
    try { cur = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    if (cur && cur.src && Date.now() - (cur.ts || 0) < TTL) return;   // keep the true first touch
    var clean = function (s) { return String(s || "").toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 40); };
    var go = null; try { go = new URLSearchParams(location.search).get("go"); } catch (e) {}
    var host = ""; try { host = new URL(document.referrer).hostname.toLowerCase(); } catch (e) {}
    var src = null;
    if (go) src = clean(go);
    else if (!host || /(^|\.)theodore\.net$/.test(host)) src = null;   // direct/internal: leave first-touch open
    else if (/(^|\.)(x\.com|twitter\.com|t\.co)$/.test(host)) src = "x";
    else if (/(^|\.)instagram\.com$/.test(host)) src = "instagram";
    else if (/(^|\.)(facebook\.com|fb\.com|fb\.me)$/.test(host) || /^[lm]\.facebook\.com$/.test(host)) src = "facebook";
    else if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) src = "youtube";
    else if (/(^|\.)reddit\.com$/.test(host)) src = "reddit";
    else if (/(^|\.)news\.ycombinator\.com$/.test(host)) src = "hn";
    else if (/(^|\.)(google|bing|duckduckgo)\.[a-z.]{2,10}$/.test(host)) src = "search";
    else if (/(^|\.)(stripe\.com|stripe\.network|link\.com|pay\.google\.com|paypal\.com|klarna\.com)$/.test(host)) src = null;   // payment/3DS redirect hosts are not channels
    else src = clean(host.replace(/^www\./, ""));
    if (src) localStorage.setItem(KEY, JSON.stringify({ src: src, l: location.pathname.slice(0, 256), ts: Date.now() }));
  } catch (e) { /* attribution must never break a page */ }
})();
