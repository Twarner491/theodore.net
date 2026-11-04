import { sha256Hex } from "./shipping-profile.js";
import { readInventoryAvailability } from "./store-inventory.js";
import { launchPending } from "./store-launch.js";

const DAY = 86400, TTL = 7 * DAY, RETENTION = 90 * DAY;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,99}$/;
const TOKEN = /^[a-f0-9]{64}$/;
const SLUG = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
const TYPES = new Set(["view_item", "view_item_list", "add_to_cart", "view_cart", "begin_checkout", "cart_observed", "cart_updated"]);
const clock = (options = {}) => options.now ?? Math.floor(Date.now() / 1000);
const random = () => [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, "0")).join("");
const decode = (text, fallback) => { try { return JSON.parse(text); } catch (_) { return fallback; } };
const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
const slug = (value) => typeof value === "string" && SLUG.test(value) ? value : null;
function emailAddress(value) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Enter a valid email address.");
  return email;
}
function optionalEmail(value) { try { return value ? emailAddress(value) : null; } catch (_) { return null; } }
function newsletterContext(value) {
  const copyVersion = value.product === "avian-visitors" ? "avian-newsletter-v1" : "store-newsletter-v1";
  if (!slug(value.product) || !slug(value.build) || value.copyVersion !== copyVersion) fail("Invalid signup context.");
  const placement = value.product + "-product";
  return { product: value.product, build: value.build, placement, path: "/store/" + value.product + "/", copyVersion, tags: ["newsletter", placement] };
}
export function recoveryEnabled(env) { return env && env.STORE_RECOVERY_ENABLED === "1"; }
function config(env, options = {}) {
  if (!recoveryEnabled(env)) fail("This feature is not enabled.", 404);
  const mode = env.STORE_RECOVERY_MODE;
  let url; try { url = new URL(options.requestUrl); } catch (_) { fail("Recovery configuration unavailable.", 503); }
  if (mode === "local") {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) fail("Local recovery is available only on loopback.", 403);
  } else if (mode !== "live" || url.protocol !== "https:") fail("Recovery configuration unavailable.", 503);
  const binding = env.STORE_INVENTORY;
  if (!binding || typeof binding.prepare !== "function") fail("Recovery storage unavailable.", 503);
  return { mode, url, db: typeof binding.withSession === "function" ? binding.withSession("first-primary") : binding };
}
// Public capability check exposes no visits, contacts, provider IDs or credentials.
export async function recoveryStatus(env, options = {}) {
  const { db, mode } = config(env, options);
  await db.prepare("SELECT id FROM store_recovery_journeys LIMIT 1").first();
  await db.prepare("SELECT id FROM store_recovery_outbox LIMIT 1").first();
  const delivery = mode === "local" || env.STORE_RECOVERY_SEND_ENABLED === "1";
  return { ok: true, enabled: true, mode,
    newsletter: delivery && (mode === "local" || !!env.BUTTONDOWN_API_KEY),
    cartEmail: delivery && (mode === "local" || !!env.RESEND_API_KEY && !!env.STORE_MAILING_ADDRESS?.trim()) };
}

// A small maintenance batch on new visits bounds retention without a campaign or cron.
// The per-15-minute claim prevents every shopper from running the same cleanup.
export async function cleanupRecoveryData(env, options = {}) {
  const { db } = config(env, options), now = clock(options), cutoff = now - RETENTION;
  const claim = await db.prepare(`INSERT INTO store_recovery_rate_limits(key,window_start,count) VALUES('maintenance:retention',?,1)
    ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,count=1
    WHERE store_recovery_rate_limits.window_start<=? RETURNING window_start`).bind(now, now - 900).first();
  if (!claim) return { skipped: true };
  const oldJourneys = "SELECT id FROM store_recovery_journeys WHERE created_at<? ORDER BY created_at LIMIT 100";
  const statements = ["store_recovery_events", "store_recovery_requests", "store_recovery_restores", "store_recovery_outbox", "store_recovery_journey_contacts", "store_recovery_checkouts"]
    .map((table) => db.prepare(`DELETE FROM ${table} WHERE journey_id IN (${oldJourneys})`).bind(cutoff));
  statements.push(db.prepare(`UPDATE store_recovery_purchases SET journey_id=NULL WHERE journey_id IN (${oldJourneys})`).bind(cutoff));
  statements.push(db.prepare(`DELETE FROM store_recovery_journeys WHERE id IN (${oldJourneys})`).bind(cutoff));
  statements.push(db.prepare("DELETE FROM store_recovery_purchases WHERE payment_intent_id IN (SELECT payment_intent_id FROM store_recovery_purchases WHERE created_at<? LIMIT 200)").bind(cutoff));
  statements.push(db.prepare("DELETE FROM store_recovery_restores WHERE id IN (SELECT id FROM store_recovery_restores WHERE expires_at<=? LIMIT 200)").bind(now));
  const orphan = `created_at<? AND NOT EXISTS (SELECT 1 FROM store_recovery_journey_contacts j WHERE j.email_hash=store_recovery_contacts.email_hash)
    AND NOT EXISTS (SELECT 1 FROM store_recovery_outbox o WHERE o.email_hash=store_recovery_contacts.email_hash)
    AND NOT EXISTS (SELECT 1 FROM store_recovery_checkouts c WHERE c.email_hash=store_recovery_contacts.email_hash)
    AND NOT EXISTS (SELECT 1 FROM store_recovery_purchases p WHERE p.email_hash=store_recovery_contacts.email_hash)`;
  statements.push(db.prepare(`DELETE FROM store_recovery_contacts WHERE email_hash IN (SELECT email_hash FROM store_recovery_contacts WHERE ${orphan} AND unsubscribed_at IS NULL LIMIT 100)`).bind(cutoff));
  // Preserve only the address hash and opt-out state once an old contact is unlinked.
  statements.push(db.prepare(`UPDATE store_recovery_contacts SET email='',subscriber_id=NULL WHERE email_hash IN (SELECT email_hash FROM store_recovery_contacts WHERE ${orphan} AND unsubscribed_at IS NOT NULL LIMIT 100)`).bind(cutoff));
  statements.push(db.prepare("DELETE FROM store_recovery_rate_limits WHERE key IN (SELECT key FROM store_recovery_rate_limits WHERE window_start<? AND key<>'maintenance:retention' LIMIT 500)").bind(now - 2 * DAY));
  await db.batch(statements);
  return { cleaned: true };
}

async function rate(db, key, limit, seconds, now) {
  const window = Math.floor(now / seconds) * seconds;
  const row = await db.prepare(`INSERT INTO store_recovery_rate_limits(key,window_start,count) VALUES(?,?,1)
    ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,
    count=CASE WHEN store_recovery_rate_limits.window_start=excluded.window_start THEN store_recovery_rate_limits.count+1 ELSE 1 END
    RETURNING count`).bind(key, window).first();
  if (!row || row.count > limit) fail("Too many requests. Please try again later.", 429);
}
async function catalogFor(requestUrl, signup = false) {
  const response = await fetch(new URL(signup ? "/store-signup-catalog.json" : "/store-catalog.json", requestUrl));
  if (!response.ok) fail("Product availability could not be checked.", 503);
  return response.json();
}
function cartLines(value) {
  if (!Array.isArray(value) || value.length > 30) fail("Invalid cart.");
  const merged = new Map();
  for (const line of value) {
    if (!line || !slug(line.id) || !slug(line.build) || !Number.isSafeInteger(line.qty) || line.qty < 1 || line.qty > 99) fail("Invalid cart.");
    const key = line.id + "|" + line.build;
    const qty = (merged.get(key)?.qty || 0) + line.qty;
    if (qty > 99) fail("Invalid cart.");
    merged.set(key, { id: line.id, build: line.build, qty });
  }
  return [...merged.values()].sort((a, b) => (a.id + a.build).localeCompare(b.id + b.build));
}
export async function validateRecoveryCart(env, value, catalog, { restore = false } = {}) {
  const rows = cartLines(value), cart = [], removed = [];
  for (const line of rows) {
    const product = Object.hasOwn(catalog, line.id) ? catalog[line.id] : null;
    const variant = product && product.variants && Object.hasOwn(product.variants, line.build) ? product.variants[line.build] : null;
    let available = variant && typeof variant.price === "string" && variant.price.startsWith("price_") && !launchPending(variant) &&
      !(product.retiredBuilds || []).includes(line.build) ? (Number.isSafeInteger(variant.maxQty) ? variant.maxQty : 1) : 0;
    if (available && variant.inventorySku) {
      const [stock] = await readInventoryAvailability(env, [variant.inventorySku]);
      available = Math.min(available, stock.available);
    }
    const qty = Math.min(line.qty, available);
    if (qty < line.qty && !restore) fail("An item in this cart is no longer available.", 409);
    if (qty > 0) cart.push({ ...line, qty });
    if (qty < line.qty) removed.push({ ...line, qty: line.qty - qty });
  }
  return { cart, removed };
}
export async function resolveRecoveryAssociation(env, credentials, options = {}) {
  if (!recoveryEnabled(env) || (!credentials?.journeyId && !credentials?.journeyToken)) return null;
  const { db } = config(env, options), now = clock(options);
  if (!TOKEN.test(credentials?.journeyId || "") || !TOKEN.test(credentials?.journeyToken || "")) fail("This visit has expired. Refresh the page.", 401);
  const row = await db.prepare("SELECT * FROM store_recovery_journeys WHERE id=? AND token_hash=? AND expires_at>?")
    .bind(credentials.journeyId, await sha256Hex(credentials.journeyToken), now).first();
  if (!row) fail("This visit has expired. Refresh the page.", 401);
  if (credentials.paymentIntentId) {
    const checkout = await db.prepare("SELECT journey_id FROM store_recovery_checkouts WHERE payment_intent_id=?").bind(credentials.paymentIntentId).first();
    if (checkout && checkout.journey_id !== row.id) return null;
  }
  return { journeyId: row.id, metadata: { recovery_journey: row.id }, row };
}
async function requestKey(db, journeyId, body, payload, now) {
  if (!ID.test(body.requestId || "")) fail("A request identifier is required.");
  const hash = await sha256Hex(JSON.stringify(payload));
  await db.prepare("INSERT INTO store_recovery_requests(journey_id,request_id,action,payload_hash,created_at) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING")
    .bind(journeyId, body.requestId, body.action, hash, now).run();
  const old = await db.prepare("SELECT action,payload_hash FROM store_recovery_requests WHERE journey_id=? AND request_id=?").bind(journeyId, body.requestId).first();
  if (!old || old.action !== body.action || old.payload_hash !== hash) fail("This request identifier was already used.", 409);
  return sha256Hex(journeyId + ":" + body.requestId);
}
async function contact(db, email, now) {
  const hash = await sha256Hex(email);
  await db.prepare("INSERT INTO store_recovery_contacts(email_hash,email,created_at) VALUES(?,?,?) ON CONFLICT(email_hash) DO UPDATE SET email=excluded.email").bind(hash, email, now).run();
  return hash;
}
const eventStatement = (db, id, journey, type, now, detail) => db.prepare("INSERT INTO store_recovery_events(id,journey_id,type,created_at,detail_json) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING")
  .bind(id, journey, type, now, JSON.stringify(detail));
function outboxResult(row, local, requestId) {
  const payload = decode(row.payload_json, {});
  return { ok: true, status: local ? "queued_local" : "queued", requestId, outboxId: row.id,
    ...(local && row.kind === "cart_email" ? { preview: { subject: payload.subject, text: payload.text, restoreUrl: payload.restoreUrl } } : {}) };
}
export async function handleRecoveryRequest(env, request, options = {}) {
  const settings = { ...options, requestUrl: request.url }, { db, mode, url } = config(env, settings), now = clock(settings);
  if (request.headers.get("origin") !== url.origin) fail("Blocked.", 403);
  if (!(request.headers.get("content-type") || "").startsWith("application/json")) fail("JSON is required.", 415);
  if (Number(request.headers.get("content-length")) > 16384) fail("Request too large.", 413);
  const reader = request.body?.getReader(); let size = 0, text = "";
  if (!reader) fail("Bad request.");
  const decoder = new TextDecoder();
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 16384) { await reader.cancel(); fail("Request too large.", 413); } text += decoder.decode(part.value, { stream: true }); }
  const body = decode(text + decoder.decode(), null);
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("Bad request.");
  const ipHash = await sha256Hex(request.headers.get("CF-Connecting-IP") || "unknown");
  if (body.action === "start") {
    await cleanupRecoveryData(env, settings);
    await rate(db, "start:" + ipHash, 30, 3600, now);
    if (!slug(body.session) || (body.anon && !slug(body.anon))) fail("Invalid visit.");
    const id = random(), token = random();
    await db.prepare("INSERT INTO store_recovery_journeys(id,token_hash,anon,session,source,created_at,expires_at,last_activity_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind(id, await sha256Hex(token), body.anon || null, body.session, slug(body.source) || "direct", now, now + TTL, now).run();
    return { ok: true, journeyId: id, journeyToken: token, expiresAt: now + TTL };
  }
  if (body.action === "restore") {
    await rate(db, "restore:" + ipHash, 120, 3600, now);
    if (!TOKEN.test(body.restoreToken || "")) fail("This cart link is invalid or expired.", 404);
    const saved = await db.prepare("SELECT * FROM store_recovery_restores WHERE token_hash=? AND expires_at>?").bind(await sha256Hex(body.restoreToken), now).first();
    if (!saved) fail("This cart link is invalid or expired.", 404);
    const result = await validateRecoveryCart(env, decode(saved.cart_json, []), await catalogFor(request.url), { restore: true });
    return { ok: true, ...result, expiresAt: saved.expires_at };
  }
  if (!["event", "newsletter", "cart_email"].includes(body.action)) fail("Unknown recovery action.");
  const association = await resolveRecoveryAssociation(env, body, settings);
  if (!association) fail("This visit has expired. Refresh the page.", 401);
  const journey = association.row;
  await rate(db, "journey:" + journey.id, 300, 3600, now);
  if (body.action === "event") {
    if (!TYPES.has(body.type)) fail("Unknown store event.");
    const detail = {};
    if (body.product != null) { if (!slug(body.product)) fail("Invalid product."); detail.product = body.product; }
    if (body.build != null) { if (!slug(body.build)) fail("Invalid build."); detail.build = body.build; }
    if (body.qty != null) { if (!Number.isSafeInteger(body.qty) || body.qty < 1 || body.qty > 99) fail("Invalid quantity."); detail.qty = body.qty; }
    if (body.cart != null) detail.cart = (await validateRecoveryCart(env, body.cart, await catalogFor(request.url))).cart;
    const id = await requestKey(db, journey.id, body, { type: body.type, ...detail }, now);
    if (await db.prepare("SELECT id FROM store_recovery_events WHERE id=?").bind(id).first()) return { ok: true, requestId: body.requestId };
    if (detail.cart) detail.removed = decode(journey.cart_json, []).flatMap((line) => {
      const next = detail.cart.find((item) => item.id === line.id && item.build === line.build);
      const qty = line.qty - (next?.qty || 0);
      return qty > 0 ? [{ id: line.id, build: line.build, qty }] : [];
    });
    const statements = [eventStatement(db, id, journey.id, body.type, now, detail)];
    statements.push(db.prepare(`UPDATE store_recovery_journeys SET last_activity_at=MAX(last_activity_at,?),
      cart_json=COALESCE(?,cart_json),checkout_at=CASE WHEN ?='begin_checkout' THEN COALESCE(checkout_at,?) ELSE checkout_at END WHERE id=?
      AND (SELECT rowid FROM store_recovery_events WHERE id=?)=(SELECT MAX(rowid) FROM store_recovery_events WHERE journey_id=?)`)
      .bind(now, detail.cart ? JSON.stringify(detail.cart) : null, body.type, now, journey.id, id, journey.id));
    await db.batch(statements);
    return { ok: true, requestId: body.requestId };
  }
  const email = emailAddress(body.email);
  let cart = [], context;
  if (body.action === "newsletter") {
    context = newsletterContext(body);
  } else {
    cart = cartLines(body.cart);
    if (!cart.length) fail("Your cart is empty.");
    context = { cart, copyVersion: "requested-cart-v1", placement: "cart-drawer" };
  }
  const id = await requestKey(db, journey.id, body, { email, ...context }, now);
  const existing = await db.prepare("SELECT * FROM store_recovery_outbox WHERE id=?").bind(id).first();
  if (existing) return outboxResult(existing, mode === "local", body.requestId);
  const catalog = await catalogFor(request.url, body.action === "newsletter");
  if (body.action === "newsletter") {
    const builds = Object.hasOwn(catalog, context.product) ? catalog[context.product] : null;
    if (!Array.isArray(builds) || !builds.includes(context.build)) fail("Invalid signup context.");
  } else cart = (await validateRecoveryCart(env, cart, catalog)).cart;
  const emailHash = await sha256Hex(email);
  await rate(db, "email-request:" + ipHash, 20, 3600, now);
  await rate(db, body.action + ":" + emailHash, body.action === "newsletter" ? 3 : 5, DAY, now);
  await contact(db, email, now);
  let payload = context, restoreStatement;
  if (body.action === "cart_email") {
    const token = random();
    const restoreUrl = url.origin + "/store/" + (mode === "local" ? "?recovery-preview=1" : "") + "#restore_cart=" + token;
    payload = { ...context, subject: "Your cart at Theodore", restoreUrl,
      text: "Here are the items you picked out:\n\n" + cart.map((line) => `${catalog[line.id].title || line.id} (${catalog[line.id].variants[line.build].label || line.build}), quantity ${line.qty}`).join("\n") +
        "\n\nReturn to your cart: " + restoreUrl + "\n\nThis link expires in seven days. It does not reserve stock. Current prices, shipping and tax apply at checkout. If you have a question, reply to this email.\n\nTeddy" };
    restoreStatement = db.prepare("INSERT INTO store_recovery_restores(id,token_hash,journey_id,cart_json,created_at,expires_at) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING")
      .bind(id, await sha256Hex(token), journey.id, JSON.stringify(cart), now, now + TTL);
  }
  const statements = [
    db.prepare("INSERT INTO store_recovery_journey_contacts(journey_id,email_hash,purpose,created_at,copy_version,placement,product,build) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING")
      .bind(journey.id, emailHash, body.action, now, context.copyVersion, context.placement, context.product || null, context.build || null),
    db.prepare("INSERT INTO store_recovery_outbox(id,journey_id,email_hash,kind,created_at,mode,payload_json) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING")
      .bind(id, journey.id, emailHash, body.action, now, mode, JSON.stringify(payload)),
    eventStatement(db, id, journey.id, body.action === "newsletter" ? "newsletter_requested" : "cart_email_requested", now, context),
    db.prepare("UPDATE store_recovery_journeys SET last_activity_at=MAX(last_activity_at,?),cart_json=COALESCE(?,cart_json) WHERE id=?")
      .bind(now, body.action === "cart_email" ? JSON.stringify(cart) : null, journey.id),
  ];
  if (restoreStatement) statements.push(restoreStatement);
  await db.batch(statements);
  const queued = await db.prepare("SELECT * FROM store_recovery_outbox WHERE id=?").bind(id).first();
  if (!queued) fail("Could not save this request.", 503);
  return outboxResult(queued, mode === "local", body.requestId);
}

export async function recordRecoveryCheckout(env, data, options = {}) {
  if (!recoveryEnabled(env)) return null;
  const { db } = config(env, options), now = clock(options);
  if (!/^pi_[A-Za-z0-9_]+$/.test(data.paymentIntentId || "")) fail("Invalid payment association.");
  const existing = await db.prepare("SELECT journey_id FROM store_recovery_checkouts WHERE payment_intent_id=?").bind(data.paymentIntentId).first();
  if (existing && existing.journey_id !== data.journeyId) return null;
  const journey = await db.prepare("SELECT id FROM store_recovery_journeys WHERE id=?").bind(data.journeyId || "").first();
  if (!journey) return null;
  const cart = cartLines(data.cart || []);
  const email = optionalEmail(data.email), hash = email ? await contact(db, email, now) : null;
  const statements = [db.prepare(`INSERT INTO store_recovery_checkouts(payment_intent_id,journey_id,email_hash,cart_json,created_at,updated_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(payment_intent_id) DO UPDATE SET email_hash=COALESCE(excluded.email_hash,email_hash),cart_json=excluded.cart_json,updated_at=excluded.updated_at
    WHERE store_recovery_checkouts.journey_id=excluded.journey_id`).bind(data.paymentIntentId, journey.id, hash, JSON.stringify(cart), now, now),
    db.prepare("UPDATE store_recovery_journeys SET checkout_at=COALESCE(checkout_at,?),last_activity_at=MAX(last_activity_at,?),cart_json=? WHERE id=?").bind(now, now, JSON.stringify(cart), journey.id)];
  if (hash) statements.push(db.prepare("INSERT INTO store_recovery_journey_contacts(journey_id,email_hash,purpose,created_at,copy_version,placement) VALUES(?,?,'checkout',?,'receipt-only-v1','checkout') ON CONFLICT DO NOTHING").bind(journey.id, hash, now));
  await db.batch(statements);
  return { journeyId: journey.id };
}
// Called exclusively after the caller authenticates Stripe and completes existing capture checks.
// This helper never accepts a browser assertion that a payment succeeded.
export async function recordRecoveryPurchase(env, data, options = {}) {
  if (!recoveryEnabled(env)) return null;
  const { db } = config(env, options), now = clock(options);
  if (!/^pi_[A-Za-z0-9_]+$/.test(data.paymentIntentId || "") || !/^evt_[A-Za-z0-9_]+$/.test(data.eventId || "")) fail("Invalid payment evidence.");
  const checkout = await db.prepare("SELECT * FROM store_recovery_checkouts WHERE payment_intent_id=?").bind(data.paymentIntentId).first();
  const journey = await db.prepare("SELECT id FROM store_recovery_journeys WHERE id=?").bind(checkout?.journey_id || data.journeyId || "").first();
  const email = optionalEmail(data.email);
  const hash = email ? await contact(db, email, now) : checkout?.email_hash || null;
  const cart = cartLines(data.cart || decode(checkout?.cart_json, []));
  const purchasedAt = Number.isSafeInteger(data.eventCreated) && data.eventCreated > 0 && data.eventCreated <= now ? data.eventCreated : now;
  await db.prepare("INSERT INTO store_recovery_purchases(payment_intent_id,event_id,journey_id,email_hash,cart_json,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING")
    .bind(data.paymentIntentId, data.eventId, journey?.id || null, hash, JSON.stringify(cart), purchasedAt).run();
  return { recorded: true, journeyId: journey?.id || null };
}
const overlaps = (left, right) => left.some((a) => right.some((b) => a.id === b.id && a.build === b.build));
export async function reviewRecovery(env, options = {}) {
  const { db, mode } = config(env, options), now = clock(options);
  if (mode !== "local") fail("Not found.", 404);
  const journeys = (await db.prepare("SELECT id,anon,session,source,created_at,expires_at,last_activity_at,cart_json,checkout_at FROM store_recovery_journeys ORDER BY created_at DESC LIMIT 100").all()).results || [];
  const purchases = (await db.prepare("SELECT * FROM store_recovery_purchases").all()).results || [];
  const visits = [];
  for (const row of journeys) {
    const contacts = (await db.prepare("SELECT c.email,c.email_hash,c.unsubscribed_at,j.purpose,j.created_at,j.placement,j.product,j.build,j.copy_version FROM store_recovery_journey_contacts j JOIN store_recovery_contacts c USING(email_hash) WHERE j.journey_id=?").bind(row.id).all()).results || [];
    const cart = decode(row.cart_json, []);
    const interest = cart.length ? cart : contacts.filter((c) => c.product && c.build).map((c) => ({ id: c.product, build: c.build }));
    const paid = purchases.filter((p) => p.journey_id === row.id || (p.created_at >= row.created_at && contacts.some((c) => c.email_hash === p.email_hash) && overlaps(interest, decode(p.cart_json, []))));
    const events = (await db.prepare("SELECT type,created_at,detail_json FROM store_recovery_events WHERE journey_id=? ORDER BY created_at,rowid LIMIT 200").bind(row.id).all()).results || [];
    visits.push({ journeyId: row.id, anon: row.anon, session: row.session, source: row.source, createdAt: row.created_at, lastActivityAt: row.last_activity_at,
      cart, checkoutStartedAt: row.checkout_at, purchaseStatus: paid.length ? "purchased" : "not_observed",
      classification: paid.length ? "purchased" : now - row.last_activity_at < DAY ? "active_or_pending" :
        cart.length && events.some((e) => e.type === "add_to_cart") ? "aged_24h_no_purchase_observed" : "inactive_no_cart_intent",
      followUpEligible: false, contacts: contacts.map(({ email_hash, ...c }) => c),
      events: events.map((e) => ({ type: e.type, at: e.created_at, ...decode(e.detail_json, {}) })) });
  }
  const rows = (await db.prepare("SELECT o.*,c.email FROM store_recovery_outbox o JOIN store_recovery_contacts c USING(email_hash) ORDER BY o.created_at DESC LIMIT 100").all()).results || [];
  const outbox = rows.map((row) => { const p = decode(row.payload_json, {}); return { id: row.id, kind: row.kind, status: row.status, createdAt: row.created_at,
    to: row.email, subject: p.subject || "Newsletter signup", text: p.text || "Requested store newsletter signup.", restoreUrl: p.restoreUrl || null }; });
  return { ok: true, mode: "local", visits, outbox };
}

function publicClientIp(value) {
  if (typeof value !== "string" || value.length > 45 || !/^[0-9a-f:.]+$/i.test(value)) return null;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|255\.|::1$|::$|f[cd]|fe80)/i.test(value)) return null;
  if (value.includes(":")) return value;
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255) ? value : null;
}
async function enrollNewsletter(env, fetchFn, row, payload, clientIp) {
  const context = newsletterContext(payload);
  const headers = { authorization: "Token " + env.BUTTONDOWN_API_KEY, "content-type": "application/json" };
  const base = "https://api.buttondown.email/v1";
  let existing = await fetchFn(base + "/subscribers/" + encodeURIComponent(row.email), { headers });
  let subscriber = existing.ok ? await existing.json() : null;
  if (!existing.ok && existing.status !== 404) throw new Error("newsletter_read_failed");
  if (subscriber && !["regular", "unactivated"].includes(subscriber.type || subscriber.subscriber_type)) return { suppressed: true };
  const tags = []; let next = base + "/tags", pages = 0;
  while (next && pages < 20) {
    const pageUrl = new URL(next, base + "/");
    if (pageUrl.origin !== new URL(base).origin || !/^\/v1\/tags\/?$/.test(pageUrl.pathname)) throw new Error("newsletter_tags_failed");
    const response = await fetchFn(pageUrl.href, { headers });
    if (!response.ok) throw new Error("newsletter_tags_failed");
    const data = await response.json(); tags.push(...(data.results || (Array.isArray(data) ? data : [])));
    next = data.next || null; pages++;
  }
  if (next) throw new Error("newsletter_tags_incomplete");
  const tagName = (value) => typeof value === "string" ? value.trim().toLowerCase() : "";
  const ids = [];
  for (const name of context.tags) {
    let tag = tags.find((tag) => tagName(tag.name) === tagName(name));
    if (!tag) {
      // Buttondown requires a color when creating a tag. Reuse a concurrent
      // creation's ID instead of overwriting an existing tag's presentation.
      const response = await fetchFn(base + "/tags", { method: "POST", headers, body: JSON.stringify({ name, color: "#808080" }) });
      const created = await response.json();
      if (response.ok) tag = created;
      else if (created.code === "name_already_exists" && typeof created.metadata?.tag_id === "string") tag = { id: created.metadata.tag_id, name };
      else throw new Error("newsletter_tag_http_" + response.status);
      tags.push(tag);
    }
    if (typeof tag.id !== "string" || !tag.id) throw new Error("newsletter_tag_missing_id"); ids.push(tag.id);
  }
  if (!subscriber) {
    const create = { email_address: row.email }, ip = publicClientIp(clientIp);
    if (ip) create.ip_address = ip;
    const response = await fetchFn(base + "/subscribers", { method: "POST", headers, body: JSON.stringify(create) });
    const result = await response.json();
    if (response.ok) subscriber = result;
    else if (result.code === "email_already_exists") {
      const reread = await fetchFn(base + "/subscribers/" + encodeURIComponent(row.email), { headers });
      if (!reread.ok) throw new Error("newsletter_read_failed"); subscriber = await reread.json();
      if (!["regular", "unactivated"].includes(subscriber.type || subscriber.subscriber_type)) return { suppressed: true };
    } else throw new Error("newsletter_create_failed");
  }
  if (!subscriber.id) throw new Error("newsletter_create_failed");
  if (!["regular", "unactivated"].includes(subscriber.type || subscriber.subscriber_type)) return { suppressed: true };
  // Buttondown API versions can return names, IDs or expanded tag objects. Never
  // drop an existing association merely because it was absent from our tag list.
  const existingIds = (subscriber.tags || []).map((value) => {
    if (value && typeof value === "object") return value.id || tags.find((tag) => tagName(tag.name) === tagName(value.name))?.id || value.name;
    return tags.find((tag) => tag.id === value || tagName(tag.name) === tagName(value))?.id || value;
  }).filter((value) => typeof value === "string" && value.length > 0 && value.length <= 100);
  const metadata = { ...(subscriber.metadata || {}), store_signup_origin: context.path, store_signup_product: context.product, store_signup_copy: context.copyVersion };
  if (context.product === "avian-visitors") Object.assign(metadata, { avian_signup_origin: context.path, avian_signup_copy: context.copyVersion });
  const response = await fetchFn(base + "/subscribers/" + encodeURIComponent(subscriber.id), { method: "PATCH", headers,
    body: JSON.stringify({ tags: [...new Set([...existingIds, ...ids])], metadata }) });
  if (!response.ok) throw new Error("newsletter_update_failed");
  return { id: subscriber.id, confirmationRequired: (subscriber.type || subscriber.subscriber_type) === "unactivated" };
}
// Called only for the authenticated, explicitly requested submission. Local rows can never be sent.
// A persisted lease plus the provider idempotency key protects concurrent retries.
export async function deliverRecoveryOutbox(env, id, options = {}) {
  if (!recoveryEnabled(env)) return { skipped: true };
  const { db, mode } = config(env, options), now = clock(options);
  if (mode !== "live" || env.STORE_RECOVERY_SEND_ENABLED !== "1") return { skipped: true };
  const row = await db.prepare("SELECT o.*,c.email,c.unsubscribed_at,c.suppression_reason FROM store_recovery_outbox o JOIN store_recovery_contacts c USING(email_hash) WHERE o.id=?").bind(id).first();
  if (!row || row.mode !== "live" || !["queued", "retry"].includes(row.status)) return { skipped: true };
  if (row.first_attempt_at && now - row.first_attempt_at >= 20 * 3600) {
    await db.prepare("UPDATE store_recovery_outbox SET status='review',last_error='retry_window_expired' WHERE id=?").bind(id).run();
    return { review: true };
  }
  const globalOptOut = row.unsubscribed_at && (!row.suppression_reason || row.suppression_reason === "all_email_opt_out");
  const purposeOptOut = row.unsubscribed_at && (row.kind === "newsletter" ? row.suppression_reason === "provider_ineligible" || row.suppression_reason === "newsletter_opt_out" : row.suppression_reason === "cart_opt_out");
  if (globalOptOut || purposeOptOut) {
    await db.prepare("UPDATE store_recovery_outbox SET status='suppressed',completed_at=? WHERE id=?").bind(now, id).run(); return { suppressed: true };
  }
  const payload = decode(row.payload_json, {});
  if (row.kind === "cart_email") {
    const journey = await db.prepare("SELECT created_at FROM store_recovery_journeys WHERE id=?").bind(row.journey_id).first();
    const purchases = (await db.prepare("SELECT cart_json FROM store_recovery_purchases WHERE journey_id=? OR (email_hash=? AND created_at>=?)").bind(row.journey_id, row.email_hash, journey?.created_at || now).all()).results || [];
    if (purchases.some((p) => overlaps(payload.cart || [], decode(p.cart_json, [])))) {
      await db.prepare("UPDATE store_recovery_outbox SET status='suppressed',completed_at=? WHERE id=?").bind(now, id).run(); return { suppressed: true };
    }
    const restore = await db.prepare("SELECT expires_at FROM store_recovery_restores WHERE id=?").bind(id).first();
    if (!restore || restore.expires_at <= now) {
      await db.prepare("UPDATE store_recovery_outbox SET status='suppressed',completed_at=?,last_error='cart_link_expired' WHERE id=?").bind(now, id).run(); return { suppressed: true };
    }
  }
  const claim = await db.prepare("UPDATE store_recovery_outbox SET lease_until=?,attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,?) WHERE id=? AND status IN ('queued','retry') AND (lease_until IS NULL OR lease_until<?) RETURNING attempts")
    .bind(now + 120, now, id, now).first();
  if (!claim) return { skipped: true };
  const providerFetch = options.fetchFn || fetch;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
  const fetchFn = (url, init) => providerFetch(url, { ...init, signal: controller.signal });
  try {
    let delivered;
    if (row.kind === "newsletter") {
      if (!env.BUTTONDOWN_API_KEY) throw new Error("newsletter_not_configured");
      delivered = await enrollNewsletter(env, fetchFn, row, payload, options.clientIp);
    } else {
      if (!env.RESEND_API_KEY || !env.STORE_MAILING_ADDRESS?.trim()) throw new Error("email_not_configured");
      const response = await fetchFn("https://api.resend.com/emails", { method: "POST",
        headers: { authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json", "Idempotency-Key": "store-cart/" + id },
        body: JSON.stringify({ from: "Theodore <" + (env.STORE_FROM_EMAIL || "store@theodore.net") + ">", to: [row.email], reply_to: "support@theodore.net", subject: payload.subject, text: payload.text + "\n\nThings by Theodore LLC\n" + env.STORE_MAILING_ADDRESS.trim() + "\nYou requested this cart email. To stop cart emails, reply to support@theodore.net." }) });
      if (!response.ok) throw new Error("email_delivery_failed"); delivered = await response.json();
      if (!delivered.id) throw new Error("email_delivery_unconfirmed");
    }
    await db.prepare("UPDATE store_recovery_outbox SET status=?,completed_at=?,provider_id=?,lease_until=NULL,last_error=NULL WHERE id=? AND attempts=? AND lease_until=?")
      .bind(delivered.suppressed ? "suppressed" : delivered.confirmationRequired ? "confirmation_required" : "sent", now, delivered.id || null, id, claim.attempts, now + 120).run();
    if (row.kind === "newsletter" && delivered.id) await db.prepare("UPDATE store_recovery_contacts SET subscriber_id=? WHERE email_hash=?").bind(delivered.id, row.email_hash).run();
    if (delivered.suppressed) await db.prepare("UPDATE store_recovery_contacts SET unsubscribed_at=COALESCE(unsubscribed_at,?),suppression_reason=CASE WHEN suppression_reason IN ('cart_opt_out','all_email_opt_out') THEN 'all_email_opt_out' ELSE 'provider_ineligible' END WHERE email_hash=?").bind(now, row.email_hash).run();
    return delivered;
  } catch (error) {
    await db.prepare("UPDATE store_recovery_outbox SET status='retry',lease_until=NULL,last_error=? WHERE id=? AND attempts=? AND lease_until=?")
      .bind(/^[a-z0-9_]+$/.test(error.message || "") ? error.message : "delivery_failed", id, claim.attempts, now + 120).run();
    return { retry: true };
  } finally { clearTimeout(timer); }
}


// Success means the provider accepted the requested action, not merely that we queued it.
// Retrying the same authenticated request reuses its outbox row and provider key.
export async function submitRecoveryRequest(env, request, options = {}) {
  const result = await handleRecoveryRequest(env, request, options);
  if (!result.outboxId || result.status === "queued_local") return result;
  const settings = { ...options, requestUrl: request.url, clientIp: request.headers.get("CF-Connecting-IP") }, { db } = config(env, settings);
  if (env.STORE_RECOVERY_SEND_ENABLED !== "1") fail("Email delivery is temporarily unavailable. Please try again.", 503);
  await deliverRecoveryOutbox(env, result.outboxId, settings);
  const row = await db.prepare("SELECT kind,status FROM store_recovery_outbox WHERE id=?").bind(result.outboxId).first();
  if (row && ["sent", "confirmation_required"].includes(row.status)) return { ok: true, requestId: result.requestId,
    status: row.kind === "newsletter" ? "subscribed" : "sent", ...(row.kind === "newsletter" ? { confirmationRequired: row.status === "confirmation_required" } : {}) };
  if (row?.status === "suppressed") fail("This email request could not be completed. Please contact support@theodore.net.", 409);
  if (row?.status === "review") fail("This email request needs review. Please contact support@theodore.net.", 503);
  fail("Could not complete this email request. Please try again.", 502);
}
