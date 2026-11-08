import assert from "node:assert/strict";
import test from "node:test";

import { onRequestPost } from "../functions/api/subscribe.js";


function request(body, headers = {}) {
  return new Request("https://theodore.net/api/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://theodore.net", ...headers },
    body: JSON.stringify(body),
  });
}


test("waitlist signup fails closed when Buttondown is not configured", async () => {
  const response = await onRequestPost({
    request: request({ email: "bird@example.com", tags: ["waitlist", "avian-visitors"] }),
    env: {},
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "Waitlist signup is not configured.");
});


test("waitlist signup reports success only after subscriber and tags succeed", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET", body: options.body || null });
    if (String(url).endsWith("/tags")) return Response.json({ results: [
      { id: "tag-waitlist", name: "waitlist" },
      { id: "tag-avian", name: "avian-visitors" },
    ] });
    if (String(url).endsWith("/subscribers") && options.method === "POST") {
      return Response.json({ id: "subscriber-1" });
    }
    if (String(url).endsWith("/subscribers/subscriber-1") && !options.method) {
      return Response.json({ id: "subscriber-1", tags: [] });
    }
    if (String(url).endsWith("/subscribers/subscriber-1") && options.method === "PATCH") {
      return Response.json({ id: "subscriber-1", tags: ["waitlist", "avian-visitors"] });
    }
    return new Response("unexpected", { status: 500 });
  };
  try {
    const response = await onRequestPost({
      request: request({ email: "bird@example.com", tags: ["waitlist", "avian-visitors"] }),
      env: { BUTTONDOWN_API_KEY: "test-key" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(calls.map((call) => call.method), ["GET", "POST", "GET", "PATCH"]);
    assert.deepEqual(JSON.parse(calls[3].body).tags.sort(), ["tag-avian", "tag-waitlist"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("waitlist signup exposes an upstream tag failure instead of a false success", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/tags")) return Response.json({ results: [
      { id: "tag-waitlist", name: "waitlist" },
      { id: "tag-avian", name: "avian-visitors" },
    ] });
    if (String(url).endsWith("/subscribers") && options.method === "POST") {
      return Response.json({ id: "subscriber-1" });
    }
    if (String(url).endsWith("/subscribers/subscriber-1") && !options.method) {
      return Response.json({ id: "subscriber-1", tags: [] });
    }
    return new Response("upstream failed", { status: 500 });
  };
  try {
    const response = await onRequestPost({
      request: request({ email: "bird@example.com", tags: ["waitlist", "avian-visitors"] }),
      env: { BUTTONDOWN_API_KEY: "test-key" },
    });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /Could not join/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("a product with no Buttondown tag yet gets one created (with the required color) and applied", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url), method = options.method || "GET";
    calls.push({ url: u, method, body: options.body || null });
    if (u.endsWith("/tags") && method === "GET") return Response.json({
      results: [{ id: "tag-waitlist", name: "waitlist" }],
      next: "https://api.buttondown.email/v1/tags?page=2",
    });
    if (u.endsWith("/tags?page=2")) return Response.json({ results: [{ id: "tag-customer", name: "customer" }], next: null });
    if (u.endsWith("/tags") && method === "POST") {
      const sent = JSON.parse(options.body);
      if (!sent.color) return Response.json({ detail: [{ msg: "Field required" }] }, { status: 422 });
      return Response.json({ id: "tag-polargraph", name: sent.name }, { status: 201 });
    }
    if (u.endsWith("/subscribers") && method === "POST") {
      return Response.json({ code: "email_already_exists", metadata: { subscriber_id: "subscriber-1" } }, { status: 400 });
    }
    if (u.endsWith("/subscribers/subscriber-1") && method === "GET") return Response.json({ id: "subscriber-1", tags: ["customer"] });
    if (u.endsWith("/subscribers/subscriber-1") && method === "PATCH") return Response.json({ id: "subscriber-1" });
    return new Response("unexpected", { status: 500 });
  };
  try {
    const response = await onRequestPost({
      request: request({ email: "pen@example.com", tags: ["waitlist", "polargraph", "Bad Tag!"] }),
      env: { BUTTONDOWN_API_KEY: "test-key" },
    });
    assert.equal(response.status, 200);
    const created = calls.find((c) => c.url.endsWith("/tags") && c.method === "POST");
    assert.equal(JSON.parse(created.body).name, "polargraph");
    const patch = calls.find((c) => c.method === "PATCH");
    assert.deepEqual(JSON.parse(patch.body).tags.sort(), ["tag-customer", "tag-polargraph", "tag-waitlist"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("a tag create that loses a race to a concurrent signup re-reads the catalog instead of failing", async () => {
  const originalFetch = globalThis.fetch;
  let listed = 0;
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url), method = options.method || "GET";
    if (u.endsWith("/tags") && method === "GET") {
      listed++;
      return Response.json({ results: listed === 1 ? [] : [{ id: "tag-polargraph", name: "polargraph" }] });
    }
    if (u.endsWith("/tags") && method === "POST") return Response.json({ code: "something_else" }, { status: 400 });
    if (u.endsWith("/subscribers") && method === "POST") return Response.json({ id: "subscriber-1" });
    if (u.endsWith("/subscribers/subscriber-1") && method === "GET") return Response.json({ id: "subscriber-1", tags: [] });
    if (u.endsWith("/subscribers/subscriber-1") && method === "PATCH") return Response.json({ id: "subscriber-1" });
    return new Response("unexpected", { status: 500 });
  };
  try {
    const response = await onRequestPost({
      request: request({ email: "pen@example.com", tags: ["polargraph"] }),
      env: { BUTTONDOWN_API_KEY: "test-key" },
    });
    assert.equal(response.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("a name_already_exists tag create reuses the returned tag id", async () => {
  const originalFetch = globalThis.fetch;
  let patched = null;
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url), method = options.method || "GET";
    if (u.endsWith("/tags") && method === "GET") return Response.json({ results: [] });
    if (u.endsWith("/tags") && method === "POST") return Response.json({ code: "name_already_exists", metadata: { tag_id: "tag-raced" } }, { status: 400 });
    if (u.endsWith("/subscribers") && method === "POST") return Response.json({ id: "subscriber-1" });
    if (u.endsWith("/subscribers/subscriber-1") && method === "GET") return Response.json({ id: "subscriber-1", tags: [] });
    if (u.endsWith("/subscribers/subscriber-1") && method === "PATCH") { patched = JSON.parse(options.body); return Response.json({ id: "subscriber-1" }); }
    return new Response("unexpected", { status: 500 });
  };
  try {
    const response = await onRequestPost({
      request: request({ email: "pen@example.com", tags: ["polargraph"] }),
      env: { BUTTONDOWN_API_KEY: "test-key" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(patched.tags, ["tag-raced"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
