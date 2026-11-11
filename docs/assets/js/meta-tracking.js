/* Optional Meta measurement. Browser events require a separate, expanded opt-in. */
(function () {
  "use strict";
  var KEY = "theodore:meta-choice:v1", CLICK_KEY = "theodore:meta-click:v1";
  var VERSION = "meta-v2", WEEK = 604800, enabled = false, serverOptOut = false, syncing = false, observedAnon = "";
  var configState = "loading", saveFailed = false, choicePersisted = true;
  var browserEvents = false, pixelId = "", pixelLoading = false, pixelReady = false, pixelInitialized = false;
  var pageSent = false, viewSent = "", currentView = null, pendingEvents = [];
  var choice = read(KEY), savedClick = read(CLICK_KEY), pageClick = null;
  function now() { return Math.floor(Date.now() / 1000); }
  function read(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (_) { if (key === KEY) choicePersisted = false; return null; } }
  function save(key, value) { try { if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key); if (key === KEY) choicePersisted = true; } catch (_) { if (key === KEY) choicePersisted = false; } }
  function blocked() { return serverOptOut || navigator.globalPrivacyControl === true || navigator.doNotTrack === "1" || window.doNotTrack === "1"; }
  function validChoice() { return choice && (choice.version === "meta-v1" || choice.version === VERSION) && typeof choice.allowed === "boolean" &&
    Number.isSafeInteger(choice.at) && choice.at > 0 && choice.at <= now() && now() - choice.at < 90 * 86400 &&
    (choice.atMs === undefined || Number.isSafeInteger(choice.atMs) && Math.floor(choice.atMs / 1000) === choice.at); }
  function identity(value) {
    if (/^[A-Za-z0-9_-]{8,64}$/.test(value || "")) observedAnon = value;
    var anon = "";
    try { anon = localStorage.getItem("tev_aid") || ""; } catch (_) {}
    if (!anon) try { anon = sessionStorage.getItem("tev_sid") || ""; } catch (_) {}
    return /^[A-Za-z0-9_-]{8,64}$/.test(anon) ? anon : observedAnon;
  }
  function allowed() { return enabled && !blocked() && validChoice() && choice.allowed &&
    choice.acknowledged === true && !!choice.anon && choice.anon === identity(); }
  function safeStorePage() {
    try {
      var url = new URL(location.href), path = url.pathname;
      var products = window.STORE_PRODUCTS || [];
      function storePath(value) {
        return /^\/store\/?$/.test(value) || products.some(function (product) {
          return product.published && value === "/store/" + product.id + "/";
        });
      }
      if (!storePath(path)) return false;
      // Pixel reads the document URL/referrer itself. Never load it around payment,
      // recovery, search or arbitrary query values, even when the user has opted in.
      var safeQuery = /^(?:fbclid|utm_source|utm_medium|utm_campaign|utm_content|utm_term|ad_id|adset_id|campaign_id|variant|ref)$/;
      function safeUrl(value) {
        if (value.hash) return false;
        return Array.from(value.searchParams).every(function (entry) {
          if (entry[0] === "go") return /^av3-meta-(?:reel-a|species|photo)$/.test(entry[1]);
          if (entry[0] === "cart") return entry[1] === "open";
          return safeQuery.test(entry[0]) && /^[A-Za-z0-9_.-]{1,450}$/.test(entry[1]);
        });
      }
      if (!safeUrl(url)) return false;
      if (!document.referrer) return true;
      var referrer = new URL(document.referrer);
      var publicReferrer = referrer.pathname === "/" || referrer.origin === url.origin &&
        (storePath(referrer.pathname) || /^\/privacy\/?$/.test(referrer.pathname) || products.some(function (product) {
          return product.published && product.project === referrer.pathname;
        }));
      return publicReferrer && safeUrl(referrer);
    } catch (_) { return false; }
  }
  function browserAllowed() {
    return browserEvents && allowed() && choice.version === VERSION && safeStorePage();
  }
  function pixelAllowed() {
    return browserAllowed() && /^\d{5,30}$/.test(pixelId) && location.origin === "https://theodore.net";
  }
  function stopPixel() {
    pendingEvents.length = 0;
    if (pixelLoading && typeof window.fbq === "function") window.fbq("consent", "revoke");
  }
  function syncPixel() {
    if (!pixelAllowed()) { stopPixel(); return; }
    if (!pixelLoading) {
      // Do not use a pre-existing, independently configured Pixel.
      if (window.fbq) return;
      var queue = function () { queue.callMethod ? queue.callMethod.apply(queue, arguments) : queue.queue.push(arguments); };
      queue.push = queue; queue.loaded = true; queue.version = "2.0"; queue.queue = [];
      window.fbq = window._fbq = queue;
      queue("consent", "revoke");
      pixelLoading = true;
      var script = document.createElement("script");
      script.async = true; script.src = "https://connect.facebook.net/en_US/fbevents.js";
      script.referrerPolicy = "no-referrer";
      script.onload = function () { pixelReady = true; syncPixel(); };
      document.head.appendChild(script);
    }
    if (!pixelReady) return;
    if (!pixelInitialized) {
      window.fbq("set", "autoConfig", false, pixelId);
      window.fbq("init", pixelId);
      pixelInitialized = true;
    }
    window.fbq("consent", "grant");
    if (!pageSent) { window.fbq("trackSingle", pixelId, "PageView"); pageSent = true; }
    var signature = currentView && JSON.stringify(currentView);
    if (signature && signature !== viewSent) {
      window.fbq("trackSingle", pixelId, "ViewContent", currentView); viewSent = signature;
    }
    pendingEvents.splice(0).forEach(function (event) {
      if (pixelAllowed()) window.fbq("trackSingle", pixelId, event.name, event.data);
    });
  }
  function validItem(item) {
    return item && typeof item.id === "string" && /^[a-z0-9-]{1,100}$/.test(item.id) &&
      Number.isSafeInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 99 &&
      Number.isFinite(item.value) && item.value >= 0 && item.value <= 1000000;
  }
  function itemEvent(name, item) {
    if (blocked() && validChoice() && choice.allowed) setChoice(false);
    if (!validItem(item)) return;
    var data = { content_type: "product", content_ids: [item.id],
      contents: [{ id: item.id, quantity: item.quantity }], currency: "USD", value: item.value };
    if (name === "ViewContent") currentView = data; // Only the currently visible product, never historical views.
    else if (name === "AddToCart") {
      if (!pixelAllowed()) { syncPixel(); return; }
      pendingEvents.push({ name: "AddToCart", data: data });
    }
    else return;
    syncPixel();
  }
  function checkoutEvent(items) {
    if (blocked() && validChoice() && choice.allowed) setChoice(false);
    if (!pixelAllowed()) { syncPixel(); return; }
    if (!Array.isArray(items) || !items.length || items.length > 99 || !items.every(validItem)) return;
    var value = Math.round(items.reduce(function (sum, item) { return sum + item.value; }, 0) * 100) / 100;
    if (value > 1000000) return;
    pendingEvents.push({ name: "InitiateCheckout", data: {
      content_type: "product", content_ids: items.map(function (item) { return item.id; }),
      contents: items.map(function (item) { return { id: item.id, quantity: item.quantity }; }),
      currency: "USD", value: value,
      num_items: items.reduce(function (sum, item) { return sum + item.quantity; }, 0)
    } });
    syncPixel();
  }
  function cookie(name) {
    var match = (document.cookie || "").match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    try { return match ? decodeURIComponent(match[1]) : ""; } catch (_) { return ""; }
  }
  function validId(value, type) {
    var pattern = type === "fbp" ? /^fb\.[0-9]+\.[0-9]{13}\.[0-9]+$/ : /^fb\.[0-9]+\.[0-9]{13}\.[A-Za-z0-9_.-]+$/;
    if (typeof value !== "string" || value.length > 500 || !pattern.test(value)) return false;
    var at = Number(value.split(".")[2]) / 1000;
    return at <= now() + 1 && at >= now() - WEEK;
  }
  function captureClick() {
    if (!enabled || blocked() || !validChoice() || !choice.allowed) return;
    var incoming = window.TheodorePaidAttribution && window.TheodorePaidAttribution.clickContext();
    if (incoming && incoming.at >= now() - WEEK && incoming.at <= now() && /^[A-Za-z0-9_.-]{1,450}$/.test(incoming.fbclid)) {
      // Reloading the same tagged URL is not a new Meta click. Preserve the
      // timestamp we already know, even when it has expired and must be removed.
      var clickAt = incoming.at;
      var stored = savedClick && typeof savedClick.fbc === "string" && savedClick.fbc.length <= 500 &&
        /^fb\.[0-9]+\.(\d{13})\.([A-Za-z0-9_.-]+)$/.exec(savedClick.fbc);
      if (stored && stored[2] === incoming.fbclid && Number(stored[1]) > 0 && Number(stored[1]) <= (now() + 1) * 1000)
        clickAt = Number(stored[1]) / 1000;
      if (pageClick && pageClick.fbclid === incoming.fbclid) clickAt = Math.min(clickAt, pageClick.at);
      pageClick = { fbclid: incoming.fbclid, at: clickAt }; // Memory only; no longer storage retention.
      if (clickAt < now() - WEEK) return;
      var storedAt = savedClick && validId(savedClick.fbc, "fbc") ? Number(savedClick.fbc.split(".")[2]) / 1000 : 0;
      if (clickAt >= storedAt) {
        savedClick = { fbc: "fb.1." + clickAt * 1000 + "." + incoming.fbclid };
        save(CLICK_KEY, savedClick);
      }
    }
  }
  function context(anon) {
    identity(anon);
    if (blocked() && validChoice() && choice.allowed) setChoice(false);
    if (!saveFailed) syncChoice();
    syncPixel();
    if (blocked() || !validChoice() || !choice.allowed) {
      savedClick = null; save(CLICK_KEY, null);
      return { consent: false, version: VERSION };
    }
    if (!allowed()) return { consent: false, version: VERSION };
    captureClick();
    if (savedClick && !validId(savedClick.fbc, "fbc")) { savedClick = null; save(CLICK_KEY, null); }
    var result = { consent: true, version: choice.version, at: choice.at, atMs: choice.atMs || choice.at * 1000 };
    var fbc = savedClick && savedClick.fbc || cookie("_fbc"), fbp = cookie("_fbp");
    if (validId(fbc, "fbc")) result.fbc = fbc;
    if (validId(fbp, "fbp")) result.fbp = fbp;
    return result;
  }
  function status() {
    var target = document.getElementById("ad-measurement-status");
    var toggle = document.getElementById("cookie-meta"), retry = document.getElementById("cookie-meta-retry");
    var pending = validChoice() && choice.acknowledged !== true;
    var text = blocked() ? "Off: your browser privacy preference." : configState === "loading" ? "Loading…" :
      configState === "error" ? "Could not load. Retry." : !enabled ? "Off: not enabled on this site." :
      pending ? (saveFailed || !syncing ? (choice.allowed ? "Could not save. Retry." : "Off on this browser. Retry to finish saving.") :
        choice.allowed ? "Saving…" : "Off. Saving…") : allowed() ?
        (choice.version === "meta-v1" ? "Purchases only" : choicePersisted ? "On" : "On for this visit") : "Off";
    if (target) target.textContent = text;
    if (toggle) {
      toggle.disabled = blocked() || configState !== "ready" || !enabled;
      toggle.checked = !!(!toggle.disabled && validChoice() && choice.allowed && (allowed() || pending));
    }
    if (retry) {
      retry.hidden = blocked() || !(configState === "error" || configState === "ready" && (!enabled || pending && !syncing));
      retry.disabled = configState === "loading" || syncing;
    }
    var analytics = window.TheodoreAnalyticsPreference, ga = document.getElementById("cookie-analytics");
    var gaStatus = document.getElementById("cookie-analytics-status");
    if (ga && gaStatus) {
      var state = analytics ? analytics.state() : { available: false, allowed: false, persisted: false };
      ga.disabled = !state.available; ga.checked = state.available && state.allowed;
      gaStatus.textContent = !state.available ? "Not enabled on this site" :
        (state.allowed ? "On" : "Off") + (state.persisted ? "" : " for this visit");
    }
  }
  function syncChoice() {
    if (syncing || !validChoice() || (!enabled && choice.allowed) || choice.acknowledged === true && choice.anon) return;
    var anon = choice.anon || identity();
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(anon)) return;
    var pending = choice;
    pending.anon = anon;
    syncing = true; saveFailed = false; status();
    fetch("/api/ad-consent", { method: "POST", credentials: "same-origin", keepalive: true,
      headers: { "content-type": "application/json" }, body: JSON.stringify({ anon: anon,
        consent: pending.allowed, version: pending.version, at: pending.at, atMs: pending.atMs || pending.at * 1000 })
    }).then(function (response) { if (!response.ok) throw new Error("unavailable"); return response.json(); })
      .then(function (result) {
        if (choice !== pending) return;
        if (result.recorded === true && (result.allowed === pending.allowed || result.allowed === false)) {
          choice.allowed = result.allowed;
          choice.acknowledged = true;
          if (!choice.allowed) { savedClick = null; save(CLICK_KEY, null); }
          save(KEY, choice); status(); syncPixel();
        } else throw new Error("unacknowledged");
      }).catch(function () { if (choice === pending) saveFailed = true; }).finally(function () {
        syncing = false;
        if (choice !== pending) syncChoice();
        status();
      });
  }
  function setChoice(allowed) {
    var anon = allowed ? identity() : choice && choice.anon || identity();
    var atMs = Date.now();
    choice = { version: VERSION, at: Math.floor(atMs / 1000), atMs: atMs, allowed: allowed && !blocked(), anon: anon };
    save(KEY, choice);
    if (!choice.allowed) { savedClick = null; save(CLICK_KEY, null); }
    else captureClick();
    saveFailed = false; status(); syncChoice(); syncPixel();
    window.dispatchEvent(new CustomEvent("theodore:meta-consent"));
  }
  window.TheodoreMetaTracking = { context: context, itemEvent: itemEvent, checkoutEvent: checkoutEvent };
  function loadConfig() {
    configState = "loading"; status();
    fetch("/api/ad-config", { credentials: "same-origin", cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("unavailable");
      return response.json();
    }).then(function (config) {
      configState = "ready";
      serverOptOut = config.privacyOptOut === true;
      enabled = config.metaMeasurementEnabled === true && !serverOptOut;
      browserEvents = config.metaBrowserEventsEnabled === true;
      pixelId = typeof config.metaPixelId === "string" ? config.metaPixelId : "";
      if (blocked() && validChoice() && choice.allowed) setChoice(false);
      syncChoice();
      captureClick(); status(); syncPixel();
    }).catch(function () { enabled = false; configState = "error"; status(); syncPixel(); });
  }
  function init() {
    if (!/^\/store(?:\/|$)|^\/privacy(?:\/|$)/.test(location.pathname)) return;
    document.addEventListener("change", function (event) {
      var control = event.target.closest("[data-cookie-preference]");
      if (!control) return;
      if (control.getAttribute("data-cookie-preference") === "meta") {
        if (control.checked && (blocked() || !enabled || configState !== "ready")) { status(); return; }
        setChoice(control.checked);
      } else if (window.TheodoreAnalyticsPreference) {
        window.TheodoreAnalyticsPreference.setAllowed(control.checked); status();
      }
    });
    document.addEventListener("click", function (event) {
      if (!event.target.closest("[data-cookie-retry]")) return;
      if (configState === "error" || !enabled) loadConfig();
      else { syncChoice(); status(); }
    });
    loadConfig();
  }
  window.addEventListener("theodore:analytics-preference", status);
  window.addEventListener("storage", function (event) {
    if (event.key !== KEY && event.key !== CLICK_KEY) return;
    choice = read(KEY); savedClick = read(CLICK_KEY); saveFailed = false; status(); syncChoice(); syncPixel();
    window.dispatchEvent(new CustomEvent("theodore:meta-consent"));
  });
  window.addEventListener("online", syncChoice);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { context(); syncPixel(); status(); } });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
