import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function themeHarness(initialTheme = "default") {
  let theme = initialTheme;
  let onThemeChange;
  const names = ["avianAssembledTop", "bird-mic", "micmount", "heard-today", "no-dark-photo"];
  const images = names.map((name) => ({
    src: `/assets/images/AvianVisitors/${name}.png`,
    wrap: { style: {} },
    getAttribute() { return this.src; },
    setAttribute(_name, value) { this.src = value; },
    closest() { return this.wrap; },
  }));
  const darkImages = images.slice(0, 4).map((image) => image.src);
  const backgrounds = Object.fromEntries(darkImages.flatMap((url) => [
    [url, "#ffffff"], [url.replace(".png", "DARK.png"), "#1e2129"],
  ]));
  const matches = (selector) => selector.includes(".kit-card__imgwrap img") ? images : [];
  const original = readFileSync(new URL("../docs/assets/js/index.js", import.meta.url), "utf8");
  const source = original.slice(original.lastIndexOf("\n(function () {"));
  vm.runInNewContext(source, {
    document: {
      readyState: "complete",
      body: { getAttribute() { return theme; } },
      documentElement: { getAttribute() { return null; } },
      querySelector: (selector) => matches(selector)[0],
      querySelectorAll: matches,
    },
    window: { STORE_DARK_IMAGES: darkImages, STORE_IMAGE_BG: backgrounds },
    MutationObserver: class {
      constructor(callback) { onThemeChange = callback; }
      observe() {}
    },
  });
  return {
    images,
    toggle(next) {
      assert.equal(typeof onThemeChange, "function", "project cards must subscribe to theme changes");
      theme = next;
      onThemeChange();
    },
  };
}

test("project ads use dark photos and matching backgrounds on a dark initial load", () => {
  const { images } = themeHarness("slate");
  for (const image of images.slice(0, 4)) {
    assert.match(image.src, /DARK\.png$/);
    assert.equal(image.wrap.style.background, "#1e2129");
  }
  assert.match(images[4].src, /no-dark-photo\.png$/);
});

test("all project ads follow live theme changes in both directions", () => {
  const page = themeHarness();
  page.toggle("slate");
  for (const image of page.images.slice(0, 4)) assert.match(image.src, /DARK\.png$/);
  page.toggle("default");
  for (const image of page.images.slice(0, 4)) {
    assert.doesNotMatch(image.src, /DARK\.png$/);
    assert.equal(image.wrap.style.background, "#ffffff");
  }
});
