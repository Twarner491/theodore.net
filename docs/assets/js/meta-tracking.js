/* Optional server-side ad measurement. No Meta script is loaded here. */
(function () {
  "use strict";
  var KEY = "theodore:meta-choice:v1", CLICK_KEY = "theodore:meta-click:v1";
  var VERSION = "meta-v1", WEEK = 604800, enabled = false, serverOptOut = false, panel = null, syncing = false, observedAnon = "";
  var choice = read(KEY), savedClick = read(CLICK_KEY);
  function now() { return Math.floor(Date.now() / 1000); }
  function read(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; } }
  function save(key, value) { try { if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key); } catch (_) {} }
  function blocked() { return serverOptOut || navigator.globalPrivacyControl === true || navigator.doNotTrack === "1" || window.doNotTrack === "1"; }
  function validChoice() { return choice && choice.version === VERSION && typeof choice.allowed === "boolean" &&
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
      var storedAt = savedClick && validId(savedClick.fbc, "fbc") ? Number(savedClick.fbc.split(".")[2]) / 1000 : 0;
      if (incoming.at >= storedAt) {
        savedClick = { fbc: "fb.1." + incoming.at * 1000 + "." + incoming.fbclid };
        save(CLICK_KEY, savedClick);
      }
    }
  }
  function context(anon) {
    identity(anon);
    if (blocked() && validChoice() && choice.allowed) setChoice(false);
    syncChoice();
    if (blocked() || !validChoice() || !choice.allowed) {
      savedClick = null; save(CLICK_KEY, null);
      return { consent: false, version: VERSION };
    }
    if (!allowed()) return { consent: false, version: VERSION };
    captureClick();
    if (savedClick && !validId(savedClick.fbc, "fbc")) { savedClick = null; save(CLICK_KEY, null); }
    var result = { consent: true, version: VERSION, at: choice.at, atMs: choice.atMs || choice.at * 1000 };
    var fbc = savedClick && savedClick.fbc || cookie("_fbc"), fbp = cookie("_fbp");
    if (validId(fbc, "fbc")) result.fbc = fbc;
    if (validId(fbp, "fbp")) result.fbp = fbp;
    return result;
  }
  function status() {
    var target = document.getElementById("ad-measurement-status");
    if (target) target.textContent = blocked() ? "Ad measurement is off because of your browser privacy preference." : !enabled ? "Meta ad measurement is currently off." : allowed() ? "Ad measurement is allowed on this browser." : "Ad measurement is off on this browser.";
  }
  function dismiss() {
    if (panel) { panel.remove(); panel = null; }
    document.documentElement.style.removeProperty("--ad-choice-space");
  }
  function syncChoice() {
    if (syncing || !validChoice() || (!enabled && choice.allowed) || choice.acknowledged === true && choice.anon) return;
    var anon = choice.anon || identity();
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(anon)) return;
    var pending = choice;
    pending.anon = anon;
    syncing = true;
    fetch("/api/ad-consent", { method: "POST", credentials: "same-origin", keepalive: true,
      headers: { "content-type": "application/json" }, body: JSON.stringify({ anon: anon,
        consent: pending.allowed, version: VERSION, at: pending.at, atMs: pending.atMs || pending.at * 1000 })
    }).then(function (response) { if (!response.ok) throw new Error("unavailable"); return response.json(); })
      .then(function (result) {
        if (choice === pending && result.recorded === true && (result.allowed === pending.allowed || result.allowed === false)) {
          choice.allowed = result.allowed;
          choice.acknowledged = true;
          if (!choice.allowed) { savedClick = null; save(CLICK_KEY, null); }
          save(KEY, choice); status();
        }
      }).catch(function () {}).finally(function () {
        syncing = false;
        if (choice !== pending) syncChoice();
      });
  }
  function setChoice(allowed) {
    var anon = allowed ? identity() : choice && choice.anon || identity();
    var atMs = Date.now();
    choice = { version: VERSION, at: Math.floor(atMs / 1000), atMs: atMs, allowed: allowed && !blocked(), anon: anon };
    save(KEY, choice);
    if (!choice.allowed) { savedClick = null; save(CLICK_KEY, null); }
    else captureClick();
    dismiss(); status(); syncChoice();
    window.dispatchEvent(new CustomEvent("theodore:meta-consent"));
  }
  function show() {
    if (!enabled || blocked() || panel) { status(); return; }
    panel = document.createElement("aside");
    panel.className = "ad-choice";
    panel.setAttribute("aria-label", "Ad measurement choice");
    panel.innerHTML = '<div><strong>Allow ad measurement?</strong><p>Share ad-click and purchase details with Meta to measure our ads. <a href="/privacy/#ad-measurement">Privacy</a></p></div><div class="ad-choice-actions"><button type="button" data-ad-choice="no">No thanks</button><button type="button" data-ad-choice="yes">Allow</button></div>';
    panel.addEventListener("click", function (event) {
      var button = event.target.closest("[data-ad-choice]");
      if (button) setChoice(button.getAttribute("data-ad-choice") === "yes");
    });
    document.body.appendChild(panel);
    document.documentElement.style.setProperty("--ad-choice-space", (panel.offsetHeight + 24) + "px");
  }
  window.TheodoreMetaTracking = { context: context };
  function init() {
    if (!/^\/store(?:\/|$)|^\/privacy(?:\/|$)/.test(location.pathname)) return;
    document.addEventListener("click", function (event) {
      var trigger = event.target.closest("[data-ad-measurement]");
      if (!trigger) return;
      if (trigger.getAttribute("data-ad-measurement") === "off") setChoice(false);
      else show();
    });
    fetch("/api/ad-config", { credentials: "same-origin", cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("unavailable");
      return response.json();
    }).then(function (config) {
      serverOptOut = config.privacyOptOut === true;
      enabled = config.metaMeasurementEnabled === true && !serverOptOut;
      if (blocked() && validChoice() && choice.allowed) setChoice(false);
      syncChoice();
      captureClick(); status();
      var incoming = window.TheodorePaidAttribution && window.TheodorePaidAttribution.clickContext();
      var paid = window.TheodorePaidAttribution && window.TheodorePaidAttribution.snapshot();
      if (enabled && !validChoice() && (incoming || paid) && /^\/store(?:\/|$)/.test(location.pathname)) show();
    }).catch(function () { enabled = false; status(); });
  }
  window.addEventListener("storage", function (event) {
    if (event.key !== KEY && event.key !== CLICK_KEY) return;
    choice = read(KEY); savedClick = read(CLICK_KEY); status(); syncChoice();
    window.dispatchEvent(new CustomEvent("theodore:meta-consent"));
  });
  window.addEventListener("online", syncChoice);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) syncChoice(); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
