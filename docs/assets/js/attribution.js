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
