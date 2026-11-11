/* Meta measurement: acknowledged explicit choices, or a trusted US-only default. */
(function () {
  "use strict";
  var KEY = "theodore:meta-choice:v1", CLICK_KEY = "theodore:meta-click:v1";
  var VERSION = "meta-v2", DEFAULT_VERSION = "meta-us-v1", OVERRIDE_VERSION = "meta-v3";
  var WEEK = 604800, enabled = false, serverOptOut = false, syncing = false, observedAnon = "";
  var configState = "loading", saveFailed = false, choicePersisted = true, analyticsSaveFailed = false;
  var serverSignals = { gpc: false, dnt: false }, regionalDefaultAllowed = false, overrideSupported = false;
  var choiceSeen = false, choiceReadFailed = false, overrideDraft = null, verifiedDecision = null;
  var browserEvents = false, pixelId = "", pixelLoading = false, pixelReady = false, pixelInitialized = false;
  var pageSent = false, viewSent = "", currentView = null, pendingEvents = [];
  var choice = read(KEY), savedClick = read(CLICK_KEY), pageClick = null;
  function now() { return Math.floor(Date.now() / 1000); }
  function choiceTime() {
    var prior = choice && (choice.atMs || choice.at * 1000);
    return Math.max(Date.now(), Number.isSafeInteger(prior) && prior <= Date.now() + 1000 ? prior + 1 : 0);
  }
  function read(key) {
    try {
      var raw = localStorage.getItem(key);
      if (key === KEY && raw !== null) choiceSeen = true;
      return JSON.parse(raw);
    } catch (_) { if (key === KEY) { choicePersisted = false; choiceReadFailed = true; } return null; }
  }
  function save(key, value) {
    if (key === KEY && value) choiceSeen = true;
    try {
      var raw = value ? JSON.stringify(value) : null;
      if (raw) localStorage.setItem(key, raw); else localStorage.removeItem(key);
      if (key === KEY) choicePersisted = localStorage.getItem(key) === raw;
    } catch (_) { if (key === KEY) choicePersisted = false; }
  }
  function signals() { return { gpc: serverSignals.gpc || navigator.globalPrivacyControl === true,
    dnt: serverSignals.dnt || navigator.doNotTrack === "1" || window.doNotTrack === "1" }; }
  function signalBits(value) { return value && typeof value.gpc === "boolean" && typeof value.dnt === "boolean"; }
  function rawBlocked() { var value = signals(); return serverOptOut || value.gpc || value.dnt; }
  function coveredBy(value) {
    var current = signals();
    return signalBits(value) && (!current.gpc || value.gpc) && (!current.dnt || value.dnt) &&
      !(serverOptOut && !current.gpc && !current.dnt);
  }
  function knownVersion(value) { return value === "meta-v1" || value === VERSION || value === DEFAULT_VERSION || value === OVERRIDE_VERSION; }
  function validChoice() { return choice && knownVersion(choice.version) && typeof choice.allowed === "boolean" &&
    Number.isSafeInteger(choice.at) && choice.at > 0 && choice.at <= now() + 1 && now() - choice.at < 90 * 86400 &&
    (choice.atMs === undefined || Number.isSafeInteger(choice.atMs) && Math.floor(choice.atMs / 1000) === choice.at); }
  function uuid(value) { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
  function decision(value) { return uuid(value.decisionId) && Number.isSafeInteger(value.decisionAt) &&
    value.decisionAt > 0 && value.decisionAt <= now() + 60 && now() - value.decisionAt < 90 * 86400; }
  function ledgerVersion(value) { return value === DEFAULT_VERSION || value === OVERRIDE_VERSION; }
  function verifiedChoice() { return verifiedDecision && choice && verifiedDecision.id === choice.decisionId &&
    verifiedDecision.anon === choice.anon && choice.anon === identity(); }
  function needsAcknowledgment() { return validChoice() && (choice.acknowledged !== true ||
    choice.allowed && ledgerVersion(choice.version) && !verifiedChoice()); }
  function overrideApplies() { return validChoice() && choice.allowed && choice.version === OVERRIDE_VERSION &&
    choice.acknowledged === true && choice.anon === identity() && decision(choice) && coveredBy(choice.overrideSignals); }
  function blocked() { return rawBlocked() && !overrideApplies(); }
  function pendingOverrideApplies() { return overrideDraft && overrideDraft.stage === "confirming" &&
    overrideDraft.anon === identity() && coveredBy(overrideDraft.signals) && choice && choice.anon === overrideDraft.anon &&
    choice.version === OVERRIDE_VERSION && !choice.acknowledged; }
  function identity(value) {
    if (/^[A-Za-z0-9_-]{8,64}$/.test(value || "")) observedAnon = value;
    var anon = "";
    try { anon = localStorage.getItem("tev_aid") || ""; } catch (_) {}
    if (!anon) try { anon = sessionStorage.getItem("tev_sid") || ""; } catch (_) {}
    return /^[A-Za-z0-9_-]{8,64}$/.test(anon) ? anon : observedAnon;
  }
  function allowed() { return enabled && configState === "ready" && !blocked() && validChoice() && choice.allowed &&
    choice.acknowledged === true && !!choice.anon && choice.anon === identity() &&
    (!ledgerVersion(choice.version) || decision(choice) && verifiedChoice()) &&
    (choice.version !== DEFAULT_VERSION || regionalDefaultAllowed && !rawBlocked()); }
  function enforcePolicy() {
    if (rawBlocked() && (!choice || typeof choice !== "object" || typeof choice.allowed !== "boolean")) {
      setChoice(false); return;
    }
    if (choice && choice.allowed === true && blocked() && !pendingOverrideApplies()) {
      overrideDraft = null; setChoice(false);
    }
  }
  function tryRegionalDefault() {
    if (!enabled || configState !== "ready" || !regionalDefaultAllowed || rawBlocked() ||
        choiceSeen || choiceReadFailed || choice || !/^[A-Za-z0-9_-]{8,64}$/.test(identity())) return;
    // A failed read or any existing record may hide a refusal. Never turn it into a default allowance.
    setChoice(true, DEFAULT_VERSION);
  }
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
    return browserEvents && allowed() && choice.version !== "meta-v1" && safeStorePage();
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
    enforcePolicy();
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
    enforcePolicy();
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
    if (!allowed()) return;
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
    enforcePolicy(); tryRegionalDefault();
    if (!saveFailed) syncChoice();
    syncPixel();
    if (blocked() || !validChoice() || !choice.allowed) {
      savedClick = null; save(CLICK_KEY, null);
      return { consent: false, version: VERSION, signals: signals() };
    }
    if (!allowed()) return { consent: false, version: VERSION, signals: signals() };
    captureClick();
    if (savedClick && !validId(savedClick.fbc, "fbc")) { savedClick = null; save(CLICK_KEY, null); }
    var result = { consent: true, version: choice.version, at: choice.at, atMs: choice.atMs || choice.at * 1000, signals: signals() };
    if (choice.version === DEFAULT_VERSION || choice.version === OVERRIDE_VERSION) {
      result.decisionId = choice.decisionId; result.decisionAt = choice.decisionAt;
    }
    var fbc = savedClick && savedClick.fbc || cookie("_fbc"), fbp = cookie("_fbp");
    if (validId(fbc, "fbc")) result.fbc = fbc;
    if (validId(fbp, "fbp")) result.fbp = fbp;
    return result;
  }
  function status() {
    var target = document.getElementById("ad-measurement-status");
    var toggle = document.getElementById("cookie-meta"), retry = document.getElementById("cookie-meta-retry");
    var pending = needsAcknowledgment();
    var text = blocked() ? "Off" : configState === "loading" ? "Loading…" :
      pending && syncing ? (choice.allowed ? "Saving…" : "Off") : allowed() ? "On" : "Off";
    var note = overrideDraft && overrideDraft.error ? overrideDraft.error :
      overrideDraft && (overrideDraft.stage === "preparing" || overrideDraft.stage === "waiting") ? "Loading…" :
      overrideDraft && overrideDraft.stage === "confirming" && syncing ? "Saving…" :
      configState === "error" ? "Could not load." :
      configState === "ready" && !enabled ? "Unavailable." : pending ?
        (saveFailed || !syncing ? (choice.allowed ? "Could not save." : "Retry to finish saving.") : choice.allowed ? "" : "Saving…") :
        validChoice() && !choicePersisted ? "Not saved on this browser." : "";
    var detail = document.getElementById("cookie-meta-note");
    if (target) target.textContent = text;
    if (detail) { detail.textContent = note; detail.hidden = !note; }
    if (toggle) {
      toggle.disabled = configState !== "ready" || !enabled || blocked() && !overrideSupported;
      toggle.checked = !!allowed();
      toggle.title = blocked() ? "Your browser privacy setting keeps Meta off." :
        allowed() && choice.version === "meta-v1" ? "Your existing choice allows purchase measurement only." : "";
    }
    if (retry) {
      retry.hidden = !(overrideDraft && overrideDraft.error || configState === "error" ||
        configState === "ready" && (!enabled || pending && !syncing));
      retry.disabled = configState === "loading" || syncing;
    }
    var confirmation = document.getElementById("cookie-meta-confirmation"), confirm = document.getElementById("cookie-meta-confirm");
    if (confirmation) {
      if (!overrideDraft && !confirmation.hidden && typeof confirmation.contains === "function" &&
          confirmation.contains(document.activeElement) && toggle && typeof toggle.focus === "function") toggle.focus();
      confirmation.hidden = !overrideDraft;
    }
    if (confirm) confirm.disabled = !overrideDraft || overrideDraft.stage !== "ready" || syncing ||
      overrideDraft.expiresAt <= now() || overrideDraft.anon !== identity() || !coveredBy(overrideDraft.signals);
    var analytics = window.TheodoreAnalyticsPreference, ga = document.getElementById("cookie-analytics");
    var gaStatus = document.getElementById("cookie-analytics-status");
    if (ga && gaStatus) {
      var state = analytics ? analytics.state() : { available: false, allowed: false, persisted: false };
      ga.disabled = !state.available; ga.checked = state.available && state.allowed;
      gaStatus.textContent = state.available && state.allowed ? "On" : "Off";
      if (state.persisted) analyticsSaveFailed = false;
      var gaNote = document.getElementById("cookie-analytics-note");
      if (gaNote) {
        gaNote.textContent = !state.available ? "Unavailable." : analyticsSaveFailed ? "Not saved on this browser." : "";
        gaNote.hidden = !gaNote.textContent;
      }
    }
  }
  function postConsent(body) {
    return fetch("/api/ad-consent", { method: "POST", credentials: "same-origin", keepalive: true,
      headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    }).then(function (response) { if (!response.ok) throw new Error("unavailable"); return response.json(); });
  }
  function notifyChoice() { window.dispatchEvent(new CustomEvent("theodore:meta-consent")); }
  function syncChoice() {
    if (syncing || !validChoice() || (!enabled && choice.allowed) || !needsAcknowledgment() && choice.anon) return;
    var anon = choice.anon || identity();
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(anon)) return;
    if (choice.allowed && choice.version === DEFAULT_VERSION && (!regionalDefaultAllowed || rawBlocked() || !choicePersisted)) return;
    if (choice.allowed && choice.version === OVERRIDE_VERSION && !pendingOverrideApplies() && !(choice.acknowledged === true && decision(choice))) return;
    var pending = choice, draft = overrideDraft;
    pending.anon = anon;
    var body = { anon: anon, consent: pending.allowed, version: pending.version,
      at: pending.at, atMs: pending.atMs || pending.at * 1000, signals: signals() };
    if (ledgerVersion(pending.version)) { body.decisionId = pending.decisionId; body.decisionAt = pending.decisionAt; }
    if (pending.allowed && pending.version === OVERRIDE_VERSION && pending.acknowledged !== true) {
      body.action = "confirm-override"; body.challenge = draft.challenge;
    }
    syncing = true; saveFailed = false; status();
    postConsent(body).then(function (result) {
      if (choice !== pending) return;
      if (result.recorded !== true || typeof result.allowed !== "boolean") {
        if (ledgerVersion(pending.version) && pending.acknowledged === true) { pending.acknowledged = false; save(KEY, pending); }
        throw new Error("unacknowledged");
      }
      if (result.allowed && (pending.anon !== identity() || result.allowed !== pending.allowed)) throw new Error("identity_changed");
      var version = result.version || pending.version;
      var at = result.at === undefined ? pending.at : result.at, atMs = result.atMs === undefined ? pending.atMs || pending.at * 1000 : result.atMs;
      if (!knownVersion(version) || !Number.isSafeInteger(at) || !Number.isSafeInteger(atMs) || Math.floor(atMs / 1000) !== at)
        throw new Error("invalid_acknowledgement");
      if (result.allowed && (pending.version === DEFAULT_VERSION || pending.version === OVERRIDE_VERSION)) {
        if (version !== pending.version || !decision(result) ||
            version === OVERRIDE_VERSION && !coveredBy(result.overrideSignals)) throw new Error("invalid_decision");
      }
      pending.allowed = result.allowed; pending.version = version; pending.at = at; pending.atMs = atMs;
      pending.acknowledged = true;
      if (version === DEFAULT_VERSION || version === OVERRIDE_VERSION) {
        pending.decisionId = result.decisionId; pending.decisionAt = result.decisionAt;
        pending.overrideSignals = result.overrideSignals;
      }
      verifiedDecision = pending.allowed && ledgerVersion(version) ? { id: pending.decisionId, anon: pending.anon } : null;
      if (!pending.allowed) { savedClick = null; save(CLICK_KEY, null); }
      if (overrideDraft === draft) overrideDraft = null;
      save(KEY, pending); enforcePolicy(); captureClick(); status(); syncPixel(); notifyChoice();
    }).catch(function () {
      if (choice === pending) {
        saveFailed = true;
        if (overrideDraft === draft && draft) { draft.error = "Could not save."; draft.stage = "ready"; }
      }
    }).finally(function () {
      syncing = false;
      if (choice !== pending) syncChoice();
      if (!syncing && overrideDraft && overrideDraft.stage === "waiting") beginOverride();
      status();
    });
  }
  function setChoice(allow, version) {
    var anon = allow ? identity() : choice && choice.anon || identity();
    var atMs = choiceTime(); verifiedDecision = null;
    choice = { version: version || VERSION, at: Math.floor(atMs / 1000), atMs: atMs, allowed: allow && !rawBlocked(), anon: anon };
    save(KEY, choice);
    if (choice.version === DEFAULT_VERSION && !choicePersisted) choice.allowed = false;
    if (!choice.allowed) { savedClick = null; save(CLICK_KEY, null); }
    saveFailed = false; status(); syncChoice(); syncPixel(); notifyChoice();
  }
  function beginOverride() {
    if (!enabled || !overrideSupported || !rawBlocked() || !/^[A-Za-z0-9_-]{8,64}$/.test(identity())) return;
    enforcePolicy();
    var draft = { anon: identity(), signals: signals(), stage: syncing ? "waiting" : "preparing" };
    overrideDraft = draft; status();
    if (syncing) return;
    postConsent({ action: "prepare-override", anon: draft.anon, signals: draft.signals }).then(function (result) {
      if (overrideDraft !== draft) return;
      if (draft.anon !== identity() || !coveredBy(draft.signals) || result.prepared !== true || !uuid(result.challenge) ||
          !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= now() || result.expiresAt > now() + 360 ||
          !signalBits(result.signals) || !coveredBy(result.signals)) throw new Error("invalid_confirmation");
      draft.signals = result.signals; draft.challenge = result.challenge; draft.expiresAt = result.expiresAt; draft.stage = "ready";
    }).catch(function () { if (overrideDraft === draft) { draft.stage = "failed"; draft.error = "Could not load."; } })
      .finally(status);
  }
  function confirmOverride() {
    var draft = overrideDraft;
    if (!draft || draft.stage !== "ready" || syncing) return;
    if (draft.anon !== identity() || !coveredBy(draft.signals) || draft.expiresAt <= now()) {
      draft.error = "Confirmation expired. Retry."; status(); return;
    }
    var atMs = choiceTime(); verifiedDecision = null;
    choice = { version: OVERRIDE_VERSION, at: Math.floor(atMs / 1000), atMs: atMs,
      allowed: true, anon: draft.anon, acknowledged: false };
    save(KEY, choice); draft.stage = "confirming"; draft.error = ""; saveFailed = false;
    status(); syncChoice(); syncPixel(); notifyChoice();
  }
  function cancelOverride() { overrideDraft = null; setChoice(false); }
  window.TheodoreMetaTracking = { context: context, itemEvent: itemEvent, checkoutEvent: checkoutEvent };
  function loadConfig() {
    configState = "loading"; status(); syncPixel();
    fetch("/api/ad-config", { credentials: "same-origin", cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("unavailable");
      return response.json();
    }).then(function (config) {
      configState = "ready";
      serverOptOut = config.privacyOptOut === true;
      serverSignals = signalBits(config.privacySignals) ? config.privacySignals : { gpc: false, dnt: false };
      regionalDefaultAllowed = config.regionalDefaultAllowed === true;
      overrideSupported = config.signalOverrideSupported === true;
      enabled = config.metaMeasurementEnabled === true;
      browserEvents = config.metaBrowserEventsEnabled === true;
      pixelId = typeof config.metaPixelId === "string" ? config.metaPixelId : "";
      enforcePolicy(); tryRegionalDefault();
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
        if (control.checked && (!enabled || configState !== "ready")) { status(); return; }
        if (control.checked && rawBlocked()) { beginOverride(); return; }
        overrideDraft = null; setChoice(control.checked);
      } else if (window.TheodoreAnalyticsPreference) {
        var saved = window.TheodoreAnalyticsPreference.setAllowed(control.checked);
        analyticsSaveFailed = saved.available && !saved.persisted;
        status();
      }
    });
    document.addEventListener("click", function (event) {
      var override = event.target.closest("[data-meta-override]");
      if (override) {
        if (override.getAttribute("data-meta-override") === "confirm") confirmOverride(); else cancelOverride();
        return;
      }
      if (!event.target.closest("[data-cookie-retry]")) return;
      if (overrideDraft) beginOverride();
      else if (configState === "error" || !enabled) loadConfig();
      else { syncChoice(); status(); }
    });
    loadConfig();
  }
  window.addEventListener("theodore:analytics-preference", status);
  window.addEventListener("storage", function (event) {
    if (event.key !== KEY && event.key !== CLICK_KEY) return;
    choice = read(KEY); savedClick = read(CLICK_KEY); saveFailed = false; overrideDraft = null; verifiedDecision = null;
    enforcePolicy(); status(); syncChoice(); syncPixel();
    window.dispatchEvent(new CustomEvent("theodore:meta-consent"));
  });
  window.addEventListener("online", syncChoice);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { context(); syncPixel(); status(); } });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
