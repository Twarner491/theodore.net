// Shared logic for the /go/<slug> short-link redirector. Files starting with "_" are NOT routed by
// Cloudflare Pages, so this is a private module imported by [slug].js (and unit-tested by tests/go.test.mjs).
//
// Open-redirect safety is the whole point: the destination is NEVER derived from request input. The inbound
// slug is only ever a KEY into the hard-coded GO_MAP below; an unknown/spoofed slug falls back to /store; and
// the resolved path is re-validated as an internal, same-origin path before use. There is no code path that
// turns caller text into a Location, so an open redirect is structurally impossible.

export const SAFE_DEFAULT = { path: "/store/", go: "link" };

// slug -> { path: <curated INTERNAL theodore.net path, trailing slash>, go: <channel token written to ?go> }.
// Add a campaign by copying a real /store/<product>/ path and giving it a <=24-char [a-z0-9_.-] token. Prefer
// the canonical channel tokens (x / instagram / facebook / youtube / reddit / hn / newsletter) so short-link
// traffic groups with organic referral traffic on the analytics dashboard. Combine channel + product for a
// platform-specific product link (see avian-x). This map is public; that's fine, it only ever points at our
// own pages.
export const GO_MAP = {
  // channel landings (store home)
  x:          { path: "/store/", go: "x" },
  twitter:    { path: "/store/", go: "x" },
  ig:         { path: "/store/", go: "instagram" },
  instagram:  { path: "/store/", go: "instagram" },
  fb:         { path: "/store/", go: "facebook" },
  facebook:   { path: "/store/", go: "facebook" },
  yt:         { path: "/store/", go: "youtube" },
  youtube:    { path: "/store/", go: "youtube" },
  reddit:     { path: "/store/", go: "reddit" },
  hn:         { path: "/store/", go: "hn" },
  newsletter: { path: "/store/", go: "newsletter" },
  // product deep-links (generic short-link channel)
  avian:      { path: "/store/avian-visitors/", go: "avian" },
  birdmic:    { path: "/store/avian-mic/",      go: "birdmic" },
  micmount:   { path: "/store/mic-mount/",      go: "micmount" },
  polargraph: { path: "/store/polargraph/",     go: "polargraph" },
  pens:       { path: "/store/micron-pens-9/",  go: "pens" },
  // platform-specific product link example: an Avian Visitors link shared on X groups under the x channel
  "avian-x":  { path: "/store/avian-visitors/", go: "x" },
  // synergy with the store.js ?join deep-link: a short link that opens the Avian Visitors waitlist, attributed
  waitlist:   { path: "/store/avian-visitors/?join=1", go: "waitlist" },
};

export const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;   // accepted inbound slug shape
export const GO_RE = /^[a-z0-9_.-]{1,24}$/;            // store.js evClean()-compatible channel token

// Only ever allow a site-relative internal path: one leading slash, never protocol-relative, no scheme, no
// backslash. Defense-in-depth against a future bad GO_MAP edit, on top of the curated-map guarantee.
export function assertInternalPath(p) {
  return typeof p === "string"
    && p.charAt(0) === "/"
    && p.charAt(1) !== "/"                  // reject //evil.com
    && p.charAt(1) !== "\\"                 // reject /\evil.com
    && !/^\s*[a-z][a-z0-9+.-]*:/i.test(p)   // reject http: / javascript: / data: schemes
    && p.indexOf("\\") < 0;
}

// Pure resolver: slug -> a safe { path, go }. Never returns request-derived data; always internal + bounded.
export function resolveGo(slug) {
  const raw = String(slug == null ? "" : slug).toLowerCase();
  const entry = (SLUG_RE.test(raw) && Object.prototype.hasOwnProperty.call(GO_MAP, raw)) ? GO_MAP[raw] : SAFE_DEFAULT;
  const path = assertInternalPath(entry.path) ? entry.path : SAFE_DEFAULT.path;
  const go = GO_RE.test(entry.go || "") ? entry.go : SAFE_DEFAULT.go;
  return { path, go };
}
