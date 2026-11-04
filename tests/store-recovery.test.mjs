import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { handleRecoveryRequest, reviewRecovery, deliverRecoveryOutbox, recordRecoveryPurchase, recordRecoveryCheckout, resolveRecoveryAssociation, submitRecoveryRequest, cleanupRecoveryData } from "../lib/store-recovery.js";
import { onRequestPost, onRequestGet } from "../functions/api/store-recovery.js";

const NOW = 1800000000;
const CART = [{ id: "avian-visitors", build: "assembled-batch-2", qty: 1 }];
const CATALOG = { "avian-visitors": { title: "Avian Visitors", variants: {
  "assembled-batch-2": { price: "price_frame", maxQty: 20, inventorySku: "avian-gen3-batch-02", label: "Assembled", shippingProfile: "contiguous-us-ground" },
} }, cable: { title: "Cable", variants: { standard: { price: "price_cable", maxQty: 5 } } } };
class Statement {
  constructor(db, sql, args = []) { Object.assign(this, { db, sql, args }); }
  bind(...args) { return new Statement(this.db, this.sql, args); }
  first() { return this.db.sqlite.prepare(this.sql).get(...this.args) || null; }
  all() { return { success: true, results: this.db.sqlite.prepare(this.sql).all(...this.args), meta: { changes: 0 } }; }
  run() { const r = this.db.sqlite.prepare(this.sql).run(...this.args); return { success: true, meta: { changes: Number(r.changes) } }; }
}
class Database {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    for (const name of ["0001_store_inventory.sql", "0002_avian_batch_2.sql", "0004_store_recovery.sql"])
      this.sqlite.exec(readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"));
  }
  prepare(sql) { return new Statement(this, sql); }
  withSession() { return this; }
  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try { const result = statements.map((s) => s.run()); this.sqlite.exec("COMMIT"); return result; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const request = (body, url = "http://127.0.0.1:8788/api/store-recovery", overrides = {}) => new Request(url, {
  method: "POST", headers: { "content-type": "application/json", origin: new URL(url).origin }, body: JSON.stringify(body), ...overrides,
});
function setup(t, live = false) {
  const db = new Database(), catalog = structuredClone(CATALOG), calls = [];
  const env = { STORE_RECOVERY_ENABLED: "1", STORE_RECOVERY_MODE: live ? "live" : "local", STORE_INVENTORY: db };
  const url = live ? "https://example.test/api/store-recovery" : "http://127.0.0.1:8788/api/store-recovery";
  const old = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(String(url)); assert.ok(String(url).endsWith("/store-catalog.json"), "only catalog reads are permitted"); return response(catalog); };
  t.after(() => { globalThis.fetch = old; db.sqlite.close(); });
  const post = (body, now = NOW) => handleRecoveryRequest(env, request(body, url), { now });
  return { db, env, url, post, catalog, calls, options: { requestUrl: url, now: NOW } };
}
const start = (h, overrides) => h.post({ action: "start", anon: "anon_test", session: "session_test", source: "substack", ...overrides });
const signup = (j, extra = {}) => ({ action: "newsletter", journeyId: j.journeyId, journeyToken: j.journeyToken, requestId: "signup_request_1", email: "Reader@Example.com", copyVersion: "avian-newsletter-v1", product: "avian-visitors", build: "assembled-batch-2", ...extra });
const cartEmail = (j, extra = {}) => ({ action: "cart_email", journeyId: j.journeyId, journeyToken: j.journeyToken, requestId: "cart_request_1", email: "Reader@Example.com", cart: CART, ...extra });

test("feature, exact loopback, origin, JSON and body size gates fail closed", async (t) => {
  const h = setup(t);
  assert.equal((await onRequestPost({ env: { ...h.env, STORE_RECOVERY_ENABLED: "0" }, request: request({ action: "start" }) })).status, 404);
  for (const host of ["localhost.example.com", "127.0.0.1.example.com", "theodore.net"]) {
    const r = await onRequestPost({ env: h.env, request: request({ action: "start" }, "https://" + host + "/api/store-recovery") }); assert.equal(r.status, 403);
  }
  assert.equal((await onRequestPost({ env: h.env, request: request({}, h.url, { headers: { origin: "https://evil.test", "content-type": "application/json" } }) })).status, 403);
  assert.equal((await onRequestPost({ env: h.env, request: request({}, h.url, { headers: { origin: new URL(h.url).origin, "content-type": "text/plain" } }) })).status, 415);
  assert.equal((await onRequestPost({ env: h.env, request: request({ text: "x".repeat(17000) }) })).status, 413);
  assert.equal((await onRequestGet({ env: { ...h.env, STORE_RECOVERY_MODE: "live" }, request: new Request("https://example.test/api/store-recovery") })).status, 404);
});

test("opaque credentials are hashed, expire, and cannot authenticate another journey", async (t) => {
  const h = setup(t), one = await start(h), two = await start(h, { session: "session_two" });
  const rows = h.db.sqlite.prepare("SELECT * FROM store_recovery_journeys").all();
  assert.equal(rows.length, 2); assert.ok(rows.every((r) => r.token_hash !== one.journeyToken && r.token_hash !== two.journeyToken));
  assert.equal((await resolveRecoveryAssociation(h.env, one, h.options)).journeyId, one.journeyId);
  await assert.rejects(resolveRecoveryAssociation(h.env, { journeyId: one.journeyId, journeyToken: two.journeyToken }, h.options), { status: 401 });
  await assert.rejects(resolveRecoveryAssociation(h.env, one, { ...h.options, now: one.expiresAt }), { status: 401 });
  assert.equal(await resolveRecoveryAssociation({ ...h.env, STORE_RECOVERY_ENABLED: "0" }, one, h.options), null);
});

test("newsletter is durable, fixed-source, idempotent and separate from a requested cart email", async (t) => {
  const h = setup(t), j = await start(h);
  const a = await h.post(signup(j, { tags: ["waitlist"], placement: "forged", password: "never" }));
  const b = await h.post(signup(j)); assert.deepEqual(a, b);
  assert.equal(a.status, "queued_local");
  assert.equal(h.db.sqlite.prepare("SELECT count(*) AS n FROM store_recovery_outbox").get().n, 1);
  const association = h.db.sqlite.prepare("SELECT * FROM store_recovery_journey_contacts").get();
  assert.equal(association.purpose, "newsletter"); assert.equal(association.placement, "avian-visitors-product");
  const payload = JSON.parse(h.db.sqlite.prepare("SELECT payload_json FROM store_recovery_outbox").get().payload_json);
  assert.deepEqual(payload.tags, ["newsletter", "avian-visitors-product"]);
  await assert.rejects(h.post(signup(j, { email: "other@example.com" })), { status: 409 });
  await assert.rejects(h.post(signup(j, { requestId: "wrong_copy_request", copyVersion: "unapproved" })), { status: 400 });
  await h.post(cartEmail(j, { email: "cartonly@example.com" }));
  assert.equal(h.db.sqlite.prepare("SELECT count(*) AS n FROM store_recovery_journey_contacts j JOIN store_recovery_contacts c USING(email_hash) WHERE c.email='cartonly@example.com' AND purpose='newsletter'").get().n, 0);
  assert.equal(h.calls.some((u) => /buttondown|resend/.test(u)), false);
});

test("local cart email has an immutable preview, secure reusable restore and server validation", async (t) => {
  const h = setup(t), j = await start(h), result = await h.post(cartEmail(j, { cart: [{ ...CART[0], price: 1, voucher: "SECRET" }] }));
  const retry = await h.post(cartEmail(j)); assert.deepEqual(result, retry);
  const link = new URL(result.preview.restoreUrl); assert.equal(link.searchParams.has("restore_cart"), false);
  const restoreToken = new URLSearchParams(link.hash.slice(1)).get("restore_cart");
  assert.match(restoreToken, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(result.preview.text, /reader@|SECRET|client_secret|journeyToken/);
  const restoreRow = h.db.sqlite.prepare("SELECT * FROM store_recovery_restores").get(); assert.notEqual(restoreRow.token_hash, restoreToken);
  const body = { action: "restore", restoreToken };
  const once = await h.post(body), twice = await h.post(body); assert.deepEqual(once, twice); assert.deepEqual(once.cart, CART);
  h.db.sqlite.exec("UPDATE store_inventory_batches SET sold_quantity=capacity WHERE sku='avian-gen3-batch-02'");
  assert.deepEqual(await h.post(cartEmail(j)), result, "a retry returns the original queued message even after stock changes");
  const sold = await h.post(body); assert.deepEqual(sold.cart, []); assert.deepEqual(sold.removed, CART);
  await assert.rejects(h.post(body, restoreRow.expires_at), { status: 404 });
});

test("retired, unknown and excessive cart variants cannot be queued and client purchase events are rejected", async (t) => {
  const h = setup(t), j = await start(h);
  for (const cart of [[{ ...CART[0], qty: 21 }], [{ ...CART[0], build: "invented" }], [{ ...CART[0], qty: 1.5 }]])
    await assert.rejects(h.post(cartEmail(j, { cart })), (e) => [400, 409].includes(e.status));
  h.catalog["avian-visitors"].retiredBuilds = ["assembled-batch-2"];
  await assert.rejects(h.post(cartEmail(j)), { status: 409 });
  await assert.rejects(h.post({ action: "event", ...j, requestId: "event_purchase_1", type: "purchase" }), { status: 400 });
  assert.equal(h.db.sqlite.prepare("SELECT count(*) AS n FROM store_recovery_outbox").get().n, 0);
});

test("events remain pseudonymous, preserve original visit, dedupe, and classify only aged cart intent", async (t) => {
  const h = setup(t), j = await start(h);
  const event = { action: "event", ...j, requestId: "event_cart_1", type: "add_to_cart", cart: CART, product: "avian-visitors", build: "assembled-batch-2", session: "forged_session", email: "secret@example.com" };
  await h.post(event); await h.post(event);
  assert.equal(h.db.sqlite.prepare("SELECT count(*) AS n FROM store_recovery_events").get().n, 1);
  assert.doesNotMatch(h.db.sqlite.prepare("SELECT detail_json FROM store_recovery_events").get().detail_json, /secret@|forged_session/);
  assert.equal((await reviewRecovery(h.env, h.options)).visits[0].classification, "active_or_pending");
  assert.equal((await reviewRecovery(h.env, { ...h.options, now: NOW + 86401 })).visits[0].classification, "aged_24h_no_purchase_observed");
  await h.post({ ...event, requestId: "event_cart_2", type: "cart_updated", cart: [] });
  await h.post(event, NOW + 100);
  const v = (await reviewRecovery(h.env, { ...h.options, now: NOW + 86401 })).visits[0];
  assert.equal(v.classification, "inactive_no_cart_intent"); assert.equal(v.purchaseStatus, "not_observed"); assert.equal(v.followUpEligible, false);
  assert.equal(v.session, "session_test");
  assert.deepEqual(v.cart, [], "an older event retry never restores a removed cart");
  assert.deepEqual(v.events.at(-1).removed, CART);
});

test("contact and start abuse limits are durable and retries do not consume another cart-email allowance", async (t) => {
  const h = setup(t), j = await start(h);
  for (let i = 0; i < 5; i++) await h.post(cartEmail(j, { requestId: "request_cart_" + i }));
  await h.post(cartEmail(j, { requestId: "request_cart_0" }));
  await assert.rejects(h.post(cartEmail(j, { requestId: "request_cart_extra" })), { status: 429 });
  for (let i = 0; i < 29; i++) await start(h);
  await assert.rejects(start(h), { status: 429 });
});

test("trusted purchase association is idempotent and email matching respects product and chronology", async (t) => {
  const h = setup(t), j = await start(h);
  await h.post(signup(j)); await h.post({ action: "event", ...j, requestId: "event_cart_1", type: "add_to_cart", cart: CART });
  await recordRecoveryPurchase(h.env, { paymentIntentId: "pi_prior", eventId: "evt_prior", email: "reader@example.com", cart: CART, eventCreated: NOW - 10 }, h.options);
  await recordRecoveryPurchase(h.env, { paymentIntentId: "pi_other", eventId: "evt_other", email: "reader@example.com", cart: [{ id: "cable", build: "standard", qty: 1 }] }, h.options);
  assert.equal((await reviewRecovery(h.env, h.options)).visits[0].purchaseStatus, "not_observed");
  const purchase = { paymentIntentId: "pi_frame", eventId: "evt_frame", email: "READER@example.com", cart: CART };
  await recordRecoveryPurchase(h.env, purchase, h.options); await recordRecoveryPurchase(h.env, purchase, h.options);
  assert.equal(h.db.sqlite.prepare("SELECT count(*) AS n FROM store_recovery_purchases").get().n, 3);
  assert.equal((await reviewRecovery(h.env, h.options)).visits[0].purchaseStatus, "purchased");
  const checkout = await recordRecoveryCheckout(h.env, { journeyId: "missing", paymentIntentId: "pi_missing", cart: CART }, h.options); assert.equal(checkout, null);
});

test("no configuration can deliver a local outbox row", async (t) => {
  const h = setup(t), j = await start(h), queued = await h.post(cartEmail(j));
  const never = async () => { throw new Error("provider must not be called"); };
  assert.deepEqual(await deliverRecoveryOutbox({ ...h.env, STORE_RECOVERY_SEND_ENABLED: "1", RESEND_API_KEY: "test_only", STORE_MAILING_ADDRESS: "123 Example Street\nExample, CA 90000" }, queued.outboxId, { ...h.options, fetchFn: never }), { skipped: true });
  assert.deepEqual(await deliverRecoveryOutbox({ ...h.env, STORE_RECOVERY_MODE: "live", STORE_RECOVERY_SEND_ENABLED: "1", RESEND_API_KEY: "test_only", STORE_MAILING_ADDRESS: "123 Example Street\nExample, CA 90000" }, queued.outboxId, { requestUrl: "https://example.test/api/recovery", now: NOW, fetchFn: never }), { skipped: true });
});

test("Resend delivery leases concurrent work, retries with the same provider key, and fences late uncertainty", async (t) => {
  const h = setup(t, true), j = await start(h), queued = await h.post(cartEmail(j));
  const env = { ...h.env, STORE_RECOVERY_SEND_ENABLED: "1", RESEND_API_KEY: "test_only", STORE_MAILING_ADDRESS: "123 Example Street\nExample, CA 90000" }, calls = [];
  let release; const pending = new Promise((resolve) => { release = resolve; });
  const fetchFn = async (url, options) => { calls.push({ url, options }); await pending; return response({ id: "email_test" }); };
  const sending = deliverRecoveryOutbox(env, queued.outboxId, { ...h.options, fetchFn });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await deliverRecoveryOutbox(env, queued.outboxId, { ...h.options, fetchFn }), { skipped: true });
  release(); await sending; assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers["Idempotency-Key"], "store-cart/" + queued.outboxId);
  assert.deepEqual(await deliverRecoveryOutbox(env, queued.outboxId, { ...h.options, fetchFn }), { skipped: true });
  const second = await h.post(cartEmail(j, { requestId: "cart_retry_2" })), keys = [];
  const uncertain = async (url, options) => { keys.push(options.headers["Idempotency-Key"]); throw new Error("network_uncertain"); };
  await deliverRecoveryOutbox(env, second.outboxId, { ...h.options, fetchFn: uncertain });
  await deliverRecoveryOutbox(env, second.outboxId, { ...h.options, now: NOW + 100, fetchFn: uncertain });
  assert.equal(keys[0], keys[1]);
  assert.deepEqual(await deliverRecoveryOutbox(env, second.outboxId, { ...h.options, now: NOW + 20 * 3600, fetchFn: uncertain }), { review: true });
  assert.equal(keys.length, 2);
});

test("Buttondown never reactivates unsubscribed addresses and no cart email enrolls a newsletter", async (t) => {
  const h = setup(t, true), j = await start(h), queued = await h.post(signup(j));
  const calls = [], env = { ...h.env, STORE_RECOVERY_SEND_ENABLED: "1", BUTTONDOWN_API_KEY: "test_only" };
  const result = await deliverRecoveryOutbox(env, queued.outboxId, { ...h.options, fetchFn: async (url, options) => {
    calls.push({ url, options }); return response({ id: "subscriber_old", type: "unsubscribed" });
  } });
  assert.equal(result.suppressed, true); assert.equal(calls.length, 1); assert.equal(calls[0].options.method, undefined);
  assert.equal(h.db.sqlite.prepare("SELECT suppression_reason FROM store_recovery_contacts").get().suppression_reason, "provider_ineligible");
});

test("Buttondown creation preserves double opt-in and tags only the requested newsletter origin", async (t) => {
  const h = setup(t, true), j = await start(h), queued = await h.post(signup(j)), writes = [];
  const result = await deliverRecoveryOutbox({ ...h.env, STORE_RECOVERY_SEND_ENABLED: "1", BUTTONDOWN_API_KEY: "test_only" }, queued.outboxId, { ...h.options, fetchFn: async (url, options) => {
    if (options.method) writes.push(JSON.parse(options.body));
    if (url.endsWith("/tags")) return response([{ id: "tag_news", name: "newsletter" }, { id: "tag_avian", name: "avian-visitors-product" }]);
    if (options.method === "POST") return response({ id: "subscriber_new", type: "unactivated", tags: [] });
    if (options.method === "PATCH") return response({ id: "subscriber_new" });
    return response({}, 404);
  } });
  assert.equal(result.id, "subscriber_new");
  assert.equal(writes[0].type, undefined);
  assert.deepEqual(writes[1].tags, ["tag_news", "tag_avian"]);
  assert.doesNotMatch(JSON.stringify(writes), /waitlist/);
});

test("a new cart remains sendable after an older purchase, while a later matching purchase suppresses it", async (t) => {
  const h = setup(t, true), j = await start(h), a = await h.post(cartEmail(j));
  const env = { ...h.env, STORE_RECOVERY_SEND_ENABLED: "1", RESEND_API_KEY: "test_only", STORE_MAILING_ADDRESS: "123 Example Street\nExample, CA 90000" };
  await recordRecoveryPurchase(env, { paymentIntentId: "pi_older", eventId: "evt_older", email: "reader@example.com", cart: CART, eventCreated: NOW - 100 }, h.options);
  let sends = 0;
  const fetchFn = async () => { sends++; return response({ id: "email_once" }); };
  assert.equal((await deliverRecoveryOutbox(env, a.outboxId, { ...h.options, fetchFn })).id, "email_once");
  const b = await h.post(cartEmail(j, { requestId: "cart_second_request" }));
  await recordRecoveryPurchase(env, { paymentIntentId: "pi_newer", eventId: "evt_newer", email: "reader@example.com", cart: CART, eventCreated: NOW + 10 }, { ...h.options, now: NOW + 10 });
  assert.deepEqual(await deliverRecoveryOutbox(env, b.outboxId, { ...h.options, now: NOW + 20, fetchFn }), { suppressed: true });
  assert.equal(sends, 1);
});

test("a late worker cannot overwrite a newer successful delivery after its lease expires", async (t) => {
  const h = setup(t, true), j = await start(h), queued = await h.post(cartEmail(j));
  const env = { ...h.env, STORE_RECOVERY_SEND_ENABLED: "1", RESEND_API_KEY: "test_only", STORE_MAILING_ADDRESS: "123 Example Street\nExample, CA 90000" };
  let release; const pending = new Promise((resolve) => { release = resolve; });
  const old = deliverRecoveryOutbox(env, queued.outboxId, { ...h.options, fetchFn: async () => { await pending; throw new Error("network_uncertain"); } });
  await new Promise((resolve) => setImmediate(resolve));
  await deliverRecoveryOutbox(env, queued.outboxId, { ...h.options, now: NOW + 121, fetchFn: async () => response({ id: "email_newer" }) });
  release(); await old;
  const row = h.db.sqlite.prepare("SELECT status,provider_id FROM store_recovery_outbox WHERE id=?").get(queued.outboxId);
  assert.equal(row.status, "sent"); assert.equal(row.provider_id, "email_newer");
});

test("Buttondown pagination preserves unrelated named, raw-ID and expanded-object tags", async (t) => {
  const h = setup(t, true), j = await start(h), queued = await h.post(signup(j));
  let patched;
  const result = await deliverRecoveryOutbox({ ...h.env, STORE_RECOVERY_SEND_ENABLED: "1", BUTTONDOWN_API_KEY: "test_only" }, queued.outboxId, { ...h.options, fetchFn: async (url, options) => {
    if (options.method === "PATCH") { patched = JSON.parse(options.body); return response({ id: "subscriber_existing" }); }
    if (url.endsWith("/tags")) return response({ results: [{ id: "tag_news", name: "newsletter" }], next: "https://api.buttondown.email/v1/tags?page=2" });
    if (url.endsWith("?page=2")) return response({ results: [{ id: "tag_avian", name: "avian-visitors-product" }, { id: "tag_else", name: "unrelated" }], next: null });
    return response({ id: "subscriber_existing", type: "regular", tags: ["unrelated", "raw_unlisted_id", { id: "object_tag_id", name: "Object tag" }] });
  } });
  assert.equal(result.id, "subscriber_existing");
  assert.deepEqual(new Set(patched.tags), new Set(["tag_else", "raw_unlisted_id", "object_tag_id", "tag_news", "tag_avian"]));
});

test("standalone checkout helper cannot mutate the wrong journey or attach its contact", async (t) => {
  const h = setup(t), one = await start(h), two = await start(h, { session: "session_other" });
  await recordRecoveryCheckout(h.env, { journeyId: one.journeyId, paymentIntentId: "pi_same", cart: CART, email: "one@example.com" }, h.options);
  assert.equal(await recordRecoveryCheckout(h.env, { journeyId: two.journeyId, paymentIntentId: "pi_same", cart: CART, email: "two@example.com" }, h.options), null);
  assert.equal(h.db.sqlite.prepare("SELECT count(*) AS n FROM store_recovery_contacts WHERE email='two@example.com'").get().n, 0);
  assert.equal(h.db.sqlite.prepare("SELECT checkout_at FROM store_recovery_journeys WHERE id=?").get(two.journeyId).checkout_at, null);
});


test("public capability check exposes no records and requires complete live delivery settings", async (t) => {
  const h = setup(t, true), j = await start(h);
  await h.post(signup(j));
  const url = h.url + "?status=1";
  const disabled = await onRequestGet({ env: { ...h.env, STORE_RECOVERY_ENABLED: "0" }, request: new Request(url) });
  assert.equal(disabled.status, 404);
  const env = { ...h.env, STORE_RECOVERY_SEND_ENABLED: "1", BUTTONDOWN_API_KEY: "not-a-real-key", RESEND_API_KEY: "not-a-real-key" };
  const partial = await (await onRequestGet({ env, request: new Request(url) })).json();
  assert.deepEqual(partial, { ok: true, enabled: true, mode: "live", newsletter: true, cartEmail: false });
  const complete = await (await onRequestGet({ env: { ...env, STORE_MAILING_ADDRESS: "123 Example Street" }, request: new Request(url) })).json();
  assert.equal(complete.cartEmail, true);
  assert.doesNotMatch(JSON.stringify(complete), /reader|not-a-real-key|outbox|journey|subscriber/);
  assert.equal((await onRequestGet({ env, request: new Request(h.url) })).status, 404);
});

test("live cart submission waits for provider acceptance, includes the required footer, and deduplicates retries", async (t) => {
  const h = setup(t, true), j = await start(h), calls = [];
  const env = { ...h.env, STORE_RECOVERY_SEND_ENABLED: "1", RESEND_API_KEY: "test_only", STORE_MAILING_ADDRESS: "123 Example Street\nExample, CA 90000" };
  const options = { now: NOW, fetchFn: async (url, init) => { calls.push({ url, init }); return response({ id: "email_accepted" }); } };
  const body = cartEmail(j);
  assert.deepEqual(await submitRecoveryRequest(env, request(body, h.url), options), { ok: true, status: "sent", requestId: body.requestId });
  assert.deepEqual(await submitRecoveryRequest(env, request(body, h.url), options), { ok: true, status: "sent", requestId: body.requestId });
  assert.equal(calls.length, 1);
  const email = JSON.parse(calls[0].init.body);
  assert.match(email.text, /Things by Theodore LLC\n123 Example Street/);
  assert.match(email.text, /To stop cart emails, reply to support@theodore.net/);
  assert.equal(email.to[0], "reader@example.com");
});

test("live provider failure stays retryable and cannot masquerade as a successful signup", async (t) => {
  const h = setup(t, true), j = await start(h), body = signup(j), env = { ...h.env, STORE_RECOVERY_SEND_ENABLED: "1", BUTTONDOWN_API_KEY: "test_only" };
  await assert.rejects(submitRecoveryRequest(env, request(body, h.url), { now: NOW, fetchFn: async () => response({}, 503) }), { status: 502 });
  assert.equal(h.db.sqlite.prepare("SELECT status FROM store_recovery_outbox").get().status, "retry");
  let creates = 0, sentIp;
  const fetchFn = async (url, init) => {
    if (url.endsWith("/tags")) return response([{ id: "tag_news", name: "newsletter" }, { id: "tag_avian", name: "avian-visitors-product" }]);
    if (init.method === "POST") { creates++; sentIp = JSON.parse(init.body).ip_address; return response({ id: "subscriber_new", type: "unactivated", tags: [] }); }
    if (init.method === "PATCH") return response({ id: "subscriber_new" });
    return response({}, 404);
  };
  const trusted = () => request(body, h.url, { headers: { origin: new URL(h.url).origin, "content-type": "application/json", "CF-Connecting-IP": "203.0.113.50" } });
  const accepted = await submitRecoveryRequest(env, trusted(), { now: NOW, fetchFn });
  assert.deepEqual(accepted, { ok: true, status: "subscribed", confirmationRequired: true, requestId: body.requestId });
  assert.deepEqual(await submitRecoveryRequest(env, trusted(), { now: NOW, fetchFn }), accepted);
  assert.equal(creates, 1); assert.equal(sentIp, "203.0.113.50");
  const dump = h.db.sqlite.prepare("SELECT payload_json FROM store_recovery_outbox").get().payload_json;
  assert.doesNotMatch(dump, /203\.0\.113\.50/);
});

test("a concurrent Buttondown create safely rereads the existing subscriber without reactivating it", async (t) => {
  const h = setup(t, true), j = await start(h), queued = await h.post(signup(j));
  let reads = 0, patches = 0;
  const result = await deliverRecoveryOutbox({ ...h.env, STORE_RECOVERY_SEND_ENABLED: "1", BUTTONDOWN_API_KEY: "test_only" }, queued.outboxId, { ...h.options, clientIp: "127.0.0.1", fetchFn: async (url, init) => {
    if (url.endsWith("/tags")) return response([{ id: "tag_news", name: "newsletter" }, { id: "tag_avian", name: "avian-visitors-product" }]);
    if (init.method === "POST") { assert.equal(JSON.parse(init.body).ip_address, undefined); return response({ code: "email_already_exists" }, 400); }
    if (init.method === "PATCH") { patches++; return response({}); }
    reads++; return reads === 1 ? response({}, 404) : response({ id: "subscriber_existing", type: "unsubscribed" });
  } });
  assert.equal(result.suppressed, true); assert.equal(patches, 0);
});

test("missing credentials return 401 and local submissions never contact a provider", async (t) => {
  const h = setup(t), j = await start(h);
  const unauthenticated = await onRequestPost({ env: h.env, request: request({ action: "event", requestId: "missing_auth", type: "view_item" }, h.url) });
  assert.equal(unauthenticated.status, 401);
  const local = await submitRecoveryRequest({ ...h.env, STORE_RECOVERY_SEND_ENABLED: "1", RESEND_API_KEY: "test_only", STORE_MAILING_ADDRESS: "123 Example Street" }, request(cartEmail(j), h.url), { now: NOW, fetchFn: async () => { throw new Error("must not deliver"); } });
  assert.equal(local.status, "queued_local");
});

test("bounded retention removes old activity and raw contact data but preserves current visits and minimal opt-outs", async (t) => {
  const h = setup(t), old = await start(h);
  await h.post(signup(old)); await h.post(cartEmail(old));
  await recordRecoveryCheckout(h.env, { journeyId: old.journeyId, paymentIntentId: "pi_old", cart: CART, email: "reader@example.com" }, h.options);
  await recordRecoveryPurchase(h.env, { journeyId: old.journeyId, paymentIntentId: "pi_old", eventId: "evt_old", email: "reader@example.com", cart: CART }, h.options);
  h.db.sqlite.prepare("UPDATE store_recovery_contacts SET unsubscribed_at=?,suppression_reason='provider_ineligible' WHERE email='reader@example.com'").run(NOW);
  const currentTime = NOW + 91 * 86400;
  const current = await h.post({ action: "start", session: "current_session", source: "direct" }, currentTime);
  assert.equal(h.db.sqlite.prepare("SELECT count(*) AS n FROM store_recovery_journeys").get().n, 1);
  assert.equal(h.db.sqlite.prepare("SELECT id FROM store_recovery_journeys").get().id, current.journeyId);
  for (const table of ["events", "requests", "outbox", "restores", "journey_contacts", "checkouts", "purchases"])
    assert.equal(h.db.sqlite.prepare("SELECT count(*) AS n FROM store_recovery_" + table).get().n, 0, table);
  const suppressed = h.db.sqlite.prepare("SELECT email,email_hash,unsubscribed_at,subscriber_id FROM store_recovery_contacts").get();
  assert.equal(suppressed.email, ""); assert.match(suppressed.email_hash, /^[a-f0-9]{64}$/); assert.equal(suppressed.unsubscribed_at, NOW); assert.equal(suppressed.subscriber_id, null);
  assert.deepEqual(await cleanupRecoveryData(h.env, { ...h.options, now: currentTime + 1 }), { skipped: true });
  const inventory = h.db.sqlite.prepare("SELECT capacity,sold_quantity,reserved_quantity FROM store_inventory_batches WHERE sku='avian-gen3-batch-02'").get();
  assert.deepEqual({ ...inventory }, { capacity: 100, sold_quantity: 0, reserved_quantity: 0 });
});


test("newsletter opt-outs do not block a separately requested cart email", async (t) => {
  const h = setup(t, true), j = await start(h), signupRequest = await h.post(signup(j));
  const env = { ...h.env, STORE_RECOVERY_SEND_ENABLED: "1", BUTTONDOWN_API_KEY: "test_only", RESEND_API_KEY: "test_only", STORE_MAILING_ADDRESS: "123 Example Street" };
  await deliverRecoveryOutbox(env, signupRequest.outboxId, { ...h.options, fetchFn: async () => response({ id: "unsubscribed_person", type: "unsubscribed" }) });
  const queued = await h.post(cartEmail(j));
  let calls = 0;
  const delivered = await deliverRecoveryOutbox(env, queued.outboxId, { ...h.options, fetchFn: async () => { calls++; return response({ id: "requested_cart" }); } });
  assert.equal(delivered.id, "requested_cart"); assert.equal(calls, 1);
  h.db.sqlite.prepare("UPDATE store_recovery_contacts SET suppression_reason='cart_opt_out' WHERE email='reader@example.com'").run();
  const next = await h.post(cartEmail(j, { requestId: "cart_after_optout" }));
  assert.deepEqual(await deliverRecoveryOutbox(env, next.outboxId, { ...h.options, fetchFn: async () => { throw new Error("must not send"); } }), { suppressed: true });
});

test("a newly created ineligible Buttondown subscriber is not reported as enrolled", async (t) => {
  const h = setup(t, true), j = await start(h), queued = await h.post(signup(j));
  let patches = 0;
  const result = await deliverRecoveryOutbox({ ...h.env, STORE_RECOVERY_SEND_ENABLED: "1", BUTTONDOWN_API_KEY: "test_only" }, queued.outboxId, { ...h.options, fetchFn: async (url, init) => {
    if (url.endsWith("/tags")) return response({ results: [{ id: "tag_news", name: "newsletter" }], next: "/v1/tags/?page=2" });
    if (url.endsWith("/?page=2")) return response({ results: [{ id: "tag_avian", name: "avian-visitors-product" }], next: null });
    if (init.method === "POST") return response({ id: "subscriber_spam", type: "spam" });
    if (init.method === "PATCH") { patches++; return response({}); }
    return response({}, 404);
  } });
  assert.equal(result.suppressed, true); assert.equal(patches, 0);
});


test("Buttondown tag creation supplies the required color and merges a concurrently created tag ID", async (t) => {
  const h = setup(t, true), j = await start(h), queued = await h.post(signup(j));
  const createdTags = []; let patched;
  const result = await deliverRecoveryOutbox({ ...h.env, STORE_RECOVERY_SEND_ENABLED: "1", BUTTONDOWN_API_KEY: "test_only" }, queued.outboxId, { ...h.options, fetchFn: async (url, init) => {
    if (url.endsWith("/tags") && init.method === "POST") {
      const tag = JSON.parse(init.body); createdTags.push(tag);
      if (!tag.color) return response({ code: "invalid_data", detail: "color is required" }, 400);
      return tag.name === "newsletter" ? response({ id: "tag_news", ...tag }, 201) : response({ code: "name_already_exists", metadata: { tag_id: "tag_avian" } }, 400);
    }
    if (url.endsWith("/tags")) return response({ results: [] });
    if (init.method === "PATCH") { patched = JSON.parse(init.body); return response({ id: "subscriber_existing" }); }
    return response({ id: "subscriber_existing", type: "regular", tags: ["unrelated_tag_id"] });
  } });
  assert.equal(result.id, "subscriber_existing");
  assert.deepEqual(createdTags, [{ name: "newsletter", color: "#808080" }, { name: "avian-visitors-product", color: "#808080" }]);
  assert.deepEqual(new Set(patched.tags), new Set(["unrelated_tag_id", "tag_news", "tag_avian"]));
});

test("Buttondown existing tag names match without case sensitivity or duplicate create calls", async (t) => {
  const h = setup(t, true), j = await start(h), queued = await h.post(signup(j));
  let patched;
  const result = await deliverRecoveryOutbox({ ...h.env, STORE_RECOVERY_SEND_ENABLED: "1", BUTTONDOWN_API_KEY: "test_only" }, queued.outboxId, { ...h.options, fetchFn: async (url, init) => {
    assert.notEqual(init.method, "POST", "existing tags must not be recreated");
    if (url.endsWith("/tags")) return response({ results: [{ id: "tag_news", name: "Newsletter" }, { id: "tag_avian", name: "Avian-Visitors-Product" }, { id: "tag_else", name: "Other" }] });
    if (init.method === "PATCH") { patched = JSON.parse(init.body); return response({}); }
    return response({ id: "subscriber_existing", type: "regular", tags: ["OTHER"] });
  } });
  assert.equal(result.id, "subscriber_existing");
  assert.deepEqual(new Set(patched.tags), new Set(["tag_else", "tag_news", "tag_avian"]));
});

test("Buttondown tag failures keep a useful HTTP code without retaining provider error details", async (t) => {
  const h = setup(t, true), j = await start(h), queued = await h.post(signup(j));
  const result = await deliverRecoveryOutbox({ ...h.env, STORE_RECOVERY_SEND_ENABLED: "1", BUTTONDOWN_API_KEY: "test_only" }, queued.outboxId, { ...h.options, fetchFn: async (url, init) => {
    if (url.endsWith("/tags") && init.method === "POST") return response({ code: "invalid_data", detail: "private provider detail" }, 400);
    if (url.endsWith("/tags")) return response({ results: [] });
    return response({ id: "subscriber_existing", type: "regular", tags: [] });
  } });
  assert.deepEqual(result, { retry: true });
  assert.equal(h.db.sqlite.prepare("SELECT last_error FROM store_recovery_outbox").get().last_error, "newsletter_tag_http_400");
});
