// Timed drops: the storefront gate (store.js), the checkout gate (payment-intent.js), and the
// email countdown GIF (lib/countdown-gif.js + functions/api/countdown.js).
process.env.TZ = "America/Los_Angeles";   // node --test runs each file in its own process

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { onRequestPost as paymentIntent } from "../functions/api/payment-intent.js";
import { onRequestGet as countdownImage } from "../functions/api/countdown.js";
import { countdownDigits, countdownGif } from "../lib/countdown-gif.js";
import ART from "../lib/countdown-art.js";

const LAUNCH = "2026-10-29T16:00:00Z";
const AT = Date.parse(LAUNCH);

function storeHelpers(now, overrides = {}) {
  const original = readFileSync(new URL("../docs/assets/js/store.js", import.meta.url), "utf8");
  const source = original.replace(/\}\)\(\);\s*$/, `
    globalThis.__launch = {
      setProducts: function (value) { PRODUCTS = value; },
      setInventory: function (rows, ready) { INVENTORY_ROWS = rows; INVENTORY_READY = ready; },
      statusOf: statusOf, buyable: buyable, countdownTarget: countdownTarget, launchText: launchText,
      statusTag: statusTag, countdownParts: countdownParts, batchAvailabilityText: batchAvailabilityText,
      detailState: function (product) {
        const started = [];
        startCountdown = function (host, v, at) { started.push(at); host.hidden = false; };
        const buy = { classList: { add: function () {}, remove: function () {} }, disabled: false, innerHTML: "", style: {}, textContent: "" };
        const elements = {
          ".pe-box-contents": { innerHTML: "" }, ".pe-qty span": { textContent: "" },
          ".pe-price": { innerHTML: "" }, ".pe-qty": { style: {} }, ".pe-buy": buy,
          ".pe-waitlist": { hidden: false, innerHTML: "" }, ".pe-batch": { textContent: "", hidden: true },
          ".pe-countdown": { hidden: true, innerHTML: "" },
        };
        root = { querySelector: function (s) { return elements[s] || null; }, querySelectorAll: function () { return []; } };
        PRODUCTS = [product]; P = product; build = product.defaultBuild; qty = 1;
        updateVariant(false);
        return { started: started, buyDisplay: buy.style.display, buyLabel: buy.textContent, price: elements[".pe-price"].innerHTML,
                 batch: elements[".pe-batch"].textContent, countdownHidden: elements[".pe-countdown"].hidden };
      }
    };
  })();`);
  assert.notEqual(source, original, "store.js must remain one trailing IIFE");
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(now); }
    static now() { return now; }
  }
  const context = vm.createContext({
    document: {
      readyState: "loading", addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
      getElementById() { return null; }, body: { getAttribute() { return null; } }, documentElement: { getAttribute() { return null; } },
    },
    window: { addEventListener() {} },
    URLSearchParams,
    localStorage: { getItem() { return null; }, setItem() {} },
    Date: FixedDate,
    ...overrides,
  });
  vm.runInContext(source, context, { filename: "store.js" });
  return context.__launch;
}

const sellable = { id: "assembled", label: "Assembled", price: 699, stripePrice: "price_test", launchAt: LAUNCH, launchLabel: "Batch 1" };
const product = (variant) => ({ id: "avian-visitors", published: true, defaultBuild: "assembled", variants: [variant] });

test("a sellable variant stays closed on every surface until its launchAt", () => {
  const before = storeHelpers(AT - 1000);
  before.setProducts([product(sellable)]);
  assert.equal(before.statusOf(sellable), "comingSoon");
  assert.equal(before.buyable(sellable), false);
  assert.equal(before.countdownTarget(sellable), AT);

  const after = storeHelpers(AT);
  after.setProducts([product(sellable)]);
  assert.equal(after.statusOf(sellable), "available");
  assert.equal(after.buyable(sellable), true);
  assert.equal(after.countdownTarget(sellable), null);
});

test("an unreadable launchAt never opens and never counts down", () => {
  const helpers = storeHelpers(AT + 86400000);
  const broken = { ...sellable, launchAt: "next thursday" };
  helpers.setProducts([product(broken)]);
  assert.equal(helpers.buyable(broken), false);
  assert.equal(helpers.countdownTarget(broken), null);
});

test("launch copy reads in the viewer's time zone and card tags stay short", () => {
  const helpers = storeHelpers(AT - 5000);
  helpers.setProducts([product(sellable)]);
  assert.equal(helpers.launchText(sellable), "Batch 1 opens Thu, Oct 29, 9:00 AM PDT");
  assert.equal(helpers.statusTag(sellable), "Batch 1 opens Oct 29");
  assert.equal(helpers.statusTag({ ...sellable, launchLabel: "<b>" }), "&lt;b&gt; opens Oct 29");
});

test("the countdown rounds up to whole seconds so 00s lands exactly at launch", () => {
  const helpers = storeHelpers(0);
  assert.deepEqual(Array.from(helpers.countdownParts(1)), [0, 0, 0, 1]);
  assert.deepEqual(Array.from(helpers.countdownParts(90061000)), [1, 1, 1, 1]);
  assert.deepEqual(Array.from(helpers.countdownParts(-5)), [0, 0, 0, 0]);
});

test("a pending drop swaps the buy button for the countdown and keeps the batch size private", () => {
  const held = { ...sellable, status: "soldout", batchSize: 20, batchSizePrivate: true };
  const state = storeHelpers(AT - 60000).detailState(product(held));
  assert.deepEqual(Array.from(state.started), [AT]);
  assert.equal(state.buyDisplay, "none");
  assert.equal(state.countdownHidden, false);
  assert.equal(state.price, "$699");
  assert.equal(state.batch, "Batch 1 opens Thu, Oct 29, 9:00 AM PDT");

  const closed = storeHelpers(AT + 1000).detailState(product(held));   // date passed, still not sellable
  assert.deepEqual(Array.from(closed.started), []);
  assert.equal(closed.buyLabel, "Notify me");
  assert.match(closed.price, /Sold out/);
});

test("a private batch shows only a low-stock count, never its size", () => {
  const helpers = storeHelpers(AT + 1000);
  const v = { ...sellable, inventorySku: "avian-gen3-batch-01", batchSize: 20, batchSizePrivate: true };
  helpers.setProducts([product(v)]);
  for (const [available, text] of [[20, ""], [6, ""], [5, "Only 5 left"], [1, "Only 1 left"], [0, ""]]) {
    helpers.setInventory({ "avian-gen3-batch-01": { available, soldOut: available === 0 } }, true);
    assert.equal(helpers.batchAvailabilityText(v, product(v)), text);
  }
});

// ---- checkout gate ----
const CATALOG = (launchAt) => ({
  "avian-visitors": { title: "Avian Visitors", variants: { assembled: { price: "price_assembled", weightLb: 4, maxQty: 1, label: "Assembled", priceUsd: 699, launchAt } } },
});
async function attempt(launchAt, qty = 1) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(String(url)); return Response.json(CATALOG(launchAt)); };
  try {
    const response = await paymentIntent({
      request: new Request("https://example.test/api/payment-intent", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ cart: [{ id: "avian-visitors", build: "assembled", qty }] }),
      }),
      env: { STRIPE_SECRET_KEY: "sk_test_checkout", STRIPE_PUBLISHABLE_KEY: "pk_test_checkout" },
    });
    return { status: response.status, body: await response.json(), calls };
  } finally { globalThis.fetch = original; }
}

test("checkout refuses a drop before its launchAt without calling Stripe", async () => {
  const future = new Date(Date.now() + 3600000).toISOString().replace(/\.\d+Z$/, "Z");
  const result = await attempt(future);
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "Avian Visitors is not open yet.");
  assert.deepEqual(result.calls, ["https://example.test/store-catalog.json"]);

  const unreadable = await attempt("soon");
  assert.equal(unreadable.status, 400);
  assert.match(unreadable.body.error, /not open yet/);
});

test("an opened drop passes the launch gate to the ordinary checks", async () => {
  const result = await attempt("2020-01-01T00:00:00Z", 2);   // past launch, over the per-order cap
  assert.equal(result.status, 400);
  assert.match(result.body.error, /at most 1/);
});

// ---- email countdown GIF ----
function decodeGif(bytes) {
  let p = 0;
  const u8 = () => bytes[p++], u16 = () => { const v = bytes[p] | (bytes[p + 1] << 8); p += 2; return v; };
  assert.equal(String.fromCharCode(...bytes.subarray(0, 6)), "GIF89a"); p = 6;
  const W = u16(), H = u16(), packed = u8(); u8(); u8();
  assert.equal(packed & 0x80, 0x80);
  p += 3 * (1 << ((packed & 7) + 1));
  const canvas = new Uint8Array(W * H).fill(255), frames = [];
  let delay = 0;
  for (;;) {
    const block = u8();
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = u8();
      if (label === 0xf9) { u8(); u8(); delay = u16(); u8(); u8(); }
      else { for (let n = u8(); n; n = u8()) p += n; }
      continue;
    }
    assert.equal(block, 0x2c);
    const x = u16(), y = u16(), w = u16(), h = u16(); assert.equal(u8() & 0x80, 0);
    const minCode = u8(), data = [];
    for (let n = u8(); n; n = u8()) { for (let i = 0; i < n; i++) data.push(bytes[p + i]); p += n; }
    // LZW decode
    const clear = 1 << minCode, eoi = clear + 1, out = [];
    let size = minCode + 1, dict = [], prev = null, bit = 0;
    const reset = () => { dict = []; for (let i = 0; i < clear; i++) dict[i] = [i]; dict[clear] = []; dict[eoi] = []; size = minCode + 1; prev = null; };
    reset();
    for (;;) {
      let code = 0;
      for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
      if (code === clear) { reset(); continue; }
      if (code === eoi) break;
      let entry = dict[code];
      if (!entry) { assert.ok(prev, "bad first code"); entry = prev.concat(prev[0]); }
      out.push(...entry);
      if (prev) { dict.push(prev.concat(entry[0])); if (dict.length === (1 << size) && size < 12) size++; }
      prev = entry;
    }
    assert.equal(out.length, w * h);
    for (let row = 0; row < h; row++) canvas.set(out.slice(row * w, row * w + w), (y + row) * W + x);
    frames.push({ pixels: canvas.slice(), delay });
  }
  return { W, H, frames };
}
async function inflate(b64) {
  const stream = new Blob([Buffer.from(b64, "base64")]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function expected(base, digits = []) {
  const frame = await inflate(ART[base]);
  const tiles = await Promise.all(ART.digits.map(inflate));
  digits.forEach((n, i) => {
    const [x, y] = ART.cells[i];
    for (let row = 0; row < ART.tileHeight; row++)
      frame.set(tiles[n].subarray(row * ART.tileWidth, (row + 1) * ART.tileWidth), (y + row) * ART.width + x);
  });
  return frame;
}

test("countdown digits match the page and cap days at two slots", () => {
  assert.deepEqual(countdownDigits(90061000), [0, 1, 0, 1, 0, 1, 0, 1]);
  assert.deepEqual(countdownDigits(1), [0, 0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(countdownDigits(400 * 86400000), [9, 9, 0, 0, 0, 0, 0, 0]);
});

test("the GIF decodes to exactly the page's countdown, ticking on the site's second boundary", async () => {
  const now = AT - (12 * 86400 + 3 * 3600 + 25 * 60 + 9) * 1000 - 650;   // 12d 03h 25m 09.65s left
  const { W, H, frames } = decodeGif(await countdownGif(AT, now));
  assert.deepEqual([W, H], [ART.width, ART.height]);
  assert.equal(frames.length, 60);
  assert.equal(frames[0].delay, 65);                            // the 0.65s left in the current second
  assert.ok(frames.slice(1).every((f) => f.delay === 100));
  assert.deepEqual(frames[0].pixels, await expected("countdown", [1, 2, 0, 3, 2, 5, 1, 0]));   // shows 10s
  assert.deepEqual(frames[10].pixels, await expected("countdown", [1, 2, 0, 3, 2, 5, 0, 0]));
  assert.deepEqual(frames[11].pixels, await expected("countdown", [1, 2, 0, 3, 2, 4, 5, 9]));  // minute rollover
});

test("the GIF flips to the open state when the drop opens mid-animation, and after it", async () => {
  const last = decodeGif(await countdownGif(AT, AT - 3000)).frames;
  assert.equal(last.length, 4);
  assert.deepEqual(last[3].pixels, await expected("open"));
  const open = decodeGif(await countdownGif(AT, AT + 1)).frames;
  assert.equal(open.length, 1);
  assert.deepEqual(open[0].pixels, await expected("open"));
});

test("the countdown endpoint serves an uncached GIF for a known drop and 404s otherwise", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ "avian-visitors": { launchAt: LAUNCH, label: "Batch 1" } });
  try {
    const ok = await countdownImage({ request: new Request("https://example.test/api/countdown?id=avian-visitors") });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-type"), "image/gif");
    assert.match(ok.headers.get("cache-control"), /no-store/);
    assert.equal(String.fromCharCode(...new Uint8Array(await ok.arrayBuffer()).subarray(0, 6)), "GIF89a");
    for (const id of ["nope", "__proto__", ""]) {
      const missing = await countdownImage({ request: new Request("https://example.test/api/countdown?id=" + id) });
      assert.equal(missing.status, 404);
    }
  } finally { globalThis.fetch = original; }
});

// ---- confirmation page for a limited-batch authorization ----
async function confirmation(statuses) {
  const original = readFileSync(new URL("../docs/assets/js/store.js", import.meta.url), "utf8");
  const source = original.replace(/\}\)\(\);\s*$/, `
    globalThis.__confirm = async function () {
      const host = globalThis.__host;
      const seen = [];
      ga4 = function (name) { seen.push(name); };
      renderOrder = function (h, d) { h.innerHTML = "ORDER " + d.status; };
      renderLookup = function (h, note) { h.innerHTML = "LOOKUP " + (note || ""); };
      updateBadge = function () {}; reveal = function () {};
      await renderConfirmation();
      return { html: host.innerHTML, ga4: seen };
    };
  })();`);
  let call = 0;
  const host = { innerHTML: "" };
  const context = vm.createContext({
    __host: host,
    document: { readyState: "loading", addEventListener() {}, querySelector(selector) { return selector === "#confirmation" ? host : null; }, querySelectorAll() { return []; },
                body: { getAttribute() { return null; } }, documentElement: { getAttribute() { return null; } } },
    window: { addEventListener() {} },
    location: { search: "?payment_intent=pi_123&payment_intent_client_secret=pi_123_secret_x&redirect_status=succeeded", hostname: "theodore.net" },
    URLSearchParams,
    localStorage: { getItem() { return null; }, setItem() {} },
    setTimeout: (fn) => { queueMicrotask(fn); return 0; },
    fetch: async () => {
      const d = statuses[Math.min(call++, statuses.length - 1)];
      return { ok: true, json: async () => ({ orderNo: "ABC123", items: [{ id: "avian-visitors", build: "assembled", qty: 1 }], ...d }) };
    },
  });
  vm.runInContext(source, context, { filename: "store.js" });
  return context.__confirm();
}

test("an authorized limited-batch order waits for capture before it is confirmed", async () => {
  const won = await confirmation([{ status: "requires_capture" }, { status: "requires_capture" }, { status: "succeeded" }]);
  assert.equal(won.html, "ORDER succeeded");
  assert.deepEqual(Array.from(won.ga4), ["purchase"]);
});

test("losing the last unit says sold out, never confirmed, and counts no purchase", async () => {
  const lost = await confirmation([{ status: "requires_capture" }, { status: "canceled", soldOut: true }]);
  assert.match(lost.html, /This batch sold out/);
  assert.match(lost.html, /card was not charged/);
  assert.match(lost.html, /href="\/store\/avian-visitors\/\?join=1"/);
  assert.doesNotMatch(lost.html, /ORDER/);
  assert.deepEqual(Array.from(lost.ga4), []);
});

test("an authorization that never settles is reported as still confirming", async () => {
  const pending = await confirmation([{ status: "requires_capture" }]);
  assert.match(pending.html, /still confirming/);
  assert.match(pending.html, /ABC123/);
  assert.deepEqual(Array.from(pending.ga4), []);
});
