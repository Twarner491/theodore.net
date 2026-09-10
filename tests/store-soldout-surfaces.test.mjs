import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";


function searchRenderers() {
  const original = fs.readFileSync(new URL("../docs/assets/js/search.js", import.meta.url), "utf8");
  const source = original.replace(/\}\)\(\);\s*$/, `
    globalThis.__searchRenderers = { cardEl: cardEl, rowEl: rowEl };
  })();`);
  assert.notEqual(source, original, "search.js must remain one trailing IIFE");

  const document = {
    readyState: "loading",
    addEventListener() {},
    querySelectorAll() { return []; },
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
    window: { addEventListener() {}, matchMedia() { return { matches: false }; } },
    MutationObserver: class { observe() {} },
    setInterval() { return 0; },
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
      const input = { focus: function () {} };
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


const soldOutSearchItem = {
  type: "product",
  url: "/store/avian-mic/",
  title: "Bird Mic",
  price: 180,
  status: "Sold out",
};


test("expanded search browse shows product availability instead of its former price", () => {
  const card = searchRenderers().cardEl(soldOutSearchItem);
  assert.match(card.innerHTML, /Sold out/);
  assert.doesNotMatch(card.innerHTML, /from \$180/);
});


test("typed search results show product availability instead of their former price", () => {
  const row = searchRenderers().rowEl(soldOutSearchItem);
  assert.match(row.innerHTML, /Sold out/);
  assert.doesNotMatch(row.innerHTML, /from \$180/);
});


test("coming-soon variants retain the dedicated waitlist action", () => {
  const state = detailAvailability({
    id: "avian-visitors",
    defaultBuild: "assembled",
    variants: [{ id: "assembled", label: "Assembled", comingSoon: true, contents: [] }],
  });
  assert.match(state.status, /Coming soon/);
  assert.equal(state.action, "Join the waitlist");
  assert.match(state.form, /aria-label="Join the waitlist"/);
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
