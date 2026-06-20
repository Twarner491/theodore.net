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

export async function onRequestPost({ request, env }) {
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
    ? body.tags.filter((t) => typeof t === "string").map((t) => t.trim().slice(0, 60)).filter(Boolean).slice(0, 5)
    : [];

  // No key configured (e.g. local without it): don't hard-fail the UX; report a no-op success.
  if (!env.BUTTONDOWN_API_KEY) { console.log("subscribe skipped (no BUTTONDOWN_API_KEY):", email, tags.join(",")); return reply({ ok: true, skipped: true }); }

  const headers = { Authorization: `Token ${env.BUTTONDOWN_API_KEY}`, "content-type": "application/json" };

  // Buttondown associates tags by ID, not name (passing a name silently no-ops), so resolve each
  // requested name to its id, creating any that don't exist yet. Returns the ids to apply plus a
  // name->id map of the whole tag catalog (used to translate the subscriber's existing tags).
  async function resolveTags(names) {
    const map = {};
    try {
      const list = await fetch(`${API}/tags`, { headers }).then((x) => x.json());
      for (const t of (list && list.results) || []) if (t && t.name) map[String(t.name).toLowerCase()] = t.id;
    } catch (e) {}
    const ids = [];
    for (const n of names) {
      let id = map[n.toLowerCase()];
      if (!id) {
        try { const m = await fetch(`${API}/tags`, { method: "POST", headers, body: JSON.stringify({ name: n }) }).then((x) => x.json()); id = m && m.id; if (id) map[n.toLowerCase()] = id; } catch (e) {}
      }
      if (id) ids.push(id);
    }
    return { ids, map };
  }

  const { ids: wantIds, map: tagMap } = tags.length ? await resolveTags(tags) : { ids: [], map: {} };

  // Create the subscriber, or find the existing one. The response is the same {ok:true} either way,
  // so this can't be used to probe who is on the list. Pass the VISITOR's real IP so Buttondown's
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
  } catch (e) { return reply({ error: "Could not reach the mailing list. Try again." }, 502); }
  if (r.ok) {
    sid = d && d.id;
  } else if (d && d.code === "email_already_exists") {
    sid = (d.metadata && d.metadata.subscriber_id) || null;
    if (!sid) { try { const f = await fetch(`${API}/subscribers/${encodeURIComponent(email)}`, { headers }).then((x) => x.json()); sid = f && f.id; } catch (e) {} }
  } else {
    console.log("subscribe failed:", r.status, (d && d.code) || "", String((d && d.detail) || "").slice(0, 200));
    return reply({ error: "Could not add you to the list right now." }, 502);
  }

  // Apply the tags by id, merged with whatever the subscriber already has (existing tags read back
  // as names, so translate them through the catalog). PATCH is the call Buttondown actually honors.
  if (wantIds.length && sid) {
    try {
      const cur = await fetch(`${API}/subscribers/${encodeURIComponent(sid)}`, { headers }).then((x) => x.json()).catch(() => ({}));
      const curIds = (Array.isArray(cur.tags) ? cur.tags : []).map((n) => tagMap[String(n).toLowerCase()]).filter(Boolean);
      const merged = Array.from(new Set(curIds.concat(wantIds)));
      await fetch(`${API}/subscribers/${encodeURIComponent(sid)}`, { method: "PATCH", headers, body: JSON.stringify({ tags: merged }) });
    } catch (e) { console.log("tag apply error:", e && e.message); }
  }
  return reply({ ok: true });
}
