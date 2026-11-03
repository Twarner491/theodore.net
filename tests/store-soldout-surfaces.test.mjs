import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";


function searchRenderers({ products = [], labels = [], fetch } = {}) {
  const original = fs.readFileSync(new URL("../docs/assets/js/search.js", import.meta.url), "utf8");
  const source = original.replace(/\}\)\(\);\s*$/, `
    globalThis.__searchRenderers = { cardEl: cardEl, rowEl: rowEl, loadProductAvailability: loadProductAvailability };
  })();`);
  assert.notEqual(source, original, "search.js must remain one trailing IIFE");

  const document = {
    readyState: "loading",
    addEventListener() {},
    querySelectorAll() { return labels; },
    createElement() {
      return {
        className: "",
        href: "",
        innerHTML: "",
        setAttribute() {},
      };
    },
    body: { getAttribute() { return null; } },
    documentElement: { getAttribute() { return null; } },
  };
  const context = vm.createContext({
    document,
    window: { STORE_PRODUCTS: products, addEventListener() {}, matchMedia() { return { matches: false }; } },
    MutationObserver: class { observe() {} },
    setInterval() { return 0; },
    setTimeout() { return 0; },
    AbortSignal,
    fetch,
  });
  vm.runInContext(source, context, { filename: "search.js" });
  return context.__searchRenderers;
}


function detailAvailability(product) {
  const original = fs.readFileSync(new URL("../docs/assets/js/store.js", import.meta.url), "utf8");
  const source = original.replace(/\}\)\(\);\s*$/, `
    globalThis.__detailAvailability = function (product) {
      const buy = {
        classList: { add: function () {}, remove: function () {} },
        disabled: false,
        innerHTML: "",
        style: {},
        textContent: ""
      };
      const input = { focus: function () {}, addEventListener: function () {} };
      const form = { addEventListener: function () {} };
      const waitlist = {
        hidden: true,
        innerHTML: "",
        querySelector: function (selector) {
          if (selector === "input") return input;
          if (selector === ".pe-wl-form") return form;
          return null;
        }
      };
      const elements = {
        ".pe-variant-desc": { textContent: "" },
        ".pe-box-contents": { innerHTML: "" },
        ".pe-qty span": { textContent: "" },
        ".pe-price": { innerHTML: "" },
        ".pe-qty": { style: {} },
        ".pe-buy": buy,
        ".pe-waitlist": waitlist
      };
      root = {
        querySelector: function (selector) { return elements[selector] || null; },
        querySelectorAll: function () { return []; }
      };
      PRODUCTS = [product]; P = product; build = product.defaultBuild; qty = 1;
      updateVariant(false);
      const action = buy.textContent;
      openWaitlist();
      return { action: action, form: waitlist.innerHTML, status: elements[".pe-price"].innerHTML };
    };
  })();`);
  assert.notEqual(source, original, "store.js must remain one trailing IIFE");

  const context = vm.createContext({
    document: {
      readyState: "loading",
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      body: { getAttribute() { return null; } },
      documentElement: { getAttribute() { return null; } },
    },
    window: { addEventListener() {} },
    URLSearchParams,
    localStorage: { getItem() { return null; }, setItem() {} },
  });
  vm.runInContext(source, context, { filename: "store.js" });
  return context.__detailAvailability(product);
}


const searchItem = {
  type: "product",
  url: "/store/avian-mic/",
  title: "Bird Mic",
  price: 180,
};


test("expanded search browse shows the product price", () => {
  const card = searchRenderers().cardEl(searchItem);
  assert.match(card.innerHTML, /from \$180/);
});


test("typed search results show the product price", () => {
  const row = searchRenderers().rowEl(searchItem);
  assert.match(row.innerHTML, /from \$180/);
});


test("Polargraph is sold out in search cards and typed results", () => {
  const item = { type: "product", id: "polargraph", title: "Polargraph Kit", price: 430 };
  const renderers = searchRenderers({ products: [{ id: item.id, variants: [
    { id: "electronics", status: "soldout" },
    { id: "electronics-printed", status: "soldout" },
  ] }] });
  for (const render of [renderers.cardEl, renderers.rowEl]) {
    assert.match(render(item).innerHTML, /Sold out/);
    assert.doesNotMatch(render(item).innerHTML, /\$430/);
  }
});


test("a product with an available variant still shows its price", () => {
  const renderers = searchRenderers({ products: [{ id: "avian-mic", variants: [
    { status: "soldout" }, { price: 180 },
  ] }] });
  assert.match(renderers.cardEl(searchItem).innerHTML, /from \$180/);
  assert.match(renderers.rowEl(searchItem).innerHTML, /from \$180/);
});


const frame = {
  id: "avian-visitors", published: true,
  variants: [{ status: "available", price: 699, inventorySku: "avian-gen3-batch-01" }],
};
const frameItem = { type: "product", id: frame.id, title: "Avian Visitors", price: 699 };

test("live inventory updates homepage and search labels after sellout and restock", async () => {
  let available = 0;
  const label = { dataset: { storeProduct: frame.id, storePrice: "$699" }, innerHTML: "Sold out" };
  const renderers = searchRenderers({ products: [frame], labels: [label], fetch: async (url, options) => {
    assert.equal(url, "/api/inventory-availability?sku=avian-gen3-batch-01");
    assert.equal(options.cache, "no-store");
    return { ok: true, json: async () => ({ inventory: [{ sku: "avian-gen3-batch-01", available, soldOut: available === 0 }] }) };
  } });
  for (available of [0, 3, 0]) {
    await renderers.loadProductAvailability(0);
    assert.equal(label.innerHTML, available ? "$699" : "Sold out");
    for (const render of [renderers.cardEl, renderers.rowEl]) {
      assert.match(render(frameItem).innerHTML, available ? /from \$699/ : /Sold out/);
    }
  }
});


test("unavailable or invalid inventory keeps finite products sold out without hiding ordinary prices", async () => {
  for (const body of [{ inventory: [] }, { inventory: [{ sku: "avian-gen3-batch-01", available: 0, soldOut: false }] }, null]) {
    const label = { dataset: { storeProduct: frame.id, storePrice: "$699" }, innerHTML: "$699" };
    const renderers = searchRenderers({ products: [frame], labels: [label], fetch: async () => {
      if (body === null) throw new Error("Offline");
      return { ok: true, json: async () => body };
    } });
    await renderers.loadProductAvailability(0);
    assert.equal(label.innerHTML, "Sold out");
    assert.match(renderers.cardEl(frameItem).innerHTML, /Sold out/);
    assert.match(renderers.rowEl(frameItem).innerHTML, /Sold out/);
    assert.match(renderers.rowEl(searchItem).innerHTML, /from \$180/);
  }
});


test("coming-soon variants offer the same Notify me waitlist action", () => {
  const state = detailAvailability({
    id: "avian-visitors",
    defaultBuild: "assembled",
    variants: [{ id: "assembled", label: "Assembled", comingSoon: true, contents: [] }],
  });
  assert.match(state.status, /Coming soon/);
  assert.equal(state.action, "Notify me");
  assert.match(state.form, /aria-label="Notify me"/);
});


test("sold-out variants retain the availability notification action", () => {
  const state = detailAvailability({
    id: "avian-mic",
    defaultBuild: "electronics",
    variants: [{
      id: "electronics",
      label: "Electronics Kit",
      price: 180,
      stripePrice: "price_test",
      status: "soldout",
      contents: [],
    }],
  });
  assert.match(state.status, /Sold out/);
  assert.equal(state.action, "Notify me");
  assert.match(state.form, /aria-label="Notify me"/);
});


test("Batch 2 price and sold-out labels follow its inventory without a batch announcement", async () => {
  let available = 100;
  const product = { ...frame, variants: [{ status: "available", price: 699,
    batchLabel: "Batch 2", inventorySku: "avian-gen3-batch-02" }] };
  const label = { dataset: { storeProduct: frame.id, storePrice: "$699" }, innerHTML: "Sold out" };
  const renderers = searchRenderers({ products: [product], labels: [label], fetch: async (url) => {
    assert.equal(url, "/api/inventory-availability?sku=avian-gen3-batch-02");
    return { ok: true, json: async () => ({ inventory: [{ sku: "avian-gen3-batch-02", available, soldOut: available === 0 }] }) };
  } });
  for (available of [100, 1, 0]) {
    await renderers.loadProductAvailability(0);
    assert.equal(label.innerHTML, available ? "$699" : "Sold out");
    for (const render of [renderers.cardEl, renderers.rowEl]) {
      assert.match(render(frameItem).innerHTML, available ? /from \$699/ : /Sold out/);
      assert.doesNotMatch(render(frameItem).innerHTML, /Batch 2 open|·/);
    }
  }
});
