import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const partial = readFileSync(new URL("../overrides/partials/store-restore-token.html", import.meta.url), "utf8");
const source = partial.match(/<script id="store-restore-token">([\s\S]*?)<\/script>/)[1];
const token = "a".repeat(64);

function load(pathname, hash, search = "") {
  const location = { pathname, hash, search }, state = { preserved: true }, replacements = [];
  const context = {
    location, window: {}, URLSearchParams,
    history: { state, replaceState(value, title, url) { replacements.push({ value, title, url }); location.hash = new URL(url, "https://theodore.net").hash; } },
  };
  vm.runInNewContext(source, context);
  return { ...context, replacements, state };
}

test("restore token is scrubbed synchronously before analytics while other URL state stays intact", () => {
  const page = load("/store/", "#section&restore_cart=" + token + "&view=bird%20frame", "?go=mail");
  assert.equal(page.window.__theodoreRestoreToken, token);
  assert.equal(page.replacements[0].url, "/store/?go=mail#section&view=bird%20frame");
  assert.equal(page.replacements[0].value, page.state);
  assert.doesNotMatch(page.location.hash, /restore_cart|a{64}/);
  assert.equal(Object.keys(page.window).length, 1);
});

test("invalid and duplicate restore credentials are removed without accepting an invalid token", () => {
  const page = load("/store/", "#restore_cart=invalid&restore_cart=" + token);
  assert.equal(page.window.__theodoreRestoreToken, undefined);
  assert.equal(page.replacements[0].url, "/store/");
});

test("normal anchors and non-store pages retain their original URL", () => {
  for (const [path, hash] of [["/store/", "#details"], ["/projects/example/", "#restore_cart=" + token]]) {
    const page = load(path, hash);
    assert.equal(page.replacements.length, 0);
    assert.equal(page.window.__theodoreRestoreToken, undefined);
    assert.equal(page.location.hash, hash);
  }
});

test("store template places the synchronous scrubber before the parent analytics block", () => {
  const template = readFileSync(new URL("../overrides/index.html", import.meta.url), "utf8");
  const block = template.match(/{% block analytics %}([\s\S]*?){% endblock %}/)[1];
  assert.ok(block.indexOf('include "partials/store-restore-token.html"') < block.indexOf("super()"));
  assert.doesNotMatch(partial, /\b(?:async|defer)\s*[=>]|localStorage|sessionStorage|fetch\(/);
});
