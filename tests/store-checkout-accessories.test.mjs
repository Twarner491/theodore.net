import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const regular = { id: "electronics", label: "Electronics", price: 180, stripePrice: "price_test" };
const printed = { ...regular, id: "electronics-printed", label: "With printed parts", price: 210 };
const products = [
  { id: "avian-visitors", title: "Frame", published: true, variants: [regular], related: ["avian-mic"] },
  { id: "avian-visitors-kit", title: "Frame Kit", published: true, variants: [regular, printed], related: ["avian-mic"] },
  { id: "avian-mic", title: "Bird Mic Kit", published: true, variants: [regular, printed], related: ["avian-visitors", "avian-visitors-kit"] },
  { id: "bird-mic-case", title: "Mic case", published: true, accessory: true, parentId: "avian-mic", order: 2, variants: [regular] },
  { id: "mic-mount", title: "Mic mount", published: true, accessory: true, parentId: "avian-mic", order: 1, variants: [regular] },
  { id: "avian-visitors-parts", title: "Frame and parts", published: true, accessory: true, parentId: "avian-visitors-kit", variants: [regular] },
  { id: "polargraph", title: "Polargraph", published: true, variants: [regular, printed] },
  { id: "polargraph-parts", title: "Plotter parts", published: true, accessory: true, parentId: "polargraph", variants: [regular] },
  { id: "micron-pens-9", title: "Pens", published: true, accessory: true, parentId: "polargraph", variants: [regular] },
];
function harness(catalog = products, lines = [], { dark = false, imageBg = {}, darkImages = {}, images = [] } = {}) {
  let darkTheme = dark;
  const cartFields = { ".cart-items": { querySelectorAll() { return []; } }, ".cart-sub-val": {}, ".cart-checkout": {} };
  const source = readFileSync(new URL("../docs/assets/js/store.js", import.meta.url), "utf8").replace(/\}\)\(\);\s*$/, `
    PRODUCTS = globalThis.products; cart = globalThis.lines;
    IMAGE_BG = globalThis.imageBg; DARK_IMAGES = globalThis.darkImages;
    globalThis.helpers = { suggestions: checkoutAccessories, html: coAccessoriesHTML, line: coLineHTML, miniCard: accCardHTML, swap: swapProductImages,
      drawer: function () { drawer = globalThis.cartDrawer; renderCart(); return $(".cart-items", drawer).innerHTML; } };
  })();`);
  const context = vm.createContext({
    products: catalog, lines, imageBg, darkImages,
    cartDrawer: { querySelector(selector) { return cartFields[selector]; } },
    document: { readyState: "loading", addEventListener() {}, querySelector() { return null; }, querySelectorAll(selector) { return selector.includes("img.pc-img") ? images : []; }, body: { getAttribute() { return darkTheme ? "slate" : "default"; } }, documentElement: { getAttribute() {} } },
    window: { addEventListener() {} },
    location: { hostname: "example.test" }, URLSearchParams,
    localStorage: { getItem() { return null; } },
  });
  vm.runInContext(source, context);
  return { ...context.helpers, setDark(value) { darkTheme = value; } };
}
const line = (id, build = "electronics") => ({ id, build, qty: 1 });
const ids = (helper) => Array.from(helper.suggestions(), (p) => p.id);

test("checkout gathers compatible authored accessories once and excludes products already in cart", () => {
  const checkout = harness(products, [line("avian-visitors"), line("avian-visitors-kit")]);
  assert.deepEqual(ids(checkout), ["avian-mic", "avian-visitors-parts", "mic-mount"]);
  const withMic = harness(products, [line("avian-visitors"), line("avian-mic")]);
  assert.deepEqual(ids(withMic), ["mic-mount", "bird-mic-case"]);
  assert.deepEqual(ids(harness(products, [line("avian-visitors")])), ["avian-mic", "mic-mount"]);
});

test("mic-only checkout offers both frame choices while complete kits suppress included printed parts", () => {
  assert.deepEqual(ids(harness(products, [line("avian-mic")])), ["avian-visitors", "avian-visitors-kit", "mic-mount"]);
  assert.deepEqual(ids(harness(products, [line("avian-mic", "electronics-printed")])), ["avian-visitors", "avian-visitors-kit", "mic-mount"]);
  assert.deepEqual(ids(harness(products, [line("avian-visitors-kit", "electronics-printed")])), ["avian-mic", "mic-mount"]);
  assert.deepEqual(ids(harness(products, [line("polargraph", "electronics-printed")])), ["micron-pens-9"]);
  assert.ok(ids(harness(products, [line("avian-visitors"), line("avian-mic", "electronics-printed"), line("avian-mic")])).includes("bird-mic-case"), "a separate electronics-only kit can still need its case");
});

test("unpublished, sold-out and unknown finite stock are excluded and only buyable variants appear", () => {
  const more = [
    ...products,
    { id: "unpublished", published: false, accessory: true, parentId: "avian-visitors", variants: [regular] },
    { id: "sold-out", published: true, accessory: true, parentId: "avian-visitors", variants: [{ ...regular, status: "soldout" }] },
    { id: "finite", published: true, accessory: true, parentId: "avian-visitors", variants: [{ ...regular, inventorySku: "finite-stock" }] },
  ].map((p) => p.id === "avian-mic" ? { ...p, variants: [regular, { ...printed, status: "soldout" }] } : p);
  const checkout = harness(more, [line("avian-visitors")]);
  assert.deepEqual(ids(checkout), []);
  assert.equal(checkout.html(), "", "an unavailable printed build never falls back to electronics");
  assert.equal(harness(more, [line("micron-pens-9")]).html(), "");
});

test("checkout omits product setup and handmade prose from line items", () => {
  const catalog = products.map((p) => p.id === "avian-visitors" ? { ...p, variants: [{ ...regular, softwareNote: 'I assemble each frame by hand.' }] } : p.id === "avian-mic" ? { ...p, softwareNote: 'Hardware only. Install <software> at first setup.' } : p);
  const html = harness(catalog).line(line("avian-visitors"), 0);
  assert.doesNotMatch(html, /assemble|co-line-note/);
  assert.match(html, /aria-label="Remove Frame"/);
  assert.doesNotMatch(harness(catalog).line(line("avian-mic"), 0), /Hardware only|software|co-line-note/);
  const card = harness(catalog, [line("avian-visitors")]).html();
  assert.match(card, /data-build="electronics-printed"/);
  assert.match(card, /With printed parts/);
  assert.doesNotMatch(card, /<select|Optional/);
});

test("shared mini-cards use the exact variant image and its sampled background in either theme", () => {
  const catalog = products.map((p) => p.id === "avian-mic" ? { ...p, imageBase: "/images/", images: ["hero.png", "electronics.png"], variants: [{ ...regular, image: "electronics.png" }] } : p);
  const theme = { imageBg: { "/images/electronics.png": "#ffffff", "/images/electronicsDARK.png": "#212226" }, darkImages: { "/images/electronics.png": true } };
  for (const dark of [false, true]) {
    const html = harness(catalog, [line("avian-visitors")], { ...theme, dark }).html();
    assert.match(html, /product-card product-card--mini co-accessory/);
    assert.ok(html.includes('src="/images/electronics' + (dark ? 'DARK' : '') + '.png"'));
    assert.ok(html.includes('style="background:' + (dark ? '#212226' : '#ffffff') + '"'));
    assert.match(html, /class="pc-add"/);
    assert.doesNotMatch(html, /class="co-accessory-add"|src="\/images\/hero/);
  }
});

test("product-page mini-cards prefer printed builds at their exact price and omit unavailable printed kits", () => {
  const p = { ...products.find((p) => p.id === "avian-mic"), defaultBuild: "electronics", imageBase: "/images/", variants: [regular, { ...printed, image: "printed.png" }] };
  const page = harness([p]);
  const html = page.miniCard(p);
  assert.match(html, /data-build="electronics-printed"/);
  assert.match(html, /src="\/images\/printed\.png"/);
  assert.match(html, /\$210/);
  assert.doesNotMatch(html, /class="from"|\$180/);
  assert.equal(page.miniCard({ ...p, variants: [regular, { ...printed, status: "soldout" }] }), "");
});

test("cart and checkout thumbnails paint the image background initially and on both theme changes", () => {
  const product = { ...products.find((p) => p.id === "avian-mic"), imageBase: "/images/", images: ["bird-mic.png"] };
  const url = "/images/bird-mic.png", darkUrl = "/images/bird-micDARK.png";
  const images = ["cart-line-img", "co-line-img"].map((className) => ({
    src: url, style: {}, getAttribute(name) { return name === "src" ? this.src : null; }, setAttribute(name, value) { if (name === "src") this.src = value; }, removeAttribute() {},
    closest(selector) { return selector.includes("." + className) ? this : null; },
  }));
  const h = harness([product], [line(product.id, "electronics-printed")], {
    imageBg: { [url]: "#f7f6f6", [darkUrl]: "#2d2e32" }, darkImages: { [url]: true }, images,
  });
  for (const dark of [false, true, false]) {
    h.setDark(dark);
    const color = dark ? "#2d2e32" : "#f7f6f6";
    for (const html of [h.line(line(product.id), 0), h.drawer()]) {
      assert.ok(html.includes('style="background:' + color + '"'));
      assert.ok(html.includes('src="' + (dark ? darkUrl : url) + '"'));
    }
    h.swap();
    for (const image of images) {
      assert.equal(image.src, dark ? darkUrl : url);
      assert.equal(image.style.background, color);
    }
  }
});
