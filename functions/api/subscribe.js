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

  let r, d;
  try {
    r = await fetch(`${API}/subscribers`, {
      method: "POST",
      headers: { Authorization: `Token ${env.BUTTONDOWN_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ email_address: email, tags }),
    });
    d = await r.json().catch(() => ({}));
  } catch (e) { return reply({ error: "Could not reach the mailing list. Try again." }, 502); }

  if (r.ok) return reply({ ok: true });
  // Already on the list: success. If we have tags (e.g. the waitlist), merge them onto the
  // existing subscriber so they're still segmentable, without dropping their other tags.
  if (d && d.code === "email_already_exists") {
    const sid = d.metadata && d.metadata.subscriber_id;
    if (tags.length && sid) {
      try {
        const cur = await fetch(`${API}/subscribers/${encodeURIComponent(sid)}`, { headers: { Authorization: `Token ${env.BUTTONDOWN_API_KEY}` } }).then((x) => x.json()).catch(() => ({}));
        const merged = Array.from(new Set((Array.isArray(cur.tags) ? cur.tags : []).concat(tags)));
        await fetch(`${API}/subscribers/${encodeURIComponent(sid)}`, {
          method: "PATCH",
          headers: { Authorization: `Token ${env.BUTTONDOWN_API_KEY}`, "content-type": "application/json" },
          body: JSON.stringify({ tags: merged }),
        });
      } catch (e) { console.log("tag merge error:", e && e.message); }
    }
    return reply({ ok: true });   // identical to a fresh signup so this can't be used to test list membership
  }
  console.log("subscribe failed:", r.status, (d && d.code) || "", String((d && d.detail) || "").slice(0, 200));
  return reply({ error: "Could not add you to the list right now." }, 502);
}
