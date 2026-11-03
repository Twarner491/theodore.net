import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const SKU = "avian-gen3-batch-02";
const product = {
  id: "avian-visitors", published: true, defaultBuild: "assembled-batch-2",
  variants: [{ id: "assembled-batch-2", status: "available", price: 699,
    stripePrice: "price_live", inventorySku: SKU, contents: [] }],
};

function detailHarness({ fetch, search = "?join=1", configuredProduct = product } = {}) {
  const source = readFileSync(new URL("../docs/assets/js/store.js", import.meta.url), "utf8").replace(/\}\)\(\);\s*$/, `
    const handlers = {};
    const input = { value: "bird@example.com", focus() {}, addEventListener() {} };
    const form = { addEventListener(type, callback) { handlers[type] = callback; } };
    const waitlist = { hidden: true, innerHTML: "", scrollIntoView() {}, querySelector(selector) {
      return selector === "input" ? input : selector === ".pe-wl-form" ? form : null;
    } };
    const buy = { disabled: false, innerHTML: "", textContent: "", style: {},
      classList: { add() {}, remove() {} }, addEventListener(type, callback) { handlers.buy = callback; } };
    const elements = {
      ".pe-box-contents": { innerHTML: "" }, ".pe-qty span": { textContent: "" },
      ".pe-price": { innerHTML: "" }, ".pe-qty": { style: {} },
      ".pe-buy": buy, ".pe-waitlist": waitlist,
      ".pe-arrow.prev": { addEventListener() {} }, ".pe-arrow.next": { addEventListener() {} }
    };
    root = { querySelector(selector) { return elements[selector] || null; }, querySelectorAll() { return []; } };
    PRODUCTS = [globalThis.product]; P = globalThis.product; build = P.defaultBuild; qty = 1;
    renderAccessories = function () {}; renderCart = function () {};
    wireDetailProductLinks = function () {}; wireSlider = function () {}; track = function () {};
    wireDetail(); updateVariant(false);
    globalThis.harness = {
      check: checkInventoryAvailability,
      join: function () { maybeAutoWaitlist(P); },
      open: openWaitlist,
      click: function () { handlers.buy(); },
      submit: function () { handlers.submit({ preventDefault() {} }); },
      inventory: function (available) {
        INVENTORY_READY = true; INVENTORY_ROWS = { [globalThis.sku]: { available, soldOut: available === 0 } };
      },
      state: function () { return { label: buy.textContent, html: buy.innerHTML, disabled: buy.disabled,
        price: elements[".pe-price"].innerHTML, waitlistHidden: waitlist.hidden, form: waitlist.innerHTML,
        search: location.search, email: input.value }; }
    };
  })();`);
  const location = { hostname: "theodore.net", pathname: "/store/avian-visitors/", search, hash: "" };
  const context = vm.createContext({
    document: { readyState: "loading", addEventListener() {},
      querySelector(selector) { return selector === "#product-detail" ? {} : null; },
      querySelectorAll() { return []; }, getElementById() { return null; } },
    window: { addEventListener() {} },
    location, URLSearchParams, product: configuredProduct, sku: SKU, fetch,
    history: { replaceState(_state, _title, url) { location.search = new URL(url, "https://theodore.net").search; } },
    localStorage: { getItem() { return null; }, setItem() {} },
    setTimeout() { return 1; }, clearTimeout() {},
  });
  vm.runInContext(source, context, { filename: "store.js" });
  return context.harness;
}

const response = (available) => ({ ok: true, json: async () => ({ inventory: [{ sku: SKU, available, soldOut: available === 0 }] }) });
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("a pending or failed inventory read never exposes the waitlist, and its retry button recovers", async () => {
  let resolveFirst;
  let calls = 0;
  const detail = detailHarness({ fetch() {
    calls += 1;
    return calls === 1 ? new Promise((resolve) => { resolveFirst = resolve; }) : Promise.resolve(response(99));
  } });
  const pending = detail.check();
  detail.join(); detail.open(); detail.click();
  assert.equal(detail.state().label, "Checking availability");
  assert.equal(detail.state().disabled, true);
  assert.equal(detail.state().waitlistHidden, true);
  assert.doesNotMatch(detail.state().price, /Sold out/);
  assert.equal(calls, 1);

  resolveFirst({ ok: false, json: async () => ({ error: "unavailable" }) });
  assert.equal(await pending, false);
  detail.join(); detail.open();
  assert.equal(detail.state().label, "Check availability");
  assert.equal(detail.state().disabled, false);
  assert.equal(detail.state().waitlistHidden, true);

  detail.click();
  await settle();
  assert.equal(calls, 2);
  assert.match(detail.state().html, /Add to cart/);
  assert.equal(detail.state().waitlistHidden, true);
  detail.join(); detail.open();
  assert.equal(detail.state().waitlistHidden, true);
});

test("a waitlist deep link waits for a confirmed sellout and still opens then", async () => {
  let resolveInventory;
  const search = "?join=1&email=waiting%40example.com&variant=assembled-batch-2&go=waitlist";
  const detail = detailHarness({ search, fetch: () => new Promise((resolve) => { resolveInventory = resolve; }) });
  const pending = detail.check();
  detail.join();
  assert.equal(detail.state().waitlistHidden, true);
  assert.equal(detail.state().search, search);
  resolveInventory(response(0));
  assert.equal(await pending, true);
  assert.equal(detail.state().waitlistHidden, false);
  assert.match(detail.state().form, /Email for availability notifications/);
  assert.equal(detail.state().email, "waiting@example.com");
  assert.equal(detail.state().search, "?go=waitlist");
});

test("a waitlist deep link scrubs its email once stock is confirmed available", async () => {
  const detail = detailHarness({
    search: "?join=1&email=waiting%40example.com&variant=assembled-batch-2&go=waitlist",
    fetch: async () => response(99),
  });
  detail.join();
  assert.match(detail.state().search, /email=/);
  assert.equal(await detail.check(), true);
  assert.equal(detail.state().waitlistHidden, true);
  assert.match(detail.state().html, /Add to cart/);
  assert.equal(detail.state().search, "?go=waitlist");
});

test("a form opened while sold out cannot subscribe after stock becomes available", () => {
  let requests = 0;
  const detail = detailHarness({ fetch() { requests += 1; throw new Error("Unexpected signup"); } });
  detail.inventory(0); detail.open();
  assert.equal(detail.state().waitlistHidden, false);
  detail.inventory(99); detail.submit();
  assert.equal(requests, 0);
  assert.equal(detail.state().waitlistHidden, true);
  assert.match(detail.state().html, /Add to cart/);
});

test("coming-soon products still accept a waitlist deep link", () => {
  const detail = detailHarness({ configuredProduct: {
    ...product, variants: [{ ...product.variants[0], status: "comingSoon" }],
  } });
  detail.join();
  assert.equal(detail.state().waitlistHidden, false);
  assert.match(detail.state().form, /Email for availability notifications/);
});
