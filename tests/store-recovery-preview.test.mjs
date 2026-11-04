import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const JOURNEY = "store:recovery-preview:journey:v2", ACTIVE = "store:recovery-preview:active:v1", CART = "store:cart:v3";
const credentials = { journeyId: "a".repeat(64), journeyToken: "b".repeat(64), expiresAt: 4000000000 };
const line = { id: "avian-visitors", build: "assembled-batch-2", qty: 1 };
const plain = (value) => JSON.parse(JSON.stringify(value));
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const settle = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function memory(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) };
}
function harness({ hostname = "theodore.net", protocol = "http:", search = "", hash = "", pathname = "/store/avian-visitors/", sessionStorage = memory(), localStorage = memory(), respond, configure, captureRestoreInHead = false } = {}) {
  const original = readFileSync(new URL("../docs/assets/js/store.js", import.meta.url), "utf8");
  const code = original.replace(/\}\)\(\);\s*$/, `
    PRODUCTS = [{ id: "avian-visitors", defaultBuild: "assembled-batch-2", variants: [{ id: "assembled-batch-2", price: 699, stripePrice: "price_test" }] }];
    P = PRODUCTS[0]; build = P.defaultBuild;
    renderCart = function () {}; updateBadge = function () {}; openCart = function () {};
    globalThis.helpers = { model: createLocalRecoveryJourney, track, ga4, addToCart, setLineQty, loadCart, recoveryCheckoutContext, checkout,
      setProduct: function (product, selectedBuild) { P = product; build = selectedBuild || (product && product.defaultBuild); }, getCart: function () { return cart; } };
  })();`);
  const network = [], scripts = [], ga = [], order = [], redirects = [];
  const location = { hostname, protocol, pathname, search, hash, origin: protocol + "//" + hostname + (protocol === "http:" ? ":8892" : ""), assign: (url) => redirects.push(url) };
  Object.defineProperty(location, "href", { get: () => location.origin + location.pathname + location.search + location.hash });
  const context = vm.createContext({
    document: { readyState: "loading", referrer: "", addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
      createElement: () => ({}), head: { appendChild: (el) => scripts.push(el) } },
    window: { addEventListener() {}, gtag: (...args) => ga.push(args) }, location, localStorage, sessionStorage, URL, URLSearchParams,
    setTimeout, clearTimeout,
    history: { replaceState(_state, _unused, url) { order.push({ scrub: url }); location.hash = new URL(url, location.origin).hash; } },
    navigator: { sendBeacon: (url, body) => network.push({ url, body: JSON.parse(body) }) },
    fetch: async (url, options = {}) => {
      if (url === "/api/store-recovery?status=1") {
        network.push({ url, options }); order.push({ request: "config" });
        return configure ? configure(options) : json({ enabled: true, mode: "live", newsletter: true, cartEmail: true });
      }
      const body = JSON.parse(options.body); network.push({ url, body }); order.push({ request: body.action });
      if (respond) { const response = await respond(body); if (response) return response; }
      const live = protocol === "https:" && ["theodore.net", "www.theodore.net"].includes(hostname);
      return json(body.action === "start" ? { ok: true, ...credentials } : { ok: true, status: live ? body.action === "newsletter" ? "subscribed" : "sent" : "queued_local", requestId: body.requestId, outboxId: "local-outbox" });
    },
  });
  if (captureRestoreInHead) {
    const partial = readFileSync(new URL("../overrides/partials/store-restore-token.html", import.meta.url), "utf8");
    vm.runInContext(partial.match(/<script id="store-restore-token">([\s\S]*?)<\/script>/)[1], context);
  }
  const analyticsTemplate = readFileSync(new URL("../overrides/partials/integrations/analytics/google.html", import.meta.url), "utf8");
  vm.runInContext(analyticsTemplate.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  vm.runInContext(code, context);
  return { helpers: context.helpers, get api() { return context.window.TheodoreRecoveryPreview; }, window: context.window, network, ga, scripts, sessionStorage, localStorage, order, location, redirects };
}

test("recovery is inert on HTTP, lookalike hosts, non-store paths and loopback without opt-in", () => {
  for (const options of [{ hostname: "theodore.net" }, { hostname: "theodore.net.example.com", protocol: "https:" },
    { hostname: "localhost.example.com", protocol: "https:" }, { hostname: "127.0.0.1.example.com" },
    { hostname: "theodore.net", protocol: "https:", pathname: "/projects/avian-visitors/" },
    { hostname: "theodore.net", protocol: "https:", pathname: "/storefront/" }]) {
    const h = harness({ ...options, search: "?recovery-preview=1", sessionStorage: memory({ [ACTIVE]: "1" }) });
    assert.equal(h.api, undefined); assert.equal(h.scripts.length, 0); assert.equal(h.network.length, 0);
  }
  assert.equal(harness({ hostname: "localhost" }).api, undefined);
  const normal = harness(); normal.helpers.track("add_to_cart", line); normal.helpers.ga4("add_to_cart", { value: 699 });
  assert.equal(normal.network[0].url, "/api/ev"); assert.equal(normal.ga.length, 1);
});

test("live recovery waits for server activation and preserves buffered events alongside existing analytics", async () => {
  const config = deferred(), start = deferred();
  const h = harness({ protocol: "https:", configure: () => config.promise,
    respond: (body) => body.action === "start" ? start.promise : undefined });
  assert.equal(h.api, undefined); assert.equal(h.scripts.length, 0);
  assert.equal(h.network[0].url, "/api/store-recovery?status=1"); assert.equal(h.network[0].options.cache, "no-store");
  h.helpers.track("view_item", { product: line.id, build: line.build });
  h.helpers.addToCart(line.id, line.build, 2); h.helpers.setLineQty(0, 1);
  assert.equal(h.network.filter((request) => request.url === "/api/ev").length, 2); assert.equal(h.ga.length, 1);
  config.resolve(json({ enabled: true, mode: "live", newsletter: true, cartEmail: true })); await settle();
  assert.equal(h.api.mode, "live"); assert.equal(h.scripts.length, 2);
  assert.deepEqual(h.network.filter((request) => request.url === "/api/store-recovery").map((request) => request.body.action), ["start"]);
  h.helpers.track("view_cart", { value: 69900 });
  start.resolve(json({ ok: true, ...credentials })); await h.helpers.recoveryCheckoutContext();
  const requests = h.network.filter((request) => request.url === "/api/store-recovery").map((request) => request.body);
  assert.deepEqual(requests.map((body) => body.type || body.action), ["start", "view_item", "cart_updated", "add_to_cart", "cart_updated", "view_cart"]);
  assert.deepEqual(requests[2].cart, [{ ...line, qty: 2 }]); assert.deepEqual(requests[4].cart, [line]);
  assert.equal(h.network.filter((request) => request.url === "/api/ev").length, 3);
  h.helpers.addToCart(line.id, line.build, 1); await h.helpers.recoveryCheckoutContext();
  assert.equal(h.ga.length, 2); assert.equal(h.ga[1][1], "add_to_cart");
  assert.equal(h.network.filter((request) => request.url === "/api/ev").length, 4);
});

test("disabled, invalid and unavailable live configuration leaves shopping and analytics active", async () => {
  for (const configure of [() => json({ enabled: false, mode: "live" }), () => json({ enabled: true, mode: "local" }),
    () => json({ enabled: true, mode: "live" }, 503), () => json(null), () => Promise.reject(new Error("Offline"))]) {
    const h = harness({ protocol: "https:", configure });
    h.helpers.addToCart(line.id, line.build, 1); await settle();
    assert.equal(h.api, undefined); assert.equal(h.scripts.length, 0);
    assert.equal(h.network.filter((request) => request.url === "/api/store-recovery").length, 0);
    assert.equal(h.network.filter((request) => request.url === "/api/ev").length, 1); assert.equal(h.ga.length, 1);
    assert.deepEqual(plain(h.helpers.getCart()), [line]); assert.deepEqual(plain(await h.helpers.recoveryCheckoutContext()), {});
  }
});

test("the first live checkout waits for bootstrap and queued events before receiving journey credentials", async () => {
  const config = deferred(), event = deferred();
  const h = harness({ protocol: "https:", hostname: "www.theodore.net", pathname: "/store/checkout/", configure: () => config.promise,
    respond: (body) => body.action === "event" ? event.promise : undefined });
  h.helpers.track("begin_checkout"); let completed = false;
  const checkout = h.helpers.recoveryCheckoutContext().then((value) => { completed = true; return value; });
  await settle(); assert.equal(completed, false);
  config.resolve(json({ enabled: true, mode: "live", newsletter: false, cartEmail: true })); await settle();
  assert.equal(completed, false); assert.equal(h.api.newsletterEnabled, false); assert.equal(h.api.cartEmailEnabled, true);
  event.resolve(json({ ok: true }));
  assert.deepEqual(plain(await checkout), { journeyId: credentials.journeyId, journeyToken: credentials.journeyToken });
  assert.deepEqual(h.network.filter((request) => request.url === "/api/store-recovery").map((request) => request.body.type || request.body.action), ["start", "begin_checkout"]);
});

test("an unavailable live bootstrap cannot indefinitely hold checkout", async () => {
  const config = deferred(), h = harness({ protocol: "https:", configure: () => config.promise });
  const started = Date.now();
  assert.deepEqual(plain(await h.helpers.recoveryCheckoutContext()), {});
  assert.ok(Date.now() - started < 1800, "checkout should proceed within the one-second recovery deadline");
  config.resolve(json({ enabled: false })); await settle();
});

test("real cart hooks queue before journey start and preserve event order across newsletter signup", async () => {
  const start = deferred();
  const h = harness({ hostname: "localhost", search: "?recovery-preview=1", respond: (body) => body.action === "start" ? start.promise : undefined });
  h.helpers.track("view_item", { product: line.id, build: line.build });
  h.helpers.addToCart(line.id, line.build, 2);
  const signup = h.api.subscribe("private@example.com");
  h.helpers.setLineQty(0, 1);
  h.helpers.track("begin_checkout", { email: "should-not-leak@example.com", voucherCode: "PRIVATE_FIXTURE", value: 69900 });
  h.helpers.setLineQty(0, 0);
  await settle(); assert.equal(h.network.length, 1);
  start.resolve(json({ ok: true, ...credentials })); await signup; await h.helpers.recoveryCheckoutContext();
  const bodies = h.network.map((request) => request.body), types = bodies.map((body) => body.type || body.action);
  assert.deepEqual(types, ["start", "view_item", "cart_updated", "add_to_cart", "newsletter", "cart_updated", "begin_checkout", "cart_updated"]);
  assert.deepEqual(bodies.at(-1).cart, []);
  assert.ok(bodies.slice(1).every((body) => body.journeyId === credentials.journeyId && body.journeyToken === credentials.journeyToken));
  assert.equal(bodies.find((body) => body.action === "newsletter").copyVersion, "avian-newsletter-v1");
  assert.doesNotMatch(JSON.stringify(bodies.filter((body) => body.action !== "newsletter")), /private@|should-not-leak|PRIVATE_FIXTURE|voucher|tags/);
  assert.equal(h.ga.length, 0); assert.ok(h.network.every((request) => request.url === "/api/store-recovery"));
});

test("same tab reuses only opaque credentials and opt-out preserves unrelated data", async () => {
  const sessionStorage = memory({ unrelated: "keep", "store:recovery-preview:journey:v1": "old simulated state" }), localStorage = memory();
  const first = harness({ hostname: "localhost", search: "?recovery-preview=1", sessionStorage, localStorage });
  first.helpers.addToCart(line.id, line.build, 1); await first.api.subscribe("private@example.com");
  const saved = JSON.parse(sessionStorage.getItem(JOURNEY));
  assert.deepEqual(Object.keys(saved).sort(), ["expiresAt", "journeyId", "journeyToken", "session"]);
  assert.doesNotMatch(sessionStorage.getItem(JOURNEY), /email|private@|cart|build|voucher/);
  assert.equal(sessionStorage.getItem("store:recovery-preview:journey:v1"), null);
  const next = harness({ hostname: "localhost", pathname: "/store/checkout/", sessionStorage, localStorage });
  assert.deepEqual(plain(await next.helpers.recoveryCheckoutContext()), { journeyId: credentials.journeyId, journeyToken: credentials.journeyToken });
  assert.equal(next.network.length, 0);
  assert.equal(harness({ hostname: "localhost", search: "?recovery-preview=0", sessionStorage, localStorage }).api, undefined);
  assert.equal(sessionStorage.getItem(ACTIVE), null); assert.equal(sessionStorage.getItem(JOURNEY), null); assert.equal(sessionStorage.getItem("unrelated"), "keep");
});

test("outbound data is whitelisted and unknown events never become purchases or consent", async () => {
  const h = harness(), requests = [], storage = memory();
  const journey = h.helpers.model({ storage, session: "session1", anon: "anon1", source: "substack", randomId: () => "request0001",
    transport: async (_url, options) => { const body = JSON.parse(options.body); requests.push(body); return json(body.action === "start" ? { ok: true, ...credentials } : { ok: true }); } });
  journey.recordEvent("purchase", { email: "private@example.com" }); journey.recordEvent("unknown");
  journey.recordCart([{ ...line, email: "private@example.com", voucherCode: "PRIVATE_FIXTURE" }, { ...line, qty: Infinity }, { ...line, id: "private@example.com" }]);
  await assert.rejects(journey.newsletter("private@example.com", { product: "private@example.com", build: line.build }), /unavailable/);
  await journey.flush();
  assert.equal(requests.length, 2); assert.deepEqual(requests[1].cart, [line]);
  assert.doesNotMatch(JSON.stringify(requests), /private@|PRIVATE_FIXTURE|purchase|consent/);
  assert.deepEqual(Object.keys(journey.snapshot()).sort(), ["journeyId", "ready"]);
});

test("transient retries reuse the request ID and validation errors remain failures", async () => {
  const requests = [], h = harness(); let calls = 0;
  const journey = h.helpers.model({ storage: memory(), session: "session1", randomId: () => "request0001",
    transport: async (_url, options) => { const body = JSON.parse(options.body); requests.push(body);
      if (body.action === "start") return json({ ok: true, ...credentials });
      if (body.action === "cart_email") return ++calls === 1 ? json({ error: "temporary" }, 503) : json({ ok: true, status: "queued_local", preview: { subject: "Cart", text: "Body", restoreUrl: "http://localhost/store/#restore_cart=fixture" } });
      return json({ error: "Invalid email" }, 400);
    } });
  assert.equal((await journey.cartEmail("private@example.com", [line])).status, "queued_local");
  assert.deepEqual(requests[1], requests[2]);
  await assert.rejects(journey.newsletter("bad", { product: line.id, build: line.build }), /Invalid email/);
  assert.equal(requests.filter((body) => body.action === "newsletter").length, 1);
});

test("HTML and malformed responses show a retry message while retaining email and the same request ID", async () => {
  for (const action of ["newsletter", "cart_email"]) {
    for (const status of [502, 400, 200]) {
      const requests = [], h = harness(); let failing = true, number = 0;
      const journey = h.helpers.model({ mode: "live", storage: memory(), session: "session1", randomId: () => "request" + (++number).toString().padStart(5, "0"),
        transport: async (_url, options) => {
          const body = JSON.parse(options.body); requests.push(body);
          if (body.action === "start") return json({ ok: true, ...credentials });
          if (failing) return { ok: status < 400, status, json: async () => { throw new SyntaxError("Unexpected token '<', <!DOCTYPE html> is not valid JSON"); } };
          return json({ ok: true, status: action === "newsletter" ? "subscribed" : "sent" });
        } });
      const ui = uiHarness({ mode: "live",
        subscribe: (email) => journey.newsletter(email, { product: line.id, build: line.build }),
        emailCart: (email) => journey.cartEmail(email, [line]) });
      const host = action === "newsletter" ? ui.newsletter : ui.host;
      const form = action === "newsletter" ? host : host.querySelector("form"), email = host.querySelector("input");
      const error = host.querySelector(action === "newsletter" ? "#newsletter-preview-error" : ".recovery-preview-error");
      const result = host.querySelector(action === "newsletter" ? ".newsletter-preview-status" : ".recovery-preview-status");
      email.value = "person@example.com"; await form.emit("submit");
      assert.equal(email.value, "person@example.com"); assert.equal(email.disabled, false);
      assert.equal(error.hidden, false); assert.match(error.textContent, /Please try again/);
      assert.doesNotMatch(error.textContent, /Unexpected token|DOCTYPE|JSON|SyntaxError/); assert.equal(result.textContent, "");
      assert.equal(requests.filter((body) => body.action === action).length, status === 400 ? 1 : 2);
      failing = false; await form.emit("submit");
      assert.equal(email.value, ""); assert.equal(error.hidden, true); assert.notEqual(result.textContent, "");
      assert.equal(new Set(requests.filter((body) => body.action === action).map((body) => body.requestId)).size, 1);
    }
  }
});

test("live mutations require delivery acknowledgements and pass through signup confirmation status", async () => {
  const h = harness(); let response = { ok: true, status: "queued_local" };
  const journey = h.helpers.model({ mode: "live", storage: memory(), session: "session1",
    transport: async (_url, options) => JSON.parse(options.body).action === "start" ? json({ ok: true, ...credentials }) : json(response) });
  assert.equal(journey.mode, "live");
  await assert.rejects(journey.newsletter("person@example.com", { product: line.id, build: line.build }), /did not confirm/);
  await assert.rejects(journey.cartEmail("person@example.com", [line]), /did not confirm/);
  response = { ok: true, status: "subscribed", confirmationRequired: true };
  assert.equal((await journey.newsletter("person@example.com", { product: line.id, build: line.build })).confirmationRequired, true);
  response = { ok: true, status: "sent" };
  assert.equal((await journey.cartEmail("person@example.com", [line])).status, "sent");
});

test("malformed success does not succeed and expired credentials do not loop", async () => {
  const h = harness(), requests = [], storage = memory({ [JOURNEY]: JSON.stringify({ session: "session1", ...credentials, expiresAt: 1 }) });
  const journey = h.helpers.model({ storage, session: "session1", randomId: () => "request0001",
    transport: async (_url, options) => { const body = JSON.parse(options.body); requests.push(body); return body.action === "start" ? json({ ok: true, ...credentials }) : json({ error: "Invalid or expired visit" }, 401); } });
  await assert.rejects(journey.cartEmail("private@example.com", [line]), /expired visit/);
  await journey.flush(); assert.equal(requests.length, 2);
  const malformed = h.helpers.model({ storage: memory(), session: "session1", transport: async () => json({}) });
  assert.deepEqual(plain(await malformed.checkoutContext()), {}, "failed recovery never blocks checkout");
});

test("checkout context waits for all pending events and contains both credentials", async () => {
  const event = deferred(), h = harness({ hostname: "localhost", search: "?recovery-preview=1", respond: (body) => body.action === "event" ? event.promise : undefined });
  h.helpers.track("begin_checkout"); let completed = false;
  const checkout = h.helpers.recoveryCheckoutContext().then((value) => { completed = true; return value; });
  await settle(); assert.equal(completed, false);
  event.resolve(json({ ok: true }));
  assert.deepEqual(plain(await checkout), { journeyId: credentials.journeyId, journeyToken: credentials.journeyToken });
});

test("slow recovery traffic cannot hold checkout beyond its deadline", async () => {
  const h = harness(), event = deferred();
  const journey = h.helpers.model({ storage: memory(), session: "session1", transport: async (_url, options) => JSON.parse(options.body).action === "start" ? json({ ok: true, ...credentials }) : event.promise });
  journey.recordEvent("begin_checkout");
  const start = Date.now();
  assert.deepEqual(plain(await journey.checkoutContext(15)), { journeyId: credentials.journeyId, journeyToken: credentials.journeyToken });
  await journey.flush(15); assert.ok(Date.now() - start < 500);
  event.resolve(json({ ok: true })); await journey.flush();
  const starting = deferred(), unresolved = h.helpers.model({ storage: memory(), session: "session1", transport: () => starting.promise });
  assert.deepEqual(plain(await unresolved.checkoutContext(15)), {});
  starting.resolve(json({ ok: true, ...credentials }));
});

test("manual retry after a lost response keeps the same idempotency key until confirmed", async () => {
  const h = harness(), requests = []; let failed = true, number = 0;
  const journey = h.helpers.model({ storage: memory(), session: "session1", randomId: () => "request" + (++number).toString().padStart(5, "0"),
    transport: async (_url, options) => { const body = JSON.parse(options.body); requests.push(body);
      if (body.action === "start") return json({ ok: true, ...credentials });
      if (failed) throw new Error("Connection lost");
      return json({ ok: true, status: "queued_local", preview: { subject: "Cart", text: "Body", restoreUrl: "http://localhost/store/#restore_cart=fixture" } });
    } });
  await assert.rejects(journey.cartEmail("private@example.com", [line]), /Connection lost/);
  failed = false; await journey.cartEmail("private@example.com", [line]);
  assert.equal(new Set(requests.filter((request) => request.action === "cart_email").map((request) => request.requestId)).size, 1);
  await journey.cartEmail("changed@example.com", [line]);
  assert.notEqual(requests.at(-1).requestId, requests.at(-2).requestId);
});

test("restore credentials are scrubbed before network, stay out of storage and are submitted only once", async () => {
  const token = "c".repeat(64);
  const h = harness({ hostname: "localhost", search: "?recovery-preview=1", hash: "#restore_cart=" + token + "&section=cart", respond: (body) => body.action === "restore" ? json({ ok: true, cart: [line], removed: [], expiresAt: credentials.expiresAt }) : undefined });
  assert.deepEqual(h.order[0], { scrub: "/store/avian-visitors/?recovery-preview=1#section=cart" });
  assert.equal(h.api.hasRestore, true); assert.doesNotMatch(h.location.hash, /restore_cart/);
  assert.deepEqual(plain((await h.api.restorePending()).cart), [line]); await h.api.restorePending();
  const restore = h.network.filter((request) => request.body.action === "restore");
  assert.equal(restore.length, 1); assert.equal(restore[0].body.restoreToken, token);
  assert.equal(restore[0].body.journeyToken, undefined);
  assert.ok(!JSON.stringify([...h.sessionStorage.data, ...h.localStorage.data]).includes(token));
});

test("live recovery consumes the early head restore token after the URL was scrubbed", async () => {
  const token = "d".repeat(64);
  const h = harness({ protocol: "https:", pathname: "/store/", hash: "#restore_cart=" + token + "&section=cart", captureRestoreInHead: true,
    respond: (body) => body.action === "restore" ? json({ ok: true, cart: [line], removed: [] }) : undefined });
  assert.deepEqual(h.order[0], { scrub: "/store/#section=cart" }); assert.deepEqual(h.order[1], { request: "config" });
  assert.doesNotMatch(h.location.hash, /restore_cart|d{64}/);
  await settle(); assert.equal(h.api.hasRestore, true);
  assert.deepEqual(plain((await h.api.restorePending()).cart), [line]); await h.api.restorePending();
  const restore = h.network.filter((request) => request.body?.action === "restore");
  assert.equal(restore.length, 1); assert.equal(restore[0].body.restoreToken, token);
  assert.ok(!JSON.stringify([...h.sessionStorage.data, ...h.localStorage.data, h.window]).includes(token));
  assert.ok(!JSON.stringify(h.network.filter((request) => request.body?.action !== "restore")).includes(token));
});

test("restore is idempotent and never silently replaces a different or newly changed cart", async () => {
  const h = harness({ hostname: "localhost", search: "?recovery-preview=1" });
  let current = h.api.compareRestore([line]); assert.equal(current.conflict, false);
  assert.equal(h.api.applyRestore([line], current.signature), true);
  current = h.api.compareRestore([line]); assert.equal(current.conflict, false);
  assert.equal(h.api.applyRestore([line], current.signature), true);
  assert.deepEqual(plain(h.helpers.getCart()), [line]);
  const other = [{ ...line, qty: 2 }]; current = h.api.compareRestore(other); assert.equal(current.conflict, true);
  assert.deepEqual(plain(h.helpers.getCart()), [line]);
  h.localStorage.setItem(CART, JSON.stringify([{ ...line, qty: 3 }]));
  assert.equal(h.api.applyRestore(other, current.signature), false);
  assert.deepEqual(plain(h.helpers.getCart()), [{ ...line, qty: 3 }]);
  current = h.api.compareRestore(other); assert.equal(h.api.applyRestore(other, current.signature), true);
  assert.deepEqual(plain(h.helpers.getCart()), other);
  await h.helpers.recoveryCheckoutContext();
});

// Minimal DOM exercising actual event handlers without a browser or additional dependency.
function uiHarness({ mode = "local", product = "avian-visitors", pathname = "/store/avian-visitors/", newsletterEnabled = true, cartEmailEnabled = true, subscribe, emailCart, hasRestore = false, restorePending, compareRestore, applyRestore } = {}) {
  let activeElement = null;
  class Element {
    constructor(tag = "div") { this.tag = tag; this.handlers = {}; this.attributes = {}; this.children = []; this.value = ""; this.textContent = ""; this.hidden = false; this.disabled = false; this.open = false; this.validity = { valid: true }; this.className = ""; this.classList = { contains: (name) => this.className.split(" ").includes(name) }; }
    set innerHTML(html) {
      this.html = html; this.children = [];
      for (const match of html.matchAll(/<([a-z][a-z0-9-]*)([^>]*)>/g)) {
        const child = new Element(match[1]);
        for (const attribute of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) child.setAttribute(attribute[1], attribute[2] ?? "");
        this.children.push(child);
      }
    }
    get innerHTML() { return this.html || ""; }
    setAttribute(key, value) { this.attributes[key] = value; if (key === "class") this.className = value; if (key === "id") this.id = value; if (key === "type") this.type = value; if (key === "hidden") this.hidden = true; }
    removeAttribute(key) { delete this.attributes[key]; }
    querySelector(selector) { return this.children.find((child) => selector[0] === "." ? child.classList.contains(selector.slice(1)) : selector[0] === "#" ? child.id === selector.slice(1) : child.tag === selector) || null; }
    appendChild(child) { this.children.push(child); }
    addEventListener(type, handler) { (this.handlers[type] ||= []).push(handler); }
    async emit(type, extra = {}) { for (const fn of this.handlers[type] || []) await fn({ preventDefault() {}, stopPropagation() {}, ...extra }); }
    focus() { activeElement = this; }
    contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
    showModal() { this.open = true; }
    close() { this.open = false; void this.emit("close"); }
  }
  const info = new Element(), drawer = new Element(), checkout = new Element(), items = new Element();
  drawer.className = "is-open"; items.children.push(Object.assign(new Element(), { className: "cart-line" }));
  const slots = { ".cart-checkout": checkout, ".cart-items": items };
  drawer.querySelector = (selector) => slots[selector] || null;
  checkout.insertAdjacentElement = (_where, el) => { slots[".recovery-preview"] = el; };
  const body = new Element(), callbacks = [];
  const document = { readyState: "complete", body, get activeElement() { return activeElement; }, createElement: (tag) => new Element(tag),
    querySelector(selector) {
      if (selector === ".cart-drawer") return drawer;
      const detail = selector.match(/^#product-detail\[data-product(?:="([^"]*)")?\] \.pd-info$/);
      return detail && product && (!detail[1] || detail[1] === product) ? info : null;
    } };
  const calls = [], recovery = { active: true, mode, newsletterEnabled, cartEmailEnabled, hasRestore, subscribe: async (email) => { calls.push({ action: "newsletter", email }); return subscribe ? subscribe(email) : { ok: true, status: mode === "live" ? "subscribed" : "queued_local" }; },
    emailCart: async (email) => { calls.push({ action: "cart_email", email }); return emailCart ? emailCart(email) : mode === "live" ? { ok: true, status: "sent" } : { ok: true, status: "queued_local", preview: { subject: "Your cart", text: "Saved cart", restoreUrl: "http://localhost:8892/store/?recovery-preview=1#restore_cart=" + "c".repeat(64) } }; },
    restorePending, compareRestore, applyRestore, keepCart() { calls.push({ action: "keep" }); } };
  const context = vm.createContext({ window: { TheodoreRecoveryPreview: recovery }, document, location: { pathname, hostname: mode === "live" ? "theodore.net" : "localhost", origin: mode === "live" ? "https://theodore.net" : "http://localhost:8892" }, URL, URLSearchParams,
    MutationObserver: class { constructor(fn) { callbacks.push(fn); } observe() {} disconnect() {} } });
  vm.runInContext(readFileSync(new URL("../docs/assets/js/store-recovery-preview.js", import.meta.url), "utf8"), context);
  const host = slots[".recovery-preview"];
  return { host, drawer, items, newsletter: info.children[0], dialogs: body.children, calls, callbacks, active: () => activeElement };
}

test("cart email toggles from link to one trailing close/submit control and restores focus", async () => {
  const h = uiHarness(), toggle = h.host.querySelector(".recovery-preview-toggle"), form = h.host.querySelector("form"), email = h.host.querySelector("input"), action = h.host.querySelector(".recovery-preview-action");
  await toggle.emit("click"); assert.equal(toggle.hidden, true); assert.equal(form.hidden, false); assert.equal(h.active(), email);
  assert.equal(action.type, "button"); assert.equal(action.attributes["aria-label"], "Close cart email");
  assert.ok(h.host.innerHTML.indexOf('class="recovery-preview-action"') > h.host.innerHTML.indexOf('id="recovery-preview-email"'));
  email.value = "person@example.com"; await email.emit("input"); assert.equal(action.type, "submit"); assert.equal(action.attributes["aria-label"], "Send cart");
  email.value = ""; await email.emit("input"); assert.equal(action.type, "button");
  await action.emit("click"); assert.equal(toggle.hidden, false); assert.equal(form.hidden, true); assert.equal(h.active(), toggle);
  await toggle.emit("click"); email.value = "some"; await email.emit("keydown", { key: "Escape" }); assert.equal(form.hidden, true); assert.equal(h.active(), toggle);
  assert.equal(h.calls.length, 0);
});

test("cart form sends through API, disables in flight, and shows the server preview only after acknowledgement", async () => {
  const request = deferred(), h = uiHarness({ emailCart: () => request.promise }), email = h.host.querySelector("input"), action = h.host.querySelector(".recovery-preview-action"), form = h.host.querySelector("form");
  await h.host.querySelector(".recovery-preview-toggle").emit("click"); email.value = "person@example.com"; await email.emit("input");
  const submitted = form.emit("submit"); await settle(); assert.equal(action.disabled, true); assert.equal(email.disabled, true); assert.equal(email.value, "person@example.com");
  request.resolve({ ok: true, status: "queued_local", preview: { subject: "Your cart at Theodore", text: "Server-rendered content", restoreUrl: "http://localhost:8892/store/?recovery-preview=1#restore_cart=" + "c".repeat(64) } });
  await submitted; assert.equal(email.value, ""); assert.equal(action.disabled, false); assert.equal(action.type, "button");
  assert.match(h.host.querySelector(".recovery-preview-status").textContent, /saved locally\. No email was sent/);
  assert.equal(h.dialogs[0].querySelector(".recovery-preview-message").textContent, "Server-rendered content");
  assert.equal(h.host.querySelector(".recovery-preview-show").hidden, false);
});

test("invalid or unconfirmed email responses preserve input for correction", async () => {
  for (const response of [{}, { ok: true, status: "queued_local" }, { ok: true, status: "queued_local", preview: { subject: "x", text: "x", restoreUrl: "https://elsewhere.example/store/#restore_cart=x" } }]) {
    const h = uiHarness({ emailCart: async () => response }), email = h.host.querySelector("input"); email.value = "person@example.com";
    await h.host.querySelector("form").emit("submit"); assert.equal(email.value, "person@example.com"); assert.equal(h.host.querySelector(".recovery-preview-error").hidden, false);
    assert.equal(h.host.querySelector(".recovery-preview-show").hidden, true);
  }
  const h = uiHarness({ subscribe: async () => ({}) }), email = h.newsletter.querySelector("input"); email.value = "person@example.com";
  await h.newsletter.emit("submit"); assert.equal(email.value, "person@example.com"); assert.equal(h.newsletter.querySelector("#newsletter-preview-error").hidden, false);
});

test("newsletter uses the real submission with approved copy and truthfully acknowledges local saving", async () => {
  const h = uiHarness(), email = h.newsletter.querySelector("input"); email.value = "person@example.com";
  assert.match(h.newsletter.innerHTML, /Sign up for new releases, restocks and deals\./);
  await h.newsletter.emit("submit"); assert.deepEqual(h.calls, [{ action: "newsletter", email: "person@example.com" }]);
  assert.equal(email.value, ""); assert.match(h.newsletter.querySelector(".newsletter-preview-status").textContent, /saved locally\. No email was sent/);
});

test("product newsletter mounts and sends the current product and selected variant for frames, kits and accessories", async () => {
  for (const fixture of [
    { id: "avian-visitors", build: "assembled-batch-2" },
    { id: "avian-visitors-kit", build: "electronics-printed", defaultBuild: "electronics" },
    { id: "polargraph", build: "electronics", status: "sold_out" },
    { id: "mic-mount", build: "default", accessory: true },
  ]) {
    const h = harness({ hostname: "localhost", search: "?recovery-preview=1", pathname: "/store/" + fixture.id + "/" });
    const variants = [...new Set([fixture.defaultBuild || fixture.build, fixture.build])].map((id) => ({ id, status: fixture.status || "available" }));
    h.helpers.setProduct({ id: fixture.id, defaultBuild: fixture.defaultBuild || fixture.build, accessory: fixture.accessory, variants }, fixture.build);
    const ui = uiHarness({ product: fixture.id, pathname: "/store/" + fixture.id + "/", subscribe: h.api.subscribe });
    assert.ok(ui.newsletter, fixture.id + " has an inline signup");
    assert.match(ui.newsletter.innerHTML, /Sign up for new releases, restocks and deals\./);
    ui.newsletter.querySelector("input").value = "person@example.com"; await ui.newsletter.emit("submit");
    const sent = h.network.filter((request) => request.body?.action === "newsletter");
    assert.equal(sent.length, 1); assert.equal(sent[0].body.product, fixture.id); assert.equal(sent[0].body.build, fixture.build);
    assert.equal(sent[0].body.copyVersion, fixture.id === "avian-visitors" ? "avian-newsletter-v1" : "store-newsletter-v1");
    assert.equal(ui.newsletter.querySelector("input").value, "");
  }
});

test("newsletter does not mount on store index, checkout or non-product pages", () => {
  for (const pathname of ["/store/", "/store/checkout/", "/projects/avian-visitors/"]) {
    const h = uiHarness({ mode: "live", product: null, pathname });
    assert.equal(h.newsletter, undefined); assert.equal(h.calls.length, 0);
  }
});

test("newsletter requires a current product and its exact selected variant, with valid product and build slugs", async () => {
  const h = harness({ hostname: "localhost", search: "?recovery-preview=1" });
  h.helpers.setProduct(null);
  await assert.rejects(h.api.subscribe("person@example.com"), /unavailable/);
  h.helpers.setProduct({ id: "avian-visitors-kit", defaultBuild: "electronics", variants: [{ id: "electronics" }] }, "unknown-variant");
  await assert.rejects(h.api.subscribe("person@example.com"), /unavailable/);
  assert.equal(h.network.filter((request) => request.body?.action === "newsletter").length, 0);
  const requests = [], journey = h.helpers.model({ storage: memory(), session: "session1",
    transport: async (_url, options) => { const body = JSON.parse(options.body); requests.push(body); return json({ ok: true, ...credentials }); } });
  for (const context of [null, {}, { product: "avian-visitors-kit" }, { product: "", build: "default" },
    { product: "private@example.com", build: "default" }, { product: "../mic-mount", build: "default" },
    { product: "mic-mount", build: "../default" }, { product: "mic-mount", build: "" },
    { product: "x".repeat(129), build: "default" }]) {
    await assert.rejects(journey.newsletter("person@example.com", context), /unavailable/);
  }
  await journey.flush(); assert.equal(requests.length, 1); assert.equal(requests[0].action, "start");
});

test("live newsletter waits for acknowledgement and distinguishes confirmed from pending subscriptions", async () => {
  for (const confirmationRequired of [true, false]) {
    const request = deferred(), h = uiHarness({ mode: "live", subscribe: () => request.promise });
    const email = h.newsletter.querySelector("input"), button = h.newsletter.querySelector("button"); email.value = "person@example.com";
    const submitted = h.newsletter.emit("submit"); await settle();
    assert.equal(email.disabled, true); assert.equal(button.disabled, true); assert.equal(email.value, "person@example.com");
    request.resolve({ ok: true, status: "subscribed", confirmationRequired }); await submitted;
    assert.equal(email.disabled, false); assert.equal(button.disabled, false); assert.equal(email.value, "");
    const message = h.newsletter.querySelector(".newsletter-preview-status").textContent;
    assert.match(message, confirmationRequired ? /Check your inbox to confirm/ : /signed up/); assert.doesNotMatch(message, /locally|No email/);
  }
});

test("live cart email acknowledges sending without exposing a local preview or restore credential", async () => {
  const request = deferred(), h = uiHarness({ mode: "live", emailCart: () => request.promise });
  const email = h.host.querySelector("input"), action = h.host.querySelector(".recovery-preview-action");
  await h.host.querySelector(".recovery-preview-toggle").emit("click"); email.value = "person@example.com"; await email.emit("input");
  const submitted = h.host.querySelector("form").emit("submit"); await settle();
  assert.equal(action.disabled, true); assert.equal(email.disabled, true); assert.equal(email.value, "person@example.com");
  request.resolve({ ok: true, status: "sent" }); await submitted;
  assert.equal(action.disabled, false); assert.equal(email.value, "");
  assert.equal(h.host.querySelector(".recovery-preview-status").textContent, "Check your inbox for your cart.");
  assert.equal(h.host.querySelector(".recovery-preview-show")?.hidden ?? true, true);
  assert.ok(h.dialogs.every((dialog) => !dialog.open));
  assert.doesNotMatch(h.host.querySelector(".recovery-preview-status").textContent, /locally|preview|restore_cart/);
  assert.deepEqual(h.calls, [{ action: "cart_email", email: "person@example.com" }]);
});

test("live forms reject local-only or unconfirmed responses and preserve the email for retry", async () => {
  for (const response of [{}, { ok: true, status: "queued_local" }, { ok: false, status: "sent" }, { ok: true, status: "subscribed" }]) {
    const h = uiHarness({ mode: "live", emailCart: async () => response }), email = h.host.querySelector("input");
    email.value = "person@example.com"; await h.host.querySelector("form").emit("submit");
    assert.equal(email.value, "person@example.com"); assert.equal(h.host.querySelector(".recovery-preview-error").hidden, false);
    assert.equal(h.host.querySelector(".recovery-preview-status").textContent, "");
  }
  const h = uiHarness({ mode: "live", subscribe: async () => ({ ok: true, status: "queued_local" }) }), email = h.newsletter.querySelector("input");
  email.value = "person@example.com"; await h.newsletter.emit("submit");
  assert.equal(email.value, "person@example.com"); assert.equal(h.newsletter.querySelector("#newsletter-preview-error").hidden, false);
});

test("server feature switches independently hide unavailable newsletter and cart email forms", () => {
  const newsletterOnly = uiHarness({ mode: "live", cartEmailEnabled: false });
  assert.ok(newsletterOnly.newsletter); assert.equal(newsletterOnly.host, undefined);
  const cartOnly = uiHarness({ mode: "live", newsletterEnabled: false });
  assert.equal(cartOnly.newsletter, undefined); assert.ok(cartOnly.host);
});

test("partial restoration tells the shopper when saved items became unavailable", async () => {
  const applied = [], h = uiHarness({ hasRestore: true, restorePending: async () => ({ ok: true, cart: [line], removed: [line] }), compareRestore: () => ({ signature: "[]", conflict: false }), applyRestore: (...args) => { applied.push(args); return true; } });
  await settle(); assert.equal(applied.length, 1);
  const dialog = h.dialogs[1]; assert.equal(dialog.open, true); assert.equal(dialog.querySelector(".recovery-restore-use").hidden, true);
  assert.match(dialog.querySelector(".recovery-restore-note").textContent, /no longer available/);
});
