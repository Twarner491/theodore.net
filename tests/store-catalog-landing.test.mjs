import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function landing(product, query) {
  const elements = Object.fromEntries([".pe-box-contents", ".pe-qty span", ".pe-price", ".pe-qty", ".pe-buy"].map((key) => [key, {
    innerHTML: "", textContent: "", style: {}, classList: { add() {}, remove() {} },
  }]));
  const root = { querySelector: (key) => elements[key] || null, querySelectorAll: () => [] };
  const original = readFileSync(new URL("../docs/assets/js/store.js", import.meta.url), "utf8");
  const source = original.replace(/\}\)\(\);\s*$/, `
    PRODUCTS = [globalThis.product];
    reconcileTrail = () => [];
    detailHTML = () => "";
    renderCarousel = (image) => { globalThis.initialImage = image; };
    wireDetail = renderAccessories = syncPill = goto = () => {};
    track = (name, data) => { globalThis.events.push({ name, data }); };
    ga4 = (name, data) => { globalThis.gaEvents.push({ name, data }); };
    renderDetail(globalThis.product);
    globalThis.selectedBuild = build;
  })();`);
  assert.notEqual(source, original);
  const context = vm.createContext({
    product, events: [], gaEvents: [],
    document: { readyState: "loading", addEventListener() {}, querySelector: (key) => key === "#product-detail" ? root : null, querySelectorAll: () => [] },
    window: { addEventListener() {} },
    location: { hostname: "theodore.net", pathname: `/store/${product.id}/`, search: query },
    URLSearchParams, localStorage: { getItem() { return null; } }, setTimeout() {}, clearTimeout() {},
  });
  vm.runInContext(source, context, { filename: "store.js" });
  return { context, elements };
}

for (const [id, basePrice, price] of [["avian-visitors-kit", 450, 520], ["avian-mic", 180, 210]]) {
  test(`${id} catalog landing selects the complete kit and preserves paid attribution parameters`, () => {
    const product = { id, title: id, defaultBuild: "electronics", images: ["overview.png", "printed.png"], variants: [
      { id: "electronics", price: basePrice, stripePrice: "price_electronics" },
      { id: "electronics-printed", price, stripePrice: "price_printed", image: "printed.png", contents: ["Printed parts included"] },
    ] };
    const query = "?variant=electronics-printed&utm_source=instagram&utm_medium=paid_social&utm_campaign=av3&av_creative=photo&fbclid=example-click";
    const { context, elements } = landing(product, query);
    assert.equal(context.selectedBuild, "electronics-printed");
    assert.equal(context.initialImage, "printed.png");
    assert.equal(elements[".pe-price"].innerHTML, `$${price}`);
    assert.match(elements[".pe-buy"].innerHTML, new RegExp(`Add to cart.*\\$${price}`));
    assert.match(elements[".pe-box-contents"].innerHTML, /Printed parts included/);
    assert.equal(context.location.search, query);
    assert.equal(context.events[0].data.build, "electronics-printed");
    assert.equal(context.events[0].data.value, price * 100);
    assert.equal(context.gaEvents[0].data.items[0].item_variant, "electronics-printed");
    assert.equal(context.gaEvents[0].data.value, price);
  });
}
