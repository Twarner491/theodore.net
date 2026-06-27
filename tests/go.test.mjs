import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveGo, assertInternalPath, GO_MAP, SAFE_DEFAULT } from "../functions/go/_lib.js";

const ORIGIN = "https://theodore.net";

test("go: known slugs resolve to their curated internal path + channel token", () => {
  assert.deepEqual(resolveGo("x"), { path: "/store/", go: "x" });
  assert.deepEqual(resolveGo("twitter"), { path: "/store/", go: "x" });
  assert.deepEqual(resolveGo("instagram"), { path: "/store/", go: "instagram" });
  assert.deepEqual(resolveGo("avian"), { path: "/store/avian-visitors/", go: "avian" });
  assert.deepEqual(resolveGo("avian-x"), { path: "/store/avian-visitors/", go: "x" });
  assert.deepEqual(resolveGo("waitlist"), { path: "/store/avian-visitors/?join=1", go: "waitlist" });
});

test("go: slug is case-insensitive", () => {
  assert.deepEqual(resolveGo("X"), { path: "/store/", go: "x" });
  assert.deepEqual(resolveGo("Instagram"), { path: "/store/", go: "instagram" });
});

test("go: unknown / empty / null slug falls back to the safe default (never dead-ends or leaks)", () => {
  assert.deepEqual(resolveGo("does-not-exist"), SAFE_DEFAULT);
  assert.deepEqual(resolveGo(""), SAFE_DEFAULT);
  assert.deepEqual(resolveGo(null), SAFE_DEFAULT);
  assert.deepEqual(resolveGo(undefined), SAFE_DEFAULT);
});

test("go: prototype keys cannot resolve to a destination (hasOwnProperty, not `in`)", () => {
  for (const k of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
    assert.deepEqual(resolveGo(k), SAFE_DEFAULT, k + " must not resolve");
  }
});

test("go: assertInternalPath rejects every open-redirect vector", () => {
  // these are the classic bypasses an attacker would try
  assert.equal(assertInternalPath("//evil.com"), false);
  assert.equal(assertInternalPath("/\\evil.com"), false);
  assert.equal(assertInternalPath("https://evil.com"), false);
  assert.equal(assertInternalPath("http://evil.com"), false);
  assert.equal(assertInternalPath("javascript:alert(1)"), false);
  assert.equal(assertInternalPath("data:text/html,x"), false);
  assert.equal(assertInternalPath("  https://evil.com"), false);
  assert.equal(assertInternalPath("/path\\to"), false);
  assert.equal(assertInternalPath("relative/no/slash"), false);
  assert.equal(assertInternalPath(""), false);
  assert.equal(assertInternalPath(null), false);
  // and accepts legitimate internal paths
  assert.equal(assertInternalPath("/store/"), true);
  assert.equal(assertInternalPath("/store/avian-visitors/?join=1"), true);
});

test("go: EVERY GO_MAP destination stays on our own origin when built into a URL (no escape)", () => {
  for (const slug of Object.keys(GO_MAP)) {
    const { path } = resolveGo(slug);
    const dest = new URL(path, ORIGIN);
    dest.searchParams.set("go", resolveGo(slug).go);
    assert.equal(dest.origin, ORIGIN, slug + " -> " + dest.toString() + " escaped origin!");
    assert.equal(dest.protocol, "https:");
  }
});

test("go: a hostile slug, even if it somehow keyed the map, still cannot escape origin", () => {
  // resolveGo always returns an internal path; confirm the URL build pins to our origin
  const { path, go } = resolveGo("//evil.com");   // -> SAFE_DEFAULT
  const dest = new URL(path, ORIGIN);
  dest.searchParams.set("go", go);
  assert.equal(dest.origin, ORIGIN);
  assert.equal(dest.pathname, "/store/");
});
