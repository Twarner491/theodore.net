import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function accessoryHarness(reducedMotion) {
  let section = null;
  const timers = [];
  const detail = { insertAdjacentElement(_position, element) { section = element; } };
  const document = {
    readyState: "loading",
    addEventListener() {},
    body: { getAttribute() { return null; } },
    documentElement: { getAttribute() { return null; } },
    querySelector(selector) {
      if (selector === "#product-detail") return detail;
      if (selector === ".pd-accessories") return section;
      return null;
    },
    querySelectorAll(selector) {
      return selector.includes(".product-card") ? section?.cards || [] : [];
    },
    createElement() {
      return {
        cards: [],
        addEventListener() {},
        remove() { section = null; },
        set innerHTML(html) {
          this.html = html;
          this.cards = Array.from(html.matchAll(/class="(product-card[^"]*)" data-acc="([^"]+)"/g), ([, classes, id]) => {
            const names = new Set(classes.split(" "));
            return {
              dataset: { acc: id },
              style: {},
              classList: { add: (name) => names.add(name), contains: (name) => names.has(name) },
              querySelector() { return null; },
            };
          });
        },
      };
    },
  };
  const original = readFileSync(new URL("../docs/assets/js/store.js", import.meta.url), "utf8");
  const source = original.replace(/\}\)\(\);\s*$/, `
    updateVariant = function () {};
    renderCart = function () {};
    globalThis.__accessories = {
      start: function (products, product) {
        PRODUCTS = products; P = product; root = document.querySelector("#product-detail");
        renderAccessories(P); reveal();
      },
      refresh: refreshInventorySurfaces
    };
  })();`);
  assert.notEqual(source, original);
  const context = vm.createContext({
    document,
    window: { addEventListener() {}, matchMedia() { return { matches: reducedMotion }; } },
    URLSearchParams,
    localStorage: { getItem() { return null; }, setItem() {} },
    setTimeout(callback) { timers.push(callback); },
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; }
      observe(target) { this.callback([{ target, isIntersecting: true }]); }
      unobserve() {}
    },
  });
  vm.runInContext(source, context, { filename: "store.js" });
  return {
    ...context.__accessories,
    section: () => section,
    flushTimers() { timers.splice(0).forEach((callback) => callback()); },
  };
}

const parent = { id: "display", related: ["microphone"] };
const variant = { id: "default", price: 30, stripePrice: "price_test" };
const products = [
  parent,
  { id: "frame", title: "Frame", accessory: true, parentId: "display", published: true, variants: [variant] },
  { id: "microphone", title: "Microphone", published: true, variants: [variant] },
];

for (const reducedMotion of [false, true]) {
  test(`inventory refresh keeps accessory and related cards visible (reduced motion: ${reducedMotion})`, () => {
    const page = accessoryHarness(reducedMotion);
    page.start(products, parent);
    page.flushTimers();
    const initial = page.section();
    assert.ok(initial.cards.every((card) => card.classList.contains("visible")));

    page.refresh();
    page.flushTimers();
    assert.notEqual(page.section(), initial, "inventory refresh replaces the accessory section");
    assert.deepEqual(page.section().cards.map((card) => card.dataset.acc), ["frame", "microphone"]);
    assert.ok(page.section().cards.every((card) => card.classList.contains("visible")), "replacement cards must be revealed");
  });
}

test("a product without accessories or related products has no accessory heading", () => {
  const page = accessoryHarness(false);
  page.start(products, parent);
  page.start(products, { id: "standalone" });
  page.refresh();
  assert.equal(page.section(), null);
});
