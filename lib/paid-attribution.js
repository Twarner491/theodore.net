export const AD_EXPERIMENT = "av-meta-nov26-v1";
export const AD_WINDOW = 7 * 86400;
const RETENTION = 90 * 86400;
const ARMS = { "av3-meta-reel-a": "reel-a", "av3-meta-species": "species", "av3-meta-photo": "photo" };
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const TOKEN = /^[A-Za-z0-9_.-]{1,100}$/;
const clock = (options = {}) => options.now ?? Math.floor(Date.now() / 1000);
const parse = (text) => { try { return JSON.parse(text); } catch (_) { return null; } };

function touch(value, now, maxAge) {
  if (!value || !ID.test(value.id || "") || ARMS[value.tag] !== value.arm ||
      !Number.isSafeInteger(value.at) || value.at > now + 60 || value.at < now - maxAge ||
      typeof value.path !== "string" || !/^\/store\/(?:[a-z0-9-]+\/)?$/.test(value.path)) return null;
  const result = { id: value.id, arm: value.arm, tag: value.tag, at: value.at, path: value.path };
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "cart_origin"])
    if (typeof value[key] === "string" && TOKEN.test(value[key])) result[key] = value[key];
  for (const key of ["ad_id", "adset_id", "campaign_id"])
    if (typeof value[key] === "string" && /^\d{1,32}$/.test(value[key])) result[key] = value[key];
  return result;
}
export function normalizePaidAttribution(value, options = {}) {
  const now = clock(options);
  if (!value || value.v !== 1 || value.experiment !== AD_EXPERIMENT) return null;
  const first = touch(value.first, now, RETENTION), last = touch(value.last, now, AD_WINDOW);
  if (!first || !last || first.at > last.at) return null;
  return { v: 1, experiment: AD_EXPERIMENT, first, last, crossover: value.crossover === true || first.arm !== last.arm };
}
export function paidAttributionEnabled(env) { return env?.PAID_ATTRIBUTION_ENABLED === "1"; }
export function advertisingOptOut(request) {
  return request.headers.get("sec-gpc") === "1" || request.headers.get("dnt") === "1";
}
export function attributionDatabase(env) {
  const db = env?.STORE_INVENTORY;
  if (!db || typeof db.prepare !== "function") throw new Error("Attribution storage unavailable");
  return typeof db.withSession === "function" ? db.withSession("first-primary") : db;
}
export async function recordPaidArrival(env, value, options = {}) {
  if (!paidAttributionEnabled(env)) return { recorded: false };
  const now = clock(options), paid = normalizePaidAttribution(value?.paidAttribution, { now });
  if (!paid || !ID.test(value?.anon || "") || !ID.test(value?.session || "")) return { recorded: false };
  const db = attributionDatabase(env), last = paid.last;
  // The receipt time, never a client clock or PaymentIntent creation time, enrolls a visitor.
  await db.prepare(`INSERT OR IGNORE INTO paid_ad_arrivals
    (anon,touch_id,experiment,arm,tag,received_at,client_at,session,path,detail_json)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(value.anon, last.id, AD_EXPERIMENT, last.arm, last.tag,
      now, last.at, value.session, last.path, JSON.stringify(last)).run();
  await db.prepare(`DELETE FROM paid_ad_arrivals WHERE rowid IN
    (SELECT rowid FROM paid_ad_arrivals WHERE received_at<? LIMIT 100)`).bind(now - RETENTION).run();
  return { recorded: true };
}
function compactTouch(value) {
  return { id: value.id, arm: value.arm, tag: value.tag, at: value.at, path: value.path };
}
export function applyPaidMetadata(form, input, prior = {}, options = {}) {
  const paid = normalizePaidAttribution(input, options);
  if (!paid) return;
  const now = clock(options), oldFirst = touch(parse(prior.ad_first), now, RETENTION);
  const first = prior.ad_experiment === AD_EXPERIMENT && oldFirst ? oldFirst : paid.first;
  const oldLast = touch(parse(prior.ad_last), now, AD_WINDOW);
  const last = oldLast && oldLast.at > paid.last.at ? oldLast : paid.last;
  form.set("metadata[ad_experiment]", AD_EXPERIMENT);
  form.set("metadata[ad_first]", JSON.stringify(compactTouch(first)));
  form.set("metadata[ad_last]", JSON.stringify(compactTouch(last)));
  form.set("metadata[ad_crossover]", prior.ad_crossover === "1" || paid.crossover || first.arm !== last.arm ? "1" : "0");
  // The full validated UTM/ad identifiers live in the private arrival ledger; Stripe fields stay bounded.
}

export function validMetaIdentifier(text, click, now) {
  if (typeof text !== "string" || text.length > 500) return false;
  const match = /^fb\.[0-9]+\.(\d{13})\.([A-Za-z0-9_.-]+)$/.exec(text);
  return !!match && Number(match[1]) <= (now + 60) * 1000 &&
    Number(match[1]) >= (now - AD_WINDOW) * 1000 && (click || /^\d+$/.test(match[2]));
}
function consentTimeMs(value) {
  if (!Number.isSafeInteger(value?.at)) return null;
  const milliseconds = value.atMs === undefined ? value.at * 1000 : value.atMs;
  return Number.isSafeInteger(milliseconds) && Math.floor(milliseconds / 1000) === value.at ? milliseconds : null;
}
export function applyMetaTrackingMetadata(form, value, request, options = {}) {
  if (value === undefined && !advertisingOptOut(request)) return;
  const clear = () => { for (const key of ["meta_consent", "meta_consent_at", "meta_consent_at_ms", "meta_fbc", "meta_fbp", "meta_ua"])
    form.set("metadata[" + key + "]", ""); };
  clear();
  const now = clock(options), atMs = consentTimeMs(value);
  if (advertisingOptOut(request) || value?.consent !== true || value.version !== "meta-v1" ||
      atMs === null || value.at > now + 60 || value.at < now - RETENTION) return;
  const fbc = validMetaIdentifier(value.fbc, true, now) ? value.fbc : "";
  const fbp = validMetaIdentifier(value.fbp, false, now) ? value.fbp : "";
  const ua = (request.headers.get("user-agent") || "").replace(/[\r\n\x00-\x1f]/g, "").slice(0, 500);
  if ((!fbc && !fbp) || !ua) return;
  form.set("metadata[meta_consent]", "meta-v1");
  form.set("metadata[meta_consent_at]", String(value.at));
  form.set("metadata[meta_consent_at_ms]", String(atMs));
  if (fbc) form.set("metadata[meta_fbc]", fbc);
  if (fbp) form.set("metadata[meta_fbp]", fbp);
  form.set("metadata[meta_ua]", ua);
}

export async function recordMetaConsent(env, input, request, options = {}) {
  if (env?.META_CAPI_ENABLED !== "1") return { recorded: false };
  const now = clock(options), atMs = consentTimeMs(input), optOut = advertisingOptOut(request);
  if (!ID.test(input?.anon || "") || typeof input.consent !== "boolean" || input.version !== "meta-v1" ||
      atMs === null || input.at > now + 60 || input.at < now - RETENTION) return { recorded: false };
  const db = attributionDatabase(env), allowed = input.consent && !optOut ? 1 : 0;
  await db.prepare(`INSERT INTO meta_ad_consent(anon,allowed,choice_at,choice_at_ms,received_at,revoked_at,revoked_at_ms)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(anon) DO UPDATE SET allowed=excluded.allowed,
    choice_at=MAX(meta_ad_consent.choice_at,excluded.choice_at),
    choice_at_ms=MAX(meta_ad_consent.choice_at_ms,excluded.choice_at_ms),received_at=excluded.received_at,
    revoked_at=CASE WHEN excluded.allowed=0 THEN MAX(COALESCE(meta_ad_consent.revoked_at,0),meta_ad_consent.choice_at,excluded.choice_at)
      ELSE meta_ad_consent.revoked_at END,
    revoked_at_ms=CASE WHEN excluded.allowed=0 THEN MAX(COALESCE(meta_ad_consent.revoked_at_ms,0),meta_ad_consent.choice_at_ms,excluded.choice_at_ms)
      ELSE meta_ad_consent.revoked_at_ms END
    WHERE ?=1 OR excluded.choice_at_ms>meta_ad_consent.choice_at_ms OR
      (excluded.choice_at_ms=meta_ad_consent.choice_at_ms AND excluded.allowed<=meta_ad_consent.allowed)`)
    .bind(input.anon, allowed, input.at, atMs, now, allowed ? null : input.at, allowed ? null : atMs, optOut ? 1 : 0).run();
  const current = await db.prepare("SELECT allowed,revoked_at_ms FROM meta_ad_consent WHERE anon=?").bind(input.anon).first();
  if (!current.allowed) {
    await db.prepare(`UPDATE meta_purchase_outbox SET status='suppressed',payload_json='',last_error='consent_withdrawn'
      WHERE anon=? AND status IN ('queued','preview')`).bind(input.anon).run();
  }
  await db.prepare(`DELETE FROM meta_ad_consent WHERE anon IN
    (SELECT anon FROM meta_ad_consent WHERE received_at<? LIMIT 100)`).bind(now - RETENTION).run();
  return { recorded: true, allowed: !!current.allowed };
}
