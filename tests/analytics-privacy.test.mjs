import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const template = readFileSync(new URL("../overrides/partials/integrations/analytics/google.html", import.meta.url), "utf8");
const scripts = [...template.matchAll(/<script(?: id="__analytics")?>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1].replaceAll("{{ property }}", "G-TEST123456"));

function harness(href, referrer = "") {
  const listeners = [], navigation = [], inserted = [], searchListeners = [];
  const context = vm.createContext({
    URL, location: new URL(href),
    document: {
      referrer,
      forms: { search: { query: { addEventListener(name, callback) { searchListeners.push(callback); } } } },
      addEventListener(name, callback) { assert.equal(name, "DOMContentLoaded"); listeners.push(callback); },
      createElement(tag) { assert.equal(tag, "script"); return {}; },
      getElementById(id) { assert.equal(id, "__analytics"); return { insertAdjacentElement(position, script) { inserted.push(script); } }; },
    },
    document$: { subscribe() {} },
    location$: { subscribe(callback) { navigation.push(callback); } },
    history: { replaceState() { throw new Error("Analytics must not mutate browser history"); } },
  });
  context.window = context;
  for (const script of scripts) vm.runInContext(script, context);
  return { context, listeners, navigation, inserted, searchListeners };
}

const credentialUrl = "https://theodore.net/store/confirmation/?payment_intent=pi_synthetic&payment_intent_client_secret=synthetic_one&payment_intent_client_secret=synthetic_two&setup_intent_client_secret=synthetic_three&client%5Fsecret=synthetic_four&RESTORE_CART=synthetic_five&utm_source=facebook&utm_campaign=bird%20frames#restore_cart=synthetic_six";

test("shared provider protects both layouts and preserves theme-owned consent activation", () => {
  for (const layout of ["index", "main"]) {
    const source = readFileSync(new URL(`../overrides/${layout}.html`, import.meta.url), "utf8");
    assert.match(source, /extends "base\.html"/);
    const block = source.match(/{% block analytics %}([\s\S]*?){% endblock %}/);
    if (block) assert.match(block[1], /super\(\)/);
  }
  assert.equal(existsSync(new URL("../overrides/partials/integrations/analytics.html", import.meta.url)), false,
    "the upstream consent and initialization wrapper remains in control");
  assert.ok(template.indexOf("window.__theodoreAnalyticsParams") < template.indexOf('id="__analytics"'));
  const { context, inserted, listeners } = harness(credentialUrl);
  assert.equal(context.dataLayer, undefined);
  assert.equal(inserted.length, 0, "defining the sanitizer and initializer does not load analytics before consent");
  assert.equal(listeners.length, 0);
});

test("first Material config carries sanitized URL parameters before any page view", () => {
  const referrer = "https://theodore.net/store/?restore_cart=synthetic_cart&utm_medium=email#restore_cart=synthetic_hash";
  const { context, inserted } = harness(credentialUrl, referrer);
  const original = context.location.href;
  context.__md_analytics();
  const [js, config] = context.dataLayer.map((command) => Array.from(command));
  assert.equal(js[0], "js");
  assert.equal(config.length, 3, "Arguments length must retain the parameters for queue consumers");
  assert.equal(config[0], "config"); assert.equal(config[1], "G-TEST123456");
  const page = new URL(config[2].page_location);
  assert.equal(page.searchParams.get("payment_intent"), "pi_synthetic");
  assert.equal(page.searchParams.get("utm_source"), "facebook");
  assert.equal(page.searchParams.get("utm_campaign"), "bird frames");
  assert.equal(config[2].page_referrer, "https://theodore.net/store/?utm_medium=email");
  assert.doesNotMatch(JSON.stringify(config), /synthetic_(?:one|two|three|four|five|six|cart|hash)|client_secret|restore_cart/i);
  assert.equal(context.location.href, original);
  assert.equal(context.document.referrer, referrer);
  assert.equal(inserted.length, 1); assert.match(inserted[0].src, /^https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-TEST123456$/);
});

test("Material navigation and theme events get fresh safe URLs rather than the initial location", () => {
  const { context, listeners, navigation, searchListeners } = harness(credentialUrl);
  context.__md_analytics();
  listeners.forEach((listener) => listener());
  context.location = new URL("https://theodore.net/projects/birds/?utm_source=next&restore_cart=synthetic_cart");
  context.document.referrer = credentialUrl;
  navigation[0](context.location);
  const config = Array.from(context.dataLayer.at(-1));
  assert.equal(config[2].page_path, "/projects/birds/");
  assert.equal(config[2].page_location, "https://theodore.net/projects/birds/?utm_source=next");
  assert.doesNotMatch(config[2].page_referrer, /client_secret|restore_cart|synthetic_(one|two|three|four|five|six)/);
  searchListeners[0].call({ value: "bird frame" });
  const event = Array.from(context.dataLayer.at(-1));
  assert.equal(event[0], "event"); assert.equal(event[1], "search");
  assert.equal(event[2].search_term, "bird frame");
  assert.equal(event[2].page_location, config[2].page_location);
});

test("malformed URLs fail closed and harmless query parameters remain available", () => {
  const { context } = harness("https://theodore.net/?utm_source=facebook&fbclid=test-click-id#details");
  for (const referrer of ["", "not a url with client_secret=synthetic", "javascript:client_secret=synthetic"]) {
    const params = context.__theodoreAnalyticsParams({ page_referrer: referrer });
    assert.equal(params.page_referrer, "");
    assert.equal(params.page_location, "https://theodore.net/?utm_source=facebook&fbclid=test-click-id");
  }
  assert.equal(context.__theodoreAnalyticsParams({ page_location: "broken" }).page_location, "");
});
