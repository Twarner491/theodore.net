import { attributionDatabase, advertisingOptOut, validMetaIdentifier, validMetaConsentVersion, AD_WINDOW } from "./paid-attribution.js";

const clock = (options = {}) => options.now ?? Math.floor(Date.now() / 1000);
const RETENTION = 90 * 86400;
const EXPECTED_EVENT = /^evt_[A-Za-z0-9_]+$/;
export function metaMode(env) {
  if (env?.META_CAPI_ENABLED !== "1") return "disabled";
  if (env.META_CAPI_MODE === "preview") return "preview";
  if (env.META_CAPI_MODE === "live" && /^\d{5,30}$/.test(env.META_DATASET_ID || "") &&
      typeof env.META_CAPI_ACCESS_TOKEN === "string" && env.META_CAPI_ACCESS_TOKEN) return "live";
  return "disabled";
}
export function metaMeasurementAvailable(env, request) {
  if (advertisingOptOut(request)) return false;
  const mode = metaMode(env), url = new URL(request.url);
  return mode === "preview" ? ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    : mode === "live" && /^(?:sk|rk)_live_/.test(env.STRIPE_SECRET_KEY || "") &&
      url.protocol === "https:" && url.hostname === "theodore.net";
}

// Called only after the signed webhook passes the existing catalog/address/capture gates.
export function metaPurchasePayload(event, pi, manifest, options = {}) {
  const now = clock(options), m = pi?.metadata;
  if (event?.type !== "payment_intent.succeeded" || !EXPECTED_EVENT.test(event.id || "") ||
      !/^pi_[A-Za-z0-9_]+$/.test(pi?.id || "") || pi.object !== "payment_intent" || pi.status !== "succeeded" ||
      typeof event.livemode !== "boolean" || event.livemode !== pi.livemode ||
      !Number.isSafeInteger(event.created) || event.created > now || event.created <= now - AD_WINDOW ||
      !Number.isSafeInteger(pi.amount) || pi.amount <= 0 || pi.amount_received !== pi.amount || pi.currency !== "usd" ||
      !manifest?.lines?.length || !validMetaConsentVersion(m?.meta_consent) || !m.meta_ua ||
      (!m.meta_fbc && !m.meta_fbp)) return null;
  const consentAt = Number(m.meta_consent_at);
  const consentAtMs = Number(m.meta_consent_at_ms || consentAt * 1000);
  if (!Number.isSafeInteger(consentAt) || !Number.isSafeInteger(consentAtMs) || Math.floor(consentAtMs / 1000) !== consentAt ||
      consentAt > event.created || consentAt < event.created - RETENTION) return null;
  // A finalized draft can settle later without another browser refresh.
  const fbc = validMetaIdentifier(m.meta_fbc, true, event.created) ? m.meta_fbc : "";
  const fbp = validMetaIdentifier(m.meta_fbp, false, event.created) ? m.meta_fbp : "";
  if (!fbc && !fbp) return null;
  const contents = manifest.lines.map(([id, build, quantity]) => ({
    id: id === "avian-visitors" && build.startsWith("assembled") ? "avian-visitors" : id + "-" + build,
    quantity,
  }));
  const user_data = { client_user_agent: m.meta_ua };
  if (fbc) user_data.fbc = fbc;
  if (fbp) user_data.fbp = fbp;
  return {
    event_name: "Purchase", event_time: event.created, event_id: "Purchase:" + pi.id,
    action_source: "website", event_source_url: "https://theodore.net/store/checkout/", user_data,
    custom_data: { currency: "USD", value: pi.amount_received / 100, content_type: "product",
      content_ids: contents.map((line) => line.id), contents,
      num_items: contents.reduce((total, line) => total + line.quantity, 0),
      order_id: pi.id,
      contains_assembled_frame: contents.some((line) => line.id === "avian-visitors") ? "1" : "0" },
  };
}
export async function queueMetaPurchase(env, event, pi, manifest, options = {}) {
  const mode = metaMode(env);
  if (mode === "disabled") return { queued: false, reason: "disabled" };
  const expectedLive = mode === "live";
  const stripeMode = /^(?:sk|rk)_live_/.test(env.STRIPE_SECRET_KEY || "") ? true
    : /^(?:sk|rk)_test_/.test(env.STRIPE_SECRET_KEY || "") ? false : null;
  if (stripeMode !== expectedLive || event?.livemode !== expectedLive || pi?.livemode !== expectedLive)
    return { queued: false, reason: "mode_mismatch" };
  if (mode === "preview") {
    let url; try { url = new URL(options.requestUrl); } catch (_) { return { queued: false, reason: "origin" }; }
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return { queued: false, reason: "origin" };
  } else if (new URL(options.requestUrl).origin !== "https://theodore.net") {
    return { queued: false, reason: "origin" };
  }
  const payload = metaPurchasePayload(event, pi, manifest, options);
  if (!payload) return { queued: false, reason: "ineligible" };
  const now = clock(options), db = attributionDatabase(env);
  const anon = pi.metadata.anon, consentAt = Number(pi.metadata.meta_consent_at);
  const consentAtMs = Number(pi.metadata.meta_consent_at_ms || consentAt * 1000);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(anon || "")) return { queued: false, reason: "missing_consent_identity" };
  if (!await consentAllows(db, anon, consentAtMs)) return { queued: false, reason: "consent_withdrawn" };
  await db.prepare(`INSERT OR IGNORE INTO meta_purchase_outbox
    (payment_intent_id,event_id,stripe_event_id,event_time,created_at,anon,consent_at,consent_at_ms,mode,payload_json,status,next_attempt_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(pi.id, payload.event_id, event.id, payload.event_time, now, anon, consentAt, consentAtMs, mode,
      JSON.stringify(payload), mode === "preview" ? "preview" : "queued", now).run();
  return { queued: true, eventId: payload.event_id, mode };
}
async function consentAllows(db, anon, at) {
  const choice = await db.prepare("SELECT allowed,revoked_at_ms FROM meta_ad_consent WHERE anon=?").bind(anon).first();
  // The explicit, server-stamped PI opt-in is sufficient unless a later withdrawal exists.
  return !choice || choice.allowed === 1 && (choice.revoked_at_ms === null || at > choice.revoked_at_ms);
}

export async function dispatchMetaPurchases(env, options = {}) {
  if (metaMode(env) !== "live") return { sent: 0, failed: 0, expired: 0, disabled: true };
  const db = attributionDatabase(env), now = clock(options), summary = { sent: 0, failed: 0, expired: 0 };
  await db.prepare(`DELETE FROM meta_purchase_outbox WHERE payment_intent_id IN
    (SELECT payment_intent_id FROM meta_purchase_outbox WHERE created_at<? LIMIT 100)`).bind(now - RETENTION).run();
  const expired = await db.prepare(`UPDATE meta_purchase_outbox SET status='expired',payload_json='',lease_token=NULL,lease_until=NULL,
    last_error='event_too_old' WHERE mode='live' AND status IN ('queued','sending') AND event_time<=?`).bind(now - AD_WINDOW).run();
  summary.expired = expired.meta?.changes || 0;
  const due = await db.prepare(`SELECT payment_intent_id FROM meta_purchase_outbox WHERE mode='live' AND
    ((status='queued' AND next_attempt_at<=?) OR (status='sending' AND lease_until<=?))
    ORDER BY event_time LIMIT 25`).bind(now, now).all();
  for (const item of due.results || []) {
    const token = crypto.randomUUID();
    const row = await db.prepare(`UPDATE meta_purchase_outbox SET status='sending',lease_token=?,lease_until=?,attempts=attempts+1
      WHERE payment_intent_id=? AND ((status='queued' AND next_attempt_at<=?) OR (status='sending' AND lease_until<=?))
      RETURNING *`).bind(token, now + 120, item.payment_intent_id, now, now).first();
    if (!row) continue;
    if (!await consentAllows(db, row.anon, row.consent_at_ms)) {
      await db.prepare(`UPDATE meta_purchase_outbox SET status='suppressed',payload_json='',lease_token=NULL,
        lease_until=NULL,last_error='consent_withdrawn' WHERE payment_intent_id=? AND lease_token=?`)
        .bind(row.payment_intent_id, token).run();
      continue;
    }
    let accepted = false, error = "transport";
    try {
      const response = await (options.fetch || fetch)("https://graph.facebook.com/v27.0/" + env.META_DATASET_ID + "/events", {
        method: "POST", headers: { authorization: "Bearer " + env.META_CAPI_ACCESS_TOKEN, "content-type": "application/json" },
        body: JSON.stringify({ data: [JSON.parse(row.payload_json)] }), signal: AbortSignal.timeout(10000),
      });
      const result = await response.json();
      accepted = response.ok && result.events_received === 1;
      error = response.ok ? "invalid_acknowledgement" : "http_" + response.status;
    } catch (_) { /* A lost acknowledgement retries the same event ID. */ }
    if (accepted) {
      await db.prepare(`UPDATE meta_purchase_outbox SET status='sent',sent_at=?,payload_json='',lease_token=NULL,
        lease_until=NULL,last_error=NULL WHERE payment_intent_id=? AND lease_token=?`).bind(now, row.payment_intent_id, token).run();
      summary.sent++;
    } else {
      await db.prepare(`UPDATE meta_purchase_outbox SET status='queued',next_attempt_at=?,lease_token=NULL,
        lease_until=NULL,last_error=? WHERE payment_intent_id=? AND lease_token=?`).bind(
          now + Math.min(3600, 60 * 2 ** Math.min(row.attempts - 1, 6)), error, row.payment_intent_id, token).run();
      summary.failed++;
    }
  }
  return summary;
}
