// POST /api/subscribe  { email, tags? }  (Cloudflare Pages Function)
//
// Adds a subscriber to Buttondown via the API (server-side, so we can TAG them and read
// the result, unlike the keyless embed form). Used by the "assembled" waitlist so those
// signups can be segmented (a `waitlist` tag) and emailed on their own when the product
// goes live. Adding a subscriber NEVER broadcasts anything to the list.
//
// Secret (Cloudflare Pages env / .dev.vars, never in the repo):
//   BUTTONDOWN_API_KEY   same key newsletter-approve.js uses
const API = "https://api.buttondown.email/v1";

export async function onRequestPost(context) {
  const { request, env } = context;
  const reply = (o, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

  // same-origin only (defense in depth; this endpoint costs an upstream API call). Browsers
  // always send Origin on a POST fetch, so a same-host Origin is required; a missing Origin is
  // a non-browser client and only passes if Sec-Fetch-Site says same-origin.
  const origin = request.headers.get("Origin");
  let sameOrigin = false;
  if (origin) { try { sameOrigin = new URL(origin).host === new URL(request.url).host; } catch (e) { sameOrigin = false; } }
  else { sameOrigin = request.headers.get("Sec-Fetch-Site") === "same-origin"; }
  if (!sameOrigin) return reply({ error: "Blocked." }, 403);

  let body;
  try { body = await request.json(); } catch (e) { return reply({ error: "Bad request." }, 400); }
  const email = (body && typeof body.email === "string" ? body.email : "").trim().toLowerCase().slice(0, 200);
  if (email.length < 3 || email.indexOf("@") < 1 || email.lastIndexOf(".") < email.indexOf("@")) return reply({ error: "Enter a valid email." }, 400);
  const tags = Array.isArray(body && body.tags)
    ? Array.from(new Set(body.tags.filter((t) => typeof t === "string").map((t) => t.trim().toLowerCase())))
        .filter((t) => /^[a-z0-9][a-z0-9-]{0,59}$/.test(t)).slice(0, 5)   // slugs only: tags get auto-created
    : [];

  // Never tell a visitor they joined when the upstream enrollment cannot run.
  if (!env.BUTTONDOWN_API_KEY) return reply({ error: "Waitlist signup is not configured." }, 503);

  const headers = { Authorization: `Token ${env.BUTTONDOWN_API_KEY}`, "content-type": "application/json" };

  // Buttondown associates tags by ID, not name (passing a name silently no-ops), so resolve each
  // requested name to its id, creating any that don't exist yet. Returns the ids to apply plus a
  // name->id map of the whole tag catalog (used to translate the subscriber's existing tags).
  // Every store product sends its own id as a tag, so a newly sold-out product creates its tag here
  // on its first signup; no Buttondown setup is needed per product.
  async function listTags() {
    const map = {};
    let url = `${API}/tags`;
    for (let page = 0; url && page < 20; page++) {
      const listResponse = await fetch(url, { headers });
      if (!listResponse.ok) throw new Error(`tag list ${listResponse.status}`);
      const list = await listResponse.json();
      for (const t of (list && list.results) || []) if (t && t.name) map[String(t.name).toLowerCase()] = t.id;
      // follow Buttondown's pagination, but only to its own API host (the token rides along)
      const next = list && typeof list.next === "string" ? list.next : null;
      url = next && next.startsWith(`${API}/`) ? next : null;
    }
    return map;
  }
  async function resolveTags(names) {
    let map = await listTags();
    const ids = [];
    for (const n of names) {
      let id = map[n.toLowerCase()];
      if (!id) {
        // Buttondown requires `color` on tag create (a name-only POST is a 422).
        const description = n === "waitlist" ? "Signed up on a sold-out store product" : `Store interest: ${n}`;
        const createResponse = await fetch(`${API}/tags`, {
          method: "POST", headers, body: JSON.stringify({ name: n, color: "#6b7280", description }),
        });
        const created = await createResponse.json().catch(() => ({}));
        if (createResponse.ok) {
          id = created && created.id;
        } else if (created && created.code === "name_already_exists" && created.metadata && typeof created.metadata.tag_id === "string") {
          id = created.metadata.tag_id;   // a concurrent signup created it first
        } else {
          // anything else: re-read the catalog once before giving up
          console.log("subscribe tag create failed:", n, createResponse.status, JSON.stringify(created).slice(0, 200));
          map = await listTags();
          id = map[n.toLowerCase()];
        }
        if (!id) throw new Error(`tag create ${n} failed`);
        map[n.toLowerCase()] = id;
      }
      ids.push(id);
    }
    return { ids, map };
  }

  // This request is intentionally awaited. A success response means Buttondown accepted the
  // subscriber and every requested tag, rather than merely accepting background work locally.
  async function enroll() {
    let wantIds, tagMap;
    try {
      ({ ids: wantIds, map: tagMap } = tags.length ? await resolveTags(tags) : { ids: [], map: {} });
    } catch (e) {
      console.log("subscribe tag resolution failed:", e && e.message);
      return false;
    }
    if (wantIds.length !== new Set(tags.map((t) => t.toLowerCase())).size) return false;

    // Create the subscriber, or find the existing one. Pass the VISITOR's real IP so Buttondown's
    // firewall scores them, not our shared Cloudflare edge IP (which it flags as a datacenter address
    // and blocks). https://docs.buttondown.com/firewall  Only forward a PUBLIC IP from CF-Connecting-IP
    // (Cloudflare-set, unspoofable); skip loopback/private ranges (local `wrangler dev` uses 127.0.0.1,
    // which the firewall would reject) and never trust the client-spoofable X-Forwarded-For.
    const clientIp = request.headers.get("CF-Connecting-IP") || "";
    const createBody = { email_address: email };
    if (clientIp && !/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1|f[cd]|fe80)/i.test(clientIp)) createBody.ip_address = clientIp;
    let r, d, sid;
    try {
      r = await fetch(`${API}/subscribers`, { method: "POST", headers, body: JSON.stringify(createBody) });
      d = await r.json().catch(() => ({}));
    } catch (e) { console.log("subscribe unreachable:", e && e.message); return false; }
    if (r.ok) {
      sid = d && d.id;
    } else if (d && d.code === "email_already_exists") {
      sid = (d.metadata && d.metadata.subscriber_id) || null;
      if (!sid) {
        try {
          const existingResponse = await fetch(`${API}/subscribers/${encodeURIComponent(email)}`, { headers });
          if (existingResponse.ok) sid = (await existingResponse.json()).id || null;
        } catch (e) {}
      }
    } else {
      console.log("subscribe failed:", r.status, (d && d.code) || "");
      return false;
    }
    if (!sid) return false;

    // Apply the tags by id, merged with whatever the subscriber already has (existing tags read back
    // as names, so translate them through the catalog). PATCH is the call Buttondown actually honors.
    if (wantIds.length && sid) {
      try {
        const currentResponse = await fetch(`${API}/subscribers/${encodeURIComponent(sid)}`, { headers });
        if (!currentResponse.ok) return false;
        const cur = await currentResponse.json();
        const curIds = (Array.isArray(cur.tags) ? cur.tags : []).map((n) => tagMap[String(n).toLowerCase()]).filter(Boolean);
        const merged = Array.from(new Set(curIds.concat(wantIds)));
        const patchResponse = await fetch(`${API}/subscribers/${encodeURIComponent(sid)}`, { method: "PATCH", headers, body: JSON.stringify({ tags: merged }) });
        if (!patchResponse.ok) return false;
      } catch (e) { console.log("tag apply error:", e && e.message); return false; }
    }
    return true;
  }

  return await enroll()
    ? reply({ ok: true })
    : reply({ error: "Could not join the waitlist. Please try again." }, 502);
}
