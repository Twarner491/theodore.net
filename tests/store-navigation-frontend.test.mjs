import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function harness({ document = {}, recovery } = {}) {
  const original = readFileSync(new URL("../docs/assets/js/store.js", import.meta.url), "utf8");
  const source = original.replace(/\}\)\(\);\s*$/, `
    cart = [{ id: "test", build: "test", qty: 2 }];
    if (globalThis.recovery) localRecovery = globalThis.recovery;
    openCart = function () { globalThis.opened += 1; }; track = function () {};
    globalThis.helpers = { checkout, reveal, loadStripe, injectHeaderCart, storeIcon, productIcon };
  })();`);
  const context = vm.createContext({
    document: { readyState: "loading", addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, body: {}, documentElement: {}, ...document },
    window: { addEventListener() {} }, location: { hostname: "example.test", href: "/store/" },
    URLSearchParams, setTimeout, clearTimeout, recovery, opened: 0,
    localStorage: { getItem() { return null; } },
  });
  vm.runInContext(source, context);
  return context;
}

test("checkout navigates immediately even while optional recovery remains pending", async () => {
  let flushed = 0;
  const h = harness({ recovery: { flush() { flushed += 1; return new Promise(() => {}); } } });
  await h.helpers.checkout();
  assert.equal(flushed, 1);
  assert.equal(h.location.href, "/store/checkout/");
});

test("an existing header cart is enabled, bound once and updated without replacing its markup", () => {
  const badge = { textContent: "0" }, handlers = [];
  const button = { disabled: true, dataset: {}, classList: { toggle() {} }, querySelector() { return badge; }, addEventListener(type, listener) { handlers.push(listener); } };
  const inner = { querySelector() { return button; } };
  const h = harness({ document: { querySelector(selector) { return selector === ".md-header__inner" ? inner : null; } } });
  h.helpers.injectHeaderCart(); h.helpers.injectHeaderCart();
  assert.equal(button.disabled, false);
  assert.equal(badge.textContent, "2");
  assert.equal(handlers.length, 1);
  handlers[0](); assert.equal(h.opened, 1);
});

test("store content is revealed immediately without waiting for intersection observation", () => {
  const visible = new Set();
  const h = harness({ document: { querySelectorAll() { return [0, 1, 2].map((id) => ({ classList: { add(name) { if (name === "visible") visible.add(id); } } })); } } });
  h.helpers.reveal();
  assert.deepEqual([...visible], [0, 1, 2]);
});

test("store navigation and product fallbacks use decorative inline SVG without a font runtime", () => {
  const { helpers } = harness();
  for (const name of ["arrow-left-long", "chevron-down", "chevron-left", "chevron-right", "cube", "cubes", "screwdriver-wrench", "pen-nib", "image"]) {
    const html = helpers.storeIcon(name, "co-chev");
    assert.match(html, /^<svg class="store-icon co-chev"/);
    assert.match(html, /aria-hidden="true" focusable="false"/);
    assert.match(html, /<path d="[^"]+"/);
    assert.doesNotMatch(html, /<i |https?:|<use/);
  }
  assert.equal(helpers.productIcon("fa-solid fa-pen-nib"), helpers.storeIcon("pen-nib"));
  assert.equal(helpers.productIcon('unknown <script>'), helpers.storeIcon("cube"));
});

test("Stripe loads once asynchronously, then retries after a failed request", async () => {
  const scripts = [];
  const h = harness({ document: {
    createElement(tag) {
      assert.equal(tag, "script");
      return { handlers: {}, addEventListener(type, listener) { this.handlers[type] = listener; }, remove() { this.removed = true; } };
    },
    head: { appendChild(script) { scripts.push(script); } },
  } });
  const first = h.helpers.loadStripe(), duplicate = h.helpers.loadStripe();
  assert.equal(first, duplicate);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, "https://js.stripe.com/v3/");
  assert.equal(scripts[0].async, true);
  scripts[0].handlers.error();
  assert.equal(await first, false); assert.equal(scripts[0].removed, true);
  const retry = h.helpers.loadStripe();
  assert.equal(scripts.length, 2);
  h.window.Stripe = () => {};
  scripts[1].handlers.load();
  assert.equal(await retry, true);
  assert.equal(await h.helpers.loadStripe(), true);
  assert.equal(scripts.length, 2);
});
