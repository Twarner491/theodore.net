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
