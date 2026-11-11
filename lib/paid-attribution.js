export const AD_EXPERIMENT = "av-meta-nov26-v1";
export const AD_WINDOW = 7 * 86400;
const RETENTION = 90 * 86400;
const ARMS = { "av3-meta-reel-a": "reel-a", "av3-meta-species": "species", "av3-meta-photo": "photo" };
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const TOKEN = /^[A-Za-z0-9_.-]{1,100}$/;
export const validMetaConsentVersion = (version) => ["meta-v1", "meta-v2", "meta-us-v1", "meta-v3"].includes(version);
export const ledgerMetaVersion = (version) => version === "meta-us-v1" || version === "meta-v3";
export const validMetaDecisionId = (id) => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
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
export function metaSignalBits(request, supplied) {
  return (request.headers.get("sec-gpc") === "1" || supplied?.gpc === true ? 1 : 0) |
    (request.headers.get("dnt") === "1" || supplied?.dnt === true ? 2 : 0);
}
export function metaSignals(bits) { return { gpc: !!(bits & 1), dnt: !!(bits & 2) }; }
export function advertisingOptOut(request) { return metaSignalBits(request) !== 0; }
export function metaRegionalDefaultAllowed(request, supplied) {
  return request.cf?.country === "US" && metaSignalBits(request, supplied) === 0;
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
  const clear = () => { for (const key of ["meta_consent", "meta_consent_at", "meta_consent_at_ms", "meta_fbc", "meta_fbp", "meta_ua",
    "meta_decision_id", "meta_decision_at", "meta_signal_bits", "meta_override_bits"])
    form.set("metadata[" + key + "]", ""); };
  clear();
  const now = clock(options), atMs = consentTimeMs(value);
  const decision = options.decision, bits = metaSignalBits(request, value?.signals);
  const covered = value?.version === "meta-v3" && decision?.allowed === 1 &&
    decision.policy_version === "meta-v3" && decision.decision_id === value.decisionId && (bits & ~decision.override_bits) === 0;
  if (bits && !covered || value?.consent !== true || !validMetaConsentVersion(value.version) ||
      atMs === null || value.at > now + 60 || value.at < now - RETENTION || decision === false) return;
  if (ledgerMetaVersion(value.version) && (!decision || decision.allowed !== 1 ||
      decision.policy_version !== value.version || decision.choice_at_ms !== atMs ||
      decision.decision_id !== value.decisionId || !validMetaDecisionId(value.decisionId) ||
      value.version === "meta-us-v1" && !metaRegionalDefaultAllowed(request, value.signals))) return;
  const fbc = validMetaIdentifier(value.fbc, true, now) ? value.fbc : "";
  const fbp = validMetaIdentifier(value.fbp, false, now) ? value.fbp : "";
  const ua = (request.headers.get("user-agent") || "").replace(/[\r\n\x00-\x1f]/g, "").slice(0, 500);
  if ((!fbc && !fbp) || !ua) return;
  form.set("metadata[meta_consent]", value.version);
  form.set("metadata[meta_consent_at]", String(value.at));
  form.set("metadata[meta_consent_at_ms]", String(atMs));
  if (fbc) form.set("metadata[meta_fbc]", fbc);
  if (fbp) form.set("metadata[meta_fbp]", fbp);
  form.set("metadata[meta_ua]", ua);
  if (ledgerMetaVersion(value.version)) {
    form.set("metadata[meta_decision_id]", decision.decision_id);
    form.set("metadata[meta_decision_at]", String(decision.decided_at));
    form.set("metadata[meta_signal_bits]", String(bits));
    form.set("metadata[meta_override_bits]", String(decision.override_bits));
  }
}

const currentChoice = (db, anon) => db.prepare("SELECT * FROM meta_ad_consent WHERE anon=?").bind(anon).first();
const signalCovered = (row, bits) => !bits || row?.allowed === 1 && row.policy_version === "meta-v3" &&
  (bits & ~row.override_bits) === 0;
function acknowledgment(row) {
  return { recorded: true, allowed: row.allowed === 1, version: row.policy_version || "meta-v1",
    at: row.choice_at, atMs: row.choice_at_ms, decisionId: row.decision_id || null,
    decisionAt: row.decided_at || row.received_at, overrideSignals: metaSignals(row.override_bits) };
}
async function suppressWithdrawn(db, anon) {
  await db.prepare(`UPDATE meta_purchase_outbox SET status='suppressed',payload_json='',last_error='consent_withdrawn'
    WHERE anon=? AND status IN ('queued','preview')`).bind(anon).run();
}
function decisionStatement(db, input, now, bits, overrideBits = 0, force = false, guard = null, observedSignalOnly = false) {
  const atMs = consentTimeMs(input), allowed = input.consent ? 1 : 0;
  let sql = `INSERT INTO meta_ad_consent
    (anon,allowed,choice_at,choice_at_ms,received_at,revoked_at,revoked_at_ms,policy_version,decision_id,decided_at,signal_bits,override_bits)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?`;
  const values = [input.anon, allowed, input.at, atMs, now, allowed ? null : input.at, allowed ? null : atMs,
    input.version, input.decisionId || crypto.randomUUID(), now, bits, overrideBits];
  if (guard) {
    sql += ` WHERE EXISTS (SELECT 1 FROM meta_ad_override_challenges c WHERE c.anon=? AND c.nonce_hash=?
      AND c.consumed_at IS NULL AND c.expires_at>? AND
      COALESCE(c.base_choice_ms,-1)=COALESCE((SELECT choice_at_ms FROM meta_ad_consent WHERE anon=c.anon),-1) AND
      COALESCE(c.base_decision_id,'')=COALESCE((SELECT decision_id FROM meta_ad_consent WHERE anon=c.anon),''))`;
    values.push(input.anon, guard.hash, now);
  }
  sql += ` ON CONFLICT(anon) DO UPDATE SET allowed=excluded.allowed,
    choice_at=MAX(meta_ad_consent.choice_at,excluded.choice_at),
    choice_at_ms=MAX(meta_ad_consent.choice_at_ms,excluded.choice_at_ms),received_at=excluded.received_at,
    revoked_at=CASE WHEN excluded.allowed=0 THEN MAX(COALESCE(meta_ad_consent.revoked_at,0),meta_ad_consent.choice_at,excluded.choice_at)
      ELSE meta_ad_consent.revoked_at END,
    revoked_at_ms=CASE WHEN excluded.allowed=0 THEN MAX(COALESCE(meta_ad_consent.revoked_at_ms,0),meta_ad_consent.choice_at_ms,excluded.choice_at_ms)
      ELSE meta_ad_consent.revoked_at_ms END,
    policy_version=excluded.policy_version,decision_id=excluded.decision_id,decided_at=excluded.decided_at,
    signal_bits=excluded.signal_bits,override_bits=excluded.override_bits
    WHERE ((?=1 AND NOT (meta_ad_consent.allowed=1 AND COALESCE(meta_ad_consent.policy_version,'')='meta-v3' AND (? & ~meta_ad_consent.override_bits)=0)) OR excluded.choice_at_ms>meta_ad_consent.choice_at_ms OR
      (excluded.choice_at_ms=meta_ad_consent.choice_at_ms AND excluded.allowed<=meta_ad_consent.allowed))
      AND (?=0 OR (meta_ad_consent.allowed=1 AND meta_ad_consent.policy_version='meta-us-v1'))
      AND (?=0 OR (meta_ad_consent.allowed=1 AND
        (COALESCE(meta_ad_consent.policy_version,'')!='meta-v3' OR (? & ~meta_ad_consent.override_bits)!=0)))`;
  values.push(force ? 1 : 0, bits, allowed && input.version === "meta-us-v1" ? 1 : 0, observedSignalOnly ? 1 : 0, bits);
  return db.prepare(sql).bind(...values);
}
async function observeSignal(db, anon, request, supplied, now) {
  const row = await currentChoice(db, anon), bits = metaSignalBits(request, supplied);
  if (row?.allowed === 1 && !signalCovered(row, bits)) {
    const atMs = Math.max(now * 1000, row.choice_at_ms);
    await decisionStatement(db, { anon, consent: false, version: row.policy_version || "meta-v1",
      at: Math.floor(atMs / 1000), atMs }, now, bits, 0, true, null, true).run();
    const latest = await currentChoice(db, anon);
    if (latest?.allowed === 0) await suppressWithdrawn(db, anon);
    return latest;
  }
  return row;
}
async function nonceHash(value) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, "0")).join("");
}
export async function resolveMetaTrackingDecision(env, value, anon, request, options = {}) {
  if (!value && !advertisingOptOut(request)) return null;
  if (!ID.test(anon || "")) return ledgerMetaVersion(value?.version) ? false : null;
  const db = attributionDatabase(env), now = clock(options);
  const row = await observeSignal(db, anon, request, value?.signals, now);
  if (value?.consent === false || row?.allowed === 0) return false;
  if (!ledgerMetaVersion(value?.version)) return row?.policy_version && row.policy_version !== value?.version ? false : row || null;
  if (!row || row.allowed !== 1 || row.policy_version !== value.version || row.decision_id !== value.decisionId ||
      row.choice_at_ms !== consentTimeMs(value) || row.choice_at < now - RETENTION ||
      !signalCovered(row, metaSignalBits(request, value.signals)) ||
      value.version === "meta-us-v1" && !metaRegionalDefaultAllowed(request, value.signals)) return false;
  return row;
}

export async function recordMetaConsent(env, input, request, options = {}) {
  if (env?.META_CAPI_ENABLED !== "1" || !ID.test(input?.anon || "")) return { recorded: false };
  const now = clock(options), db = attributionDatabase(env), bits = metaSignalBits(request, input.signals);
  let current = await observeSignal(db, input.anon, request, input.signals, now);
  if (input.action === "prepare-override") {
    if (!bits) return { prepared: false, reason: "no_signal" };
    const challenge = crypto.randomUUID(), hash = await nonceHash(challenge), expiresAt = now + 300;
    await db.prepare(`INSERT INTO meta_ad_override_challenges
      (anon,nonce_hash,signal_bits,created_at,expires_at,base_choice_ms,base_decision_id)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(anon) DO UPDATE SET nonce_hash=excluded.nonce_hash,
      signal_bits=excluded.signal_bits,created_at=excluded.created_at,expires_at=excluded.expires_at,
      base_choice_ms=excluded.base_choice_ms,base_decision_id=excluded.base_decision_id,consumed_at=NULL,decision_id=NULL`)
      .bind(input.anon, hash, bits, now, expiresAt, current?.choice_at_ms ?? null, current?.decision_id ?? null).run();
    return { prepared: true, challenge, expiresAt, signals: metaSignals(bits) };
  }
  const atMs = consentTimeMs(input);
  if (typeof input.consent !== "boolean" || !validMetaConsentVersion(input.version) || atMs === null ||
      input.at > now + 60 || input.at < 0 || input.consent && input.at < now - RETENTION) return { recorded: false };
  if (input.action === "confirm-override") {
    if (input.version !== "meta-v3" || !input.consent || !validMetaDecisionId(input.challenge)) return { recorded: false, reason: "invalid_confirmation" };
    const hash = await nonceHash(input.challenge);
    const challenge = await db.prepare("SELECT * FROM meta_ad_override_challenges WHERE anon=? AND nonce_hash=?")
      .bind(input.anon, hash).first();
    if (!challenge) return { recorded: false, reason: "invalid_challenge" };
    if (challenge.consumed_at !== null) return current?.decision_id === challenge.decision_id &&
      current.policy_version === "meta-v3" && current.allowed === 1 && signalCovered(current, bits)
      ? acknowledgment(current) : { recorded: false, reason: "superseded" };
    if (challenge.expires_at <= now || challenge.signal_bits !== bits ||
        challenge.base_choice_ms !== (current?.choice_at_ms ?? null) ||
        challenge.base_decision_id !== (current?.decision_id ?? null) ||
        current && atMs <= current.choice_at_ms) return { recorded: false, reason: "expired_or_changed" };
    const decisionId = crypto.randomUUID();
    await db.batch([
      decisionStatement(db, { ...input, decisionId }, now, bits, bits, false, { hash }),
      db.prepare(`UPDATE meta_ad_override_challenges SET consumed_at=?,decision_id=? WHERE anon=? AND nonce_hash=?
        AND consumed_at IS NULL AND EXISTS (SELECT 1 FROM meta_ad_consent WHERE anon=? AND decision_id=? AND allowed=1)`)
        .bind(now, decisionId, input.anon, hash, input.anon, decisionId),
    ]);
    current = await currentChoice(db, input.anon);
    return current?.decision_id === decisionId ? acknowledgment(current) : { recorded: false, reason: "superseded" };
  }
  if (input.action !== undefined) return { recorded: false };
  if (input.consent && input.version === "meta-v3") {
    if (current?.allowed === 0) return acknowledgment(current);
    return current?.allowed === 1 && current.policy_version === input.version &&
      current.decision_id === input.decisionId && current.choice_at_ms === atMs && signalCovered(current, bits)
      ? acknowledgment(current) : { recorded: false, reason: "confirmation_required" };
  }
  if (input.consent && input.version === "meta-us-v1") {
    if (!metaRegionalDefaultAllowed(request, input.signals)) return { recorded: false, reason: "explicit_choice_required" };
    if (current?.allowed === 0) return acknowledgment(current);
    if (current && current.policy_version !== "meta-us-v1") return { recorded: false, reason: "existing_choice" };
    if (current && current.choice_at >= now - RETENTION) return acknowledgment(current);
  }
  if (input.consent && bits && current?.allowed === 1 && signalCovered(current, bits))
    return { recorded: false, reason: "existing_choice" };
  const allowed = input.consent && !bits;
  await decisionStatement(db, { ...input, consent: allowed, decisionId: undefined }, now, bits, 0, !!bits).run();
  current = await currentChoice(db, input.anon);
  if (!current.allowed) await suppressWithdrawn(db, input.anon);
  // A minimal refusal record is retained so an expired local preference cannot become a US default.
  await db.prepare(`DELETE FROM meta_ad_consent WHERE anon IN
    (SELECT anon FROM meta_ad_consent WHERE allowed=1 AND received_at<? LIMIT 100)`).bind(now - RETENTION).run();
  await db.prepare(`DELETE FROM meta_ad_override_challenges WHERE (expires_at<? AND consumed_at IS NULL)
    OR consumed_at<?`).bind(now, now - RETENTION).run();
  return acknowledgment(current);
}
