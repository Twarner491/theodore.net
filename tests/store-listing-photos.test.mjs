import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";


function listingPhotoHelpers() {
  const path = new URL("../docs/assets/js/store.js", import.meta.url);
  const original = fs.readFileSync(path, "utf8");
  const source = original.replace(/\}\)\(\);\s*$/, `
    globalThis.__storeListingPhotoHelpers = {
      heroFile: listingHeroFile,
      detailHref: listingDetailHref
    };
  })();`);
  assert.notEqual(source, original, "store.js must remain a single trailing IIFE");

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
  return context.__storeListingPhotoHelpers;
}


const requestedProducts = [
  ["polargraph", "plotter-overview.png", "polargraph-electronics.png"],
  ["avian-visitors-kit", "kit-overview.png", "avian-electronics.png"],
  ["avian-mic", "bird-mic-overview.png", "bird-mic-electronics.png"],
];


test("requested store listings use each product's first photo, not its default variant photo", () => {
  const helpers = listingPhotoHelpers();

  requestedProducts.forEach(([id, firstPhoto, variantPhoto]) => {
    const product = {
      id,
      defaultBuild: "electronics",
      images: [firstPhoto, variantPhoto],
    };
    const listing = {
      product,
      build: "electronics",
      variants: [{ id: "electronics", image: variantPhoto }],
    };

    assert.equal(helpers.heroFile(listing), firstPhoto);
    assert.notEqual(helpers.heroFile(listing), listing.variants[0].image);
  });
});


test("default listing links leave the detail carousel on photo one", () => {
  const helpers = listingPhotoHelpers();

  requestedProducts.forEach(([id, firstPhoto, variantPhoto]) => {
    const listing = {
      product: {
        id,
        defaultBuild: "electronics",
        images: [firstPhoto, variantPhoto],
      },
      build: "electronics",
      variants: [{ id: "electronics", image: variantPhoto }],
    };

    assert.equal(helpers.detailHref(listing), `/store/${id}/`);
  });
});


test("an explicitly represented non-default build keeps its variant deep link", () => {
  const helpers = listingPhotoHelpers();
  const listing = {
    product: {
      id: "future-product",
      defaultBuild: "standard",
      images: ["overview.png", "deluxe.png"],
    },
    build: "deluxe",
    variants: [{ id: "deluxe", image: "deluxe.png" }],
  };

  assert.equal(
    helpers.detailHref(listing),
    "/store/future-product/?variant=deluxe",
  );
});
