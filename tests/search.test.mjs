import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";


function searchHelpers() {
  const path = new URL("../docs/assets/js/search.js", import.meta.url);
  const original = fs.readFileSync(path, "utf8");
  const source = original.replace(/\}\)\(\);\s*$/, `
    globalThis.__searchHelpers = {
      setItems: function (value) { items = value; },
      byType: byType,
      trimCoveredAccessories: trimCoveredAccessories
    };
  })();`);
  assert.notEqual(source, original, "search.js must remain a single trailing IIFE");

  const context = vm.createContext({
    document: {
      readyState: "loading",
      addEventListener() {},
      querySelectorAll() { return []; },
      body: { getAttribute() { return null; } },
      documentElement: { getAttribute() { return null; } },
    },
    window: {
      addEventListener() {},
      matchMedia() { return { matches: false }; },
    },
    MutationObserver: class { observe() {} },
    setInterval() { return 0; },
  });
  vm.runInContext(source, context, { filename: "search.js" });
  return context.__searchHelpers;
}


const parent = {
  type: "product",
  id: "avian-mic",
  url: "/store/avian-mic/",
  title: "Bird Mic",
};

const accessories = [
  {
    type: "product",
    id: "bird-mic-case",
    url: "/store/bird-mic-case/",
    title: "Bird Mic Case",
    description: "A 3D-printed enclosure.",
    keywords: "case enclosure",
    accessory: true,
    parentId: "avian-mic",
  },
  {
    type: "product",
    id: "mic-mount",
    url: "/store/mic-mount/",
    title: "Mic Mount",
    description: "A clean mount.",
    keywords: "mount mounting hardware",
    accessory: true,
    parentId: "avian-mic",
  },
];


test("search browse keeps accessories out of the default Store row", () => {
  const helpers = searchHelpers();
  helpers.setItems([parent, ...accessories]);
  assert.deepEqual(
    Array.from(helpers.byType("product"), (item) => item.id),
    ["avian-mic"],
  );
});


test("search suppresses parent-only accessory duplicates but keeps specific matches", () => {
  const helpers = searchHelpers();
  const ids = (items) => Array.from(items, (item) => item.id);

  assert.deepEqual(
    ids(helpers.trimCoveredAccessories([parent, ...accessories], "bird mic")),
    ["avian-mic"],
  );
  assert.deepEqual(
    ids(helpers.trimCoveredAccessories([parent, accessories[0]], "bird mic case")),
    ["avian-mic", "bird-mic-case"],
  );
  assert.deepEqual(
    ids(helpers.trimCoveredAccessories([parent, accessories[0]], "cas")),
    ["avian-mic", "bird-mic-case"],
    "a specific prefix accepted by fuzzy search must not be de-duplicated away",
  );
  assert.deepEqual(
    ids(helpers.trimCoveredAccessories([parent, accessories[1]], "mic mount")),
    ["avian-mic", "mic-mount"],
  );
  assert.deepEqual(
    ids(helpers.trimCoveredAccessories([accessories[0]], "bird mic")),
    ["bird-mic-case"],
    "a relevant accessory must remain when its parent is not itself a result",
  );

  const polargraph = {
    type: "product",
    id: "polargraph",
    url: "/store/polargraph/",
    title: "Polargraph Plotter",
  };
  const pens = {
    type: "product",
    id: "micron-pens-9",
    url: "/store/micron-pens-9/",
    title: "Sakura Micron 05 (9-pack)",
    description: "Nine fineliners.",
    keywords: "pens pen mounts caps",
    accessory: true,
    parentId: "polargraph",
  };
  assert.deepEqual(
    ids(helpers.trimCoveredAccessories([polargraph, pens], "pens")),
    ["polargraph", "micron-pens-9"],
  );
});
