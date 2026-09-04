// GET/POST /api/newsletter-approve?id=<email_id>&exp=<unix>&t=<hmac>  (Cloudflare Pages Function)
//
// One-click approval for a drafted newsletter. The link is emailed to Teddy by
// tools/newsletter.py with a signed, time-limited token (HMAC of "id|exp"). Flow:
//   GET  -> verify token + expiry, show a confirm page with a "Send now" button.
//           (Email link-scanners/prefetchers only GET, so they can't send.)
//   POST -> reject cross-site requests, re-verify, confirm the email is still a
//           draft, then PATCH its status to "about_to_send" so Buttondown
//           delivers it to everyone.
//
// Defense in depth against a leaked/forwarded link: the token expires, the send
// is POST-only behind a same-origin check, and once an email leaves "draft" it
// can't be re-sent (the status re-check below).
//
// Secrets (Cloudflare Pages env, never in the repo):
//   NEWSLETTER_APPROVE_SECRET  signs/verifies the link (same value the CI script uses)
//   BUTTONDOWN_API_KEY         authorizes the send
const API = "https://api.buttondown.email/v1";

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const id = u.searchParams.get("id") || "";
  const exp = u.searchParams.get("exp") || "";
  const t = u.searchParams.get("t") || "";
  const ok = await validToken(id, exp, t, env);
  if (ok !== true) return page(ok, 400);

  const email = await getEmail(id, env);
  if (!email) return page("Couldn't find that draft - it may have been deleted.", 404);
  if (email.status !== "draft") return page(`Already handled. This email's status is "${esc(email.status)}".`, 200);

  return html(`<h1>Send to everyone?</h1>
    <p class="subj">${esc(email.subject || "(untitled)")}</p>
    <p>This emails it to all of your confirmed subscribers. It can't be undone.</p>
    <form method="POST" action="${esc(request.url)}">
      <input type="hidden" name="id" value="${esc(id)}">
      <input type="hidden" name="exp" value="${esc(exp)}">
      <input type="hidden" name="t" value="${esc(t)}">
      <button type="submit">Send now</button>
    </form>
    <p class="muted">Or close this - it stays a draft in Buttondown.</p>`, 200);
}

export async function onRequestPost({ request, env }) {
  // The confirm form is same-origin; reject cross-site posts (CSRF).
  const site = request.headers.get("Sec-Fetch-Site");
  const origin = request.headers.get("Origin");
  if (site && site !== "same-origin") return page("Blocked a cross-site request.", 403);
  if (origin && host(origin) !== new URL(request.url).host) return page("Blocked a cross-site request.", 403);

  const form = await request.formData().catch(() => null);
  const id = (form && form.get("id") || "").toString();
  const exp = (form && form.get("exp") || "").toString();
  const t = (form && form.get("t") || "").toString();
  const ok = await validToken(id, exp, t, env);
  if (ok !== true) return page(ok, 400);
  if (!env.BUTTONDOWN_API_KEY) return page("This server isn't configured to send.", 500);

  // Re-check status right before sending so a reload / double-click can't re-send.
  const email = await getEmail(id, env);
  if (!email) return page("Couldn't find that draft - it may have been deleted.", 404);
  if (email.status !== "draft") return page(`Already handled. This email's status is "${esc(email.status)}".`, 200);

  let r;
  try {
    r = await fetch(`${API}/emails/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { Authorization: `Token ${env.BUTTONDOWN_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "about_to_send" }),
    });
  } catch (e) {
    return page("Couldn't reach Buttondown - try again in a minute.", 502);
  }
  if (!r.ok) return page("Buttondown rejected the send: " + esc((await r.text().catch(() => "")).slice(0, 300)), 502);
  return page("Sent. It's on its way to everyone.", 200);
}

// True if valid; otherwise a human-readable reason string.
async function validToken(id, exp, t, env) {
  if (!id || !exp || !t || !env.NEWSLETTER_APPROVE_SECRET) return "That approval link isn't valid.";
  const expNum = Number(exp);
  if (!Number.isFinite(expNum)) return "That approval link isn't valid.";
  if (Date.now() / 1000 > expNum) return "That approval link has expired. Send it from Buttondown instead.";
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(env.NEWSLETTER_APPROVE_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${id}|${exp}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(t.toLowerCase(), expected) ? true : "That approval link isn't valid.";
}

async function getEmail(id, env) {
  if (!env.BUTTONDOWN_API_KEY) return null;
  try {
    const r = await fetch(`${API}/emails/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Token ${env.BUTTONDOWN_API_KEY}` },
    });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}

function host(o) { try { return new URL(o).host; } catch (e) { return ""; } }

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function html(inner, status) {
  const doc = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>THEODORE.NET</title>
<style>body{font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1.25rem;color:#111;line-height:1.6}
h1{font-size:1.4rem}.subj{font-weight:600}.muted{color:#999;font-size:.9rem}
button{font:inherit;padding:.6rem 1.2rem;border:0;border-radius:6px;background:#111;color:#fff;cursor:pointer}</style>
${inner}`;
  return new Response(doc, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function page(msg, status) { return html(`<p>${esc(msg)}</p>`, status); }
