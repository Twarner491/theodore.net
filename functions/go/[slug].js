// GET /go/<slug>  (Cloudflare Pages Function, file-based dynamic route -> params.slug)
//
// First-party campaign short-links for attribution. A shared link like theodore.net/go/x issues a 302 to a
// curated INTERNAL theodore.net page with ?go=<channel> appended, which store.js evSource() records as the
// visitor's first-touch channel. This is the only reliable social attribution we have: mobile and in-app
// browsers (X, Instagram) strip the referrer, so that traffic otherwise lands as "direct".
//
// Open-redirect-safe by construction (see _lib.js): the slug is only a key into a hard-coded map, unknown
// slugs fall back to /store, and the path is re-validated as internal before the redirect. Stateless: no env,
// no secrets, no D1, so it cannot affect checkout and has no failure surface beyond the safe default.
import { resolveGo } from "./_lib.js";

// onRequest handles ALL methods (GET for the click-through, HEAD for link unfurlers / scanners), so a shared
// short link previews and resolves cleanly everywhere. The redirect is identical regardless of method.
export async function onRequest({ request, params }) {
  const { path, go } = resolveGo(params && params.slug);
  const dest = new URL(path, new URL(request.url).origin);   // internal path resolved against OUR origin only
  dest.searchParams.set("go", go);
  return new Response(null, {
    status: 302,
    headers: {
      Location: dest.toString(),
      "Cache-Control": "public, max-age=300",
      "Referrer-Policy": "no-referrer",
    },
  });
}
