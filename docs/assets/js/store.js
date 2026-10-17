/* store.js for theodore.net/store
   The store index shows a grid of cards that link to per-product pages. Each
   product page renders an image carousel and the buy options into
   #product-detail. The cart lives behind a header bag icon and a right drawer,
   in localStorage. No payments yet; checkout is stubbed for the Stripe +
   Cloudflare backend. Set DEV_SHOW_UNPUBLISHED false before publishing. */
(function () {
  "use strict";

  const DEV_SHOW_UNPUBLISHED = typeof location !== "undefined" &&
    /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)$/.test(location.hostname || "");
  const CART_KEY = "store:cart:v3";

  const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 6 18 18M18 6 6 18"/></svg>';
  const ICON_BAG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6h-2c0-2.8-2.2-5-5-5S7 3.2 7 6H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2m-7-3c1.7 0 3 1.3 3 3H9c0-1.7 1.3-3 3-3m7 17H5V8h14zm-7-8c-1.7 0-3-1.3-3-3H7c0 2.8 2.2 5 5 5s5-2.2 5-5h-2c0 1.7-1.3 3-3 3"/></svg>';

  /* product data is generated from docs/store/*.md frontmatter by hooks/store_products.py and loaded as window.STORE_PRODUCTS; populated in init() */
  let PRODUCTS = [];
  let INVENTORY_READY = false;
  let INVENTORY_ROWS = Object.create(null);
  const INVENTORY_TIMEOUT_MS = 2500;

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const money = (n) => "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
  const money2 = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });   // checkout summary: tax + totals carry cents
  const escapeHtml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const getProduct = (id) => PRODUCTS.find((p) => p.id === id);
  const STORE_FILTERS = ["products", "kits", "accessories"];
  const DEFAULT_STORE_FILTERS = ["products", "kits"];
  const STORE_FILTER_KEY = "store:filter:v2";
  const LEGACY_STORE_FILTER_KEY = "store:filter:v1";
  let storeFilters = DEFAULT_STORE_FILTERS.slice();
  function normalizeStoreFilters(value) {
    const requested = Array.isArray(value) ? value : [];
    return STORE_FILTERS.filter((category) => requested.indexOf(category) >= 0);
  }
  function preferredStoreFilters() {
    try {
      const saved = localStorage.getItem(STORE_FILTER_KEY);
      if (saved !== null) {
        let parsed = null;
        try { parsed = JSON.parse(saved); } catch (e) {}
        const normalized = normalizeStoreFilters(parsed);
        return normalized.length ? normalized : DEFAULT_STORE_FILTERS.slice();
      }
      const legacy = localStorage.getItem(LEGACY_STORE_FILTER_KEY);
      if (legacy === "all") return STORE_FILTERS.slice();
      if (STORE_FILTERS.indexOf(legacy) >= 0) return [legacy];
    } catch (e) {}
    return DEFAULT_STORE_FILTERS.slice();
  }
  function rememberStoreFilters(next) {
    const normalized = normalizeStoreFilters(next);
    if (!normalized.length) return;
    try { localStorage.setItem(STORE_FILTER_KEY, JSON.stringify(normalized)); } catch (e) {}
  }
  const sameStoreFilters = (a, b) => a.length === b.length && a.every((category, i) => category === b[i]);
  function storeFilterLabel(filters) {
    if (filters.length === STORE_FILTERS.length) return "all";
    if (filters.length === 1) return filters[0];
    if (filters.indexOf("products") >= 0 && filters.indexOf("kits") >= 0) return "products + kits";
    return filters.length + " categories";
  }
  const storeFilterPhrase = (filters) => filters.length === STORE_FILTERS.length ? "all categories" : filters.join(" and ");
  const visibleStoreProducts = () => PRODUCTS.filter((p) => p.published || DEV_SHOW_UNPUBLISHED);
  /* A store listing is a product line within one top-level category, not every package
     variant. Most pages need one inferred listing (kits for a normal product page,
     accessories for `accessory:true`). A page can declare `storeListings` in
     frontmatter when its category or representative build should be explicit. */
  function listingsFor(p) {
    const variants = Array.isArray(p.variants) ? p.variants : [];
    const configured = Array.isArray(p.storeListings) ? p.storeListings : [];
    const listings = configured.map((entry) => {
      if (!entry || ["products", "kits", "accessories"].indexOf(entry.category) < 0) return null;
      let listingVariants = Array.isArray(entry.variants)
        ? variants.filter((v) => entry.variants.indexOf(v.id) >= 0)
        : variants.slice();
      let selected = variants.find((v) => v.id === entry.build) || listingVariants[0] || variants[0];
      if (selected && listingVariants.indexOf(selected) < 0) listingVariants.unshift(selected);
      return {
        product: p,
        category: entry.category,
        build: selected ? selected.id : "",
        variants: listingVariants,
        title: entry.title || p.title,
        teaser: entry.teaser || p.teaser,
      };
    }).filter(Boolean);
    if (listings.length) return listings;
    const selected = variants.find((v) => v.id === p.defaultBuild) || variants[0];
    return [{
      product: p,
      category: p.accessory ? "accessories" : "kits",
      build: selected ? selected.id : "",
      variants: variants,
      title: p.title,
      teaser: p.teaser,
    }];
  }
  const visibleListings = () => {
    const all = [];
    visibleStoreProducts().forEach((p) => listingsFor(p).forEach((listing) => all.push(listing)));
    return STORE_FILTERS.reduce((ordered, category) => storeFilters.indexOf(category) >= 0
      ? ordered.concat(all.filter((listing) => listing.category === category))
      : ordered, []);
  };
  /* availability: a variant's optional `status` ("available" by default) drives the
     buy UI; soldout/comingSoon variants are also dropped from store-catalog.json so
     the backend refuses to sell them. Toggle any of these by setting `status:` in a
     variant's frontmatter. */
  const STATUS = {
    available:  { sell: true,  cta: "Add to cart", tag: "" },
    backorder:  { sell: true,  cta: "Add to cart", tag: "Backorder" },
    preorder:   { sell: true,  cta: "Pre-order",   tag: "Pre-order" },
    soldout:    { sell: false, cta: "",            tag: "Sold out" },
    comingSoon: { sell: false, cta: "",            tag: "Coming soon" },
  };
  const configuredStatusOf = (v) => { const s = v && (v.status || (v.comingSoon ? "comingSoon" : "available")); return STATUS[s] ? s : "available"; };
  /* timed drops: a variant's optional `launchAt` (ISO 8601 UTC, e.g. "2026-11-12T17:00:00Z") keeps
     it closed until that instant, so statusOf() reports a sellable variant as comingSoon on every
     surface until then. The detail page shows a live countdown in the buy button's slot and
     re-renders itself at launchAt. payment-intent.js enforces the same instant server-side, so a
     sellable variant can be deployed ahead of its drop. An unreadable value never opens. */
  const launchTime = (v) => { const t = v && typeof v.launchAt === "string" ? Date.parse(v.launchAt) : NaN; return isFinite(t) ? t : null; };
  const launchPending = (v) => { if (!v || v.launchAt == null) return false; const t = launchTime(v); return t == null || Date.now() < t; };
  const LOW_STOCK = 5;
  const inventorySkuOf = (v) => v && typeof v.inventorySku === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(v.inventorySku) ? v.inventorySku : "";
  function batchAvailabilityText(v, product) {
    const total = v && Number.isSafeInteger(v.batchSize) && v.batchSize > 0 ? v.batchSize : 0;
    if (!total) return "";
    const sku = inventorySkuOf(v), row = sku && INVENTORY_READY ? INVENTORY_ROWS[sku] : null;
    let remaining = row && Number.isSafeInteger(row.available) && row.available >= 0
      ? Math.min(total, row.available)
      : null;
    // Before launch, the explicitly unpublished localhost preview mirrors the pristine
    // batch. A published storefront never invents a count when D1 is unavailable.
    if (remaining === null && DEV_SHOW_UNPUBLISHED && v.localPreview === true && product && product.published === false)
      remaining = total;
    // `batchSizePrivate` never shows "N of M"; the count surfaces only once stock runs low
    if (v.batchSizePrivate === true) return remaining !== null && remaining > 0 && remaining <= LOW_STOCK ? "Only " + remaining + " left" : "";
    return remaining === null ? "" : remaining + " of " + total + " remaining";
  }
  const statusOf = (v) => {
    const configured = configuredStatusOf(v);
    if (!STATUS[configured].sell) return configured;
    if (launchPending(v)) return "comingSoon";
    const sku = inventorySkuOf(v);
    if (sku && (!INVENTORY_READY || !INVENTORY_ROWS[sku] || INVENTORY_ROWS[sku].soldOut)) {
      // An explicitly marked, unpublished product can show its finished price/CTA on
      // localhost before D1 is provisioned. Production and checkout remain fail-closed:
      // DEV_SHOW_UNPUBLISHED is host-bound, and unpublished products never enter the
      // trusted server catalog generated by hooks/store_products.py.
      if (DEV_SHOW_UNPUBLISHED && v.localPreview === true) return configured;
      return "soldout";
    }
    return configured;
  };
  /* Outside the explicit localhost preview above, buyable mirrors the server catalog: a
     variant needs a Stripe Price before the UI can offer it. The backend still derives its
     trusted catalog independently and refuses every unpublished preview item. */
  const buyable = (v) => v != null && STATUS[statusOf(v)].sell && v.price != null && !!v.stripePrice;
  /* the instant a not-yet-buyable variant is counting down to, or null. `launchLabel` names the
     drop in copy ("Batch 1 opens Thu, Nov 12, 9:00 AM PST"), shown in the viewer's time zone. */
  const countdownTarget = (v) => { const t = launchTime(v); return t != null && Date.now() < t && !buyable(v) ? t : null; };
  function launchText(v, short) {
    const t = launchTime(v); if (t == null) return "";
    let when;
    try {
      when = new Date(t).toLocaleString("en-US", short ? { month: "short", day: "numeric" }
        : { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
    } catch (e) { return ""; }
    return (v.launchLabel ? v.launchLabel + " opens " : "Opens ") + when;
  }
  // availability tag for cards; HTML-safe because it lands in innerHTML
  const statusTag = (v) => countdownTarget(v) != null ? escapeHtml(launchText(v, true)) : STATUS[statusOf(v)].tag;
  const productStatus = (p) => { const d = (p.variants || []).find((v) => v.id === p.defaultBuild) || (p.variants || [])[0]; return (d && statusTag(d)) || "Coming soon"; };
  const variantById = (p, id) => p.variants.find((v) => v.id === id) || p.variants[0];
  const exactVariant = (p, id) => (p.variants || []).find((v) => v.id === id) || null;
  /* a readable name for a cart line, e.g. "Avian Visitors (Electronics Kit)" */
  const lineLabel = (l) => { const p = getProduct(l && l.id); if (!p) return "An item in your cart"; const v = exactVariant(p, l.build); return p.title + (v ? " (" + v.label + ")" : ""); };
  /* cart lines whose product/variant is gone or no longer sellable */
  const unavailableLines = () => cart.filter((l) => { const p = getProduct(l.id); if (!p) return true; const v = exactVariant(p, l.build); return !v || !buyable(v); });
  /* light/dark product images: a "<name>DARK.<ext>" sibling is shown in dark mode.
     DARK_IMAGES (filled in init from STORE_DARK_IMAGES, generated by the build) lists
     which light URLs actually have a DARK file, so images without one stay light and
     never make a broken request. */
  let DARK_IMAGES = {};
  const isDark = () => (document.body.getAttribute("data-md-color-scheme") || document.documentElement.getAttribute("data-md-color-scheme")) === "slate";
  const toLight = (u) => u.replace(/DARK(\.[A-Za-z0-9]+)(\?.*)?$/, "$1$2");
  const toDark = (u) => u.replace(/(\.[A-Za-z0-9]+)(\?.*)?$/, "DARK$1$2");
  const themedUrl = (u) => { const light = toLight(u); return isDark() && DARK_IMAGES[light] ? toDark(light) : light; };
  /* per-image letterbox color (sampled at build, keyed by URL incl. DARK variants) so a contained
     product image fills its frame with a background matching that image's own, in either theme. */
  let IMAGE_BG = {};
  const bgFor = (u) => IMAGE_BG[u] || "";
  const carouselUrls = (p) => (p.images || []).map((f) => themedUrl(p.imageBase + f));
  const minPrice = (p) => { const ps = p.variants.filter(buyable).map((v) => v.price); return ps.length ? Math.min.apply(null, ps) : null; };
  const defaultBuyBuild = (p) => { const d = p.variants.find((v) => v.id === p.defaultBuild); if (buyable(d)) return d.id; const b = p.variants.find(buyable); return b ? b.id : null; };
  const listingVariant = (listing) => listing.variants.find((v) => v.id === listing.build) || listing.variants[0] || null;
  const listingMinPrice = (listing) => { const ps = listing.variants.filter(buyable).map((v) => v.price); return ps.length ? Math.min.apply(null, ps) : null; };
  const listingBuyBuild = (listing) => { const selected = listingVariant(listing); if (buyable(selected)) return selected.id; const first = listing.variants.find(buyable); return first ? first.id : null; };
  const listingStatus = (listing) => { const selected = listingVariant(listing); return (selected && statusTag(selected)) || "Coming soon"; };
  /* The first product photo is the authored overview/assembled view. Keep the
     listing's representative build for pricing and quick-add, but do not let
     that variant's component photo replace the product hero. Likewise, omit a
     redundant default-variant query so the detail carousel opens on photo 1;
     an explicit non-default listing still deep-links to its variant photo. */
  const listingHeroFile = (listing) => ((listing.product.images || [])[0] || "");
  const listingDetailHref = (listing) => {
    const p = listing.product;
    const variant = listing.build && listing.build !== p.defaultBuild
      ? "?variant=" + encodeURIComponent(listing.build)
      : "";
    return "/store/" + encodeURIComponent(p.id) + "/" + variant;
  };
  /* the first waitlist-eligible (non-buyable but coming-soon / sold-out) variant, for the ?join deep-link */
  const comingSoonVariant = (p) => (p.variants || []).find((v) => !buyable(v) && (statusOf(v) === "comingSoon" || statusOf(v) === "soldout")) || null;

  /* cart: line = { id, build, qty }. localStorage is user-editable, so treat the
     stored cart as untrusted: validate its shape, drop lines whose product or
     variant no longer exists, and clamp qty. (Line prices are never trusted from
     here either; the checkout backend recomputes them from Stripe.) */
  const MAX_QTY = 99;
  let cart = [];
  function variantMaxQuantity(id, build) {
    const p = getProduct(id), v = p && exactVariant(p, build);
    let limit = v && Number.isInteger(v.maxQuantity)
      ? Math.max(1, Math.min(MAX_QTY, v.maxQuantity))
      : MAX_QTY;
    const sku = inventorySkuOf(v), row = sku && INVENTORY_READY ? INVENTORY_ROWS[sku] : null;
    if (row && Number.isSafeInteger(row.available) && row.available >= 0)
      limit = Math.min(limit, row.available);
    return Math.max(1, limit);
  }
  const LEGACY_AVIAN_KIT_BUILDS = ["electronics", "electronics-printed"];
  const isLegacyAvianKitIdentity = (id, build) => id === "avian-visitors" && LEGACY_AVIAN_KIT_BUILDS.indexOf(build) >= 0;
  function migrateCartIdentity(id, build) {
    // The DIY choices moved to their own product page/catalog entry. Preserve
    // existing carts and old Meta/hand-shared checkout URLs, but never rewrite
    // the assembled Avian Visitors product that remains at the original id.
    return isLegacyAvianKitIdentity(id, build)
      ? { id: "avian-visitors-kit", build: build }
      : { id: id, build: build };
  }
  function migratedLine(line) {
    const identity = migrateCartIdentity(String((line && line.id) || ""), String((line && line.build) || ""));
    return Object.assign({}, line, identity);
  }
  function legacyAvianKitDetailTarget(productId, search, hash) {
    if (productId !== "avian-visitors") return "";
    let params; try { params = new URLSearchParams(search || ""); } catch (e) { return ""; }
    if (!isLegacyAvianKitIdentity(productId, params.get("variant") || "")) return "";
    const query = params.toString();
    return "/store/avian-visitors-kit/" + (query ? "?" + query : "") + (/^#/.test(hash || "") ? hash : "");
  }
  function sanitizeCart(raw) {
    if (!Array.isArray(raw)) return [];
    const known = PRODUCTS.length > 0;   // only drop unknown products once the catalog has loaded, so a transient data miss can't wipe a real cart
    const out = [], seen = {};
    raw.forEach((l) => {
      if (!l || typeof l !== "object") return;
      let id = String(l.id || ""), build = String(l.build || "");
      const migrated = migrateCartIdentity(id, build); id = migrated.id; build = migrated.build;
      let qty = Math.floor(Number(l.qty));
      if (!id || !isFinite(qty) || qty <= 0) return;
      qty = Math.min(qty, known ? variantMaxQuantity(id, build) : MAX_QTY);
      if (known) { const p = getProduct(id); if (!p || !(p.variants || []).some((v) => v.id === build)) return; }
      const key = id + "\u0000" + build;
      if (seen[key] != null) { out[seen[key]].qty = Math.min(out[seen[key]].qty + qty, known ? variantMaxQuantity(id, build) : MAX_QTY); return; }
      seen[key] = out.length; out.push({ id, build, qty });
    });
    return out;
  }
  const saveCart = () => { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {} };
  const loadCart = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(CART_KEY));
      const hadLegacyAvianKit = Array.isArray(raw) && raw.some((l) => l && isLegacyAvianKitIdentity(l.id, l.build));
      cart = sanitizeCart(raw);
      if (hadLegacyAvianKit) saveCart();   // make the one-time identity migration persistent
    } catch (e) { cart = []; }
  };
  const cartCount = () => cart.reduce((n, l) => n + l.qty, 0);
  const cartSubtotal = () => cart.reduce((s, l) => { const p = getProduct(l.id); if (!p) return s; const v = variantById(p, l.build); return s + (v.price ? v.price * l.qty : 0); }, 0);
  function addToCart(id, build, qty) {
    const ex = cart.find((l) => l.id === id && l.build === build);
    const maxQty = variantMaxQuantity(id, build);
    if (ex) ex.qty = Math.min(ex.qty + qty, maxQty); else cart.push({ id, build, qty: Math.min(qty, maxQty) });
    saveCart(); renderCart(); updateBadge(true); openCart();
    var atcUnit = evItemValue(getProduct(id), build); track("add_to_cart", { product: id, build: build, qty: qty, value: atcUnit != null ? atcUnit * qty : null });
    var ga4Qty = Math.min(qty, MAX_QTY), ga4Line = ga4Item(id, build, ga4Qty);
    ga4("add_to_cart", { currency: "USD", value: (ga4Line.price || 0) * ga4Qty, items: [ga4Line] });
  }
  function setLineQty(i, qty) { if (!cart[i]) return; if (qty <= 0) cart.splice(i, 1); else cart[i].qty = Math.min(Math.floor(qty), variantMaxQuantity(cart[i].id, cart[i].build)); saveCart(); renderCart(); }

  async function loadInventoryAvailability() {
    const skus = [];
    PRODUCTS.forEach((p) => {
      if (!p || !p.published) return;
      (p.variants || []).forEach((v) => {
        const sku = inventorySkuOf(v);
        if (sku && STATUS[configuredStatusOf(v)].sell && skus.indexOf(sku) < 0) skus.push(sku);
      });
    });
    if (!skus.length) { INVENTORY_READY = true; return false; }
    try {
      const query = skus.map((sku) => "sku=" + encodeURIComponent(sku)).join("&");
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      let timer = null;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          if (controller) controller.abort();
          reject(new Error("inventory timeout"));
        }, INVENTORY_TIMEOUT_MS);
      });
      const request = (async () => {
        const response = await fetch("/api/inventory-availability?" + query, {
          cache: "no-store", ...(controller ? { signal: controller.signal } : {}),
        });
        return { response, body: await response.json() };
      })();
      let result;
      try { result = await Promise.race([request, timeout]); }
      finally { if (timer != null) clearTimeout(timer); }
      const response = result.response, body = result.body;
      if (!response.ok || !body || !Array.isArray(body.inventory) || body.inventory.length !== skus.length) throw new Error("inventory unavailable");
      const rows = Object.create(null);
      body.inventory.forEach((row) => {
        if (!row || skus.indexOf(row.sku) < 0 || rows[row.sku] || !Number.isSafeInteger(row.available) ||
            row.available < 0 || typeof row.soldOut !== "boolean" || row.soldOut !== (row.available === 0)) {
          throw new Error("invalid inventory response");
        }
        rows[row.sku] = { available: row.available, soldOut: row.soldOut };
      });
      if (Object.keys(rows).length !== skus.length) throw new Error("incomplete inventory response");
      INVENTORY_ROWS = rows;
      INVENTORY_READY = true;
      return true;
    } catch (error) {
      INVENTORY_ROWS = Object.create(null);
      INVENTORY_READY = false;
      return false;
    }
  }

  function refreshInventorySurfaces() {
    if ($("#store-grid")) renderGrid();
    else if ($("#product-detail") && root && P) { updateVariant(false); renderAccessories(P); }
    else if ($("#checkout") && cart.some((line) => {
      const product = getProduct(line.id), variant = product && exactVariant(product, line.build);
      return !!inventorySkuOf(variant);
    })) { void renderCheckout(); }
    renderCart();
  }

  function reconcileCartToInventory() {
    cart = sanitizeCart(cart).filter((line) => {
      const product = getProduct(line.id), variant = product && exactVariant(product, line.build);
      const sku = inventorySkuOf(variant), row = sku && INVENTORY_READY ? INVENTORY_ROWS[sku] : null;
      return !(row && row.available === 0);
    });
    saveCart();
  }

  /* ---- first-party funnel beacon: no PII, no consent surface, fire-and-forget. Records buyer-journey
     steps (including waitlist open / submit / success / error) to our own theodore-events
     Worker at theodore.net/api/ev. Identity is a random visitor id (localStorage) + a per-tab session id
     (sessionStorage) + a first-touch channel (referrer host or a ?go=<slug> short-link) -- never an email,
     name, or IP. Purchases are NOT sent here; they're authoritative from Stripe. sendBeacon never blocks the
     page, and it silently no-ops anywhere /api/ev isn't routed (local dev), so it can't affect checkout. ---- */
  const EV_URL = "/api/ev", EV_AID = "tev_aid", EV_SID = "tev_sid", EV_SRC = "tev_src", EV_LAND = "tev_land";
  const ssg = (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
  const sss = (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) {} };
  const evClean = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 24);
  function evRid() { try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "").slice(0, 32); } catch (e) {} return Date.now().toString(36) + Math.random().toString(36).slice(2, 12); }
  function evAnon() { try { let a = localStorage.getItem(EV_AID); if (!a) { a = evRid(); localStorage.setItem(EV_AID, a); } return a; } catch (e) { return evSess(); } }
  function evSess() { let s = ssg(EV_SID); if (!s) { s = evRid(); sss(EV_SID, s); } return s; }
  // First-touch channel for the session: a clean ?go=<slug> short-link wins, else the referrer host maps to a
  // canonical token. Locked in on the first page of the session so later internal hops stay attributed.
  function evSource() {
    let src = ssg(EV_SRC);
    if (src != null) return src;
    let go = null; try { go = new URLSearchParams(location.search).get("go"); } catch (e) {}
    if (go) src = evClean(go) || "direct";
    else {
      let host = ""; try { host = new URL(document.referrer).hostname.toLowerCase(); } catch (e) {}
      if (!host || /(^|\.)theodore\.net$/.test(host)) {
        // Internal hop or direct load: prefer the sitewide first-touch (attribution.js)
        // -- most sessions LAND on a project page that doesn't run this file, so the
        // channel that actually brought them lives in localStorage, not the referrer.
        src = "direct";
        try {
          const ft = JSON.parse(localStorage.getItem("attr:first:v1"));
          if (ft && ft.src && Date.now() - (ft.ts || 0) < 90 * 864e5) src = evClean(ft.src) || "direct";
        } catch (e) {}
      }
      else if (/(^|\.)(x\.com|twitter\.com|t\.co)$/.test(host)) src = "x";
      else if (/(^|\.)instagram\.com$/.test(host)) src = "instagram";
      else if (/(^|\.)(facebook\.com|fb\.com|fb\.me)$/.test(host) || /^[lm]\.facebook\.com$/.test(host)) src = "facebook";
      else if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) src = "youtube";
      else if (/(^|\.)reddit\.com$/.test(host)) src = "reddit";
      else if (/(^|\.)news\.ycombinator\.com$/.test(host)) src = "hn";
      else if (/(^|\.)(google|bing|duckduckgo)\.[a-z.]{2,10}$/.test(host)) src = "search";
      else src = evClean(host.replace(/^www\./, "")) || "direct";
    }
    sss(EV_SRC, src);
    return src;
  }
  function evInit() { try { if (ssg(EV_LAND) == null) sss(EV_LAND, location.pathname.slice(0, 256)); evSource(); } catch (e) {} }
  // expose the session's first-party identity so checkout can stamp it onto the order (attribution join)
  function evAttribution() { try { return { anon: evAnon(), source: evSource() }; } catch (e) { return {}; } }
  function evItemValue(p, b) { try { const v = variantById(p, b || (p.defaultBuild || (p.variants[0] || {}).id)); return v && v.price ? v.price * 100 : null; } catch (e) { return null; } }
  /* ---- GA4 ecommerce mirrors: the same moments the first-party beacon tracks,
     emitted as standard gtag ecommerce events so channel/conversion reporting works
     in GA4 (and via Teddy's Meta<->GA link, for Shop traffic) without any new
     tracking surface. gtag ships with the site's existing analytics; if it's
     absent (blocked, local dev) these are silent no-ops and can never break the
     store. item_id matches the Meta catalog feed ids ("<product>-<variant>"). ---- */
  function ga4(name, params) { try { if (typeof window.gtag === "function") window.gtag("event", name, params); } catch (e) { /* never breaks the store */ } }
  function ga4Item(id, buildId, qty) {
    const identity = migrateCartIdentity(String(id || ""), String(buildId || "")); id = identity.id; buildId = identity.build;
    const p = getProduct(id);
    const b = buildId || ((p && p.defaultBuild) || "");
    const v = p ? variantById(p, b) : null;
    return { item_id: id + "-" + b, item_name: (p && p.title) || id, item_variant: b, price: (v && v.price) || 0, quantity: qty || 1 };
  }

  function track(type, ex) {
    try {
      const ev = { t: type, a: evAnon(), s: evSess(), src: evSource() };
      const land = ssg(EV_LAND); if (land) ev.l = land;
      let host = ""; try { host = new URL(document.referrer).hostname; } catch (e) {}
      if (host) ev.r = host.slice(0, 128);
      if (ex) { if (ex.product) ev.p = String(ex.product).slice(0, 64); if (ex.build) ev.b = String(ex.build).slice(0, 40); if (ex.qty != null) ev.q = ex.qty; if (ex.value != null && isFinite(ex.value)) ev.v = Math.round(ex.value); }
      const body = JSON.stringify(ev);
      if (navigator.sendBeacon) navigator.sendBeacon(EV_URL, body);
      else fetch(EV_URL, { method: "POST", headers: { "content-type": "text/plain" }, body: body, keepalive: true }).catch(() => {});
    } catch (e) { /* analytics never breaks the page */ }
  }

  /* ---- store index filter: a compact checkable menu. Products and kits are the
     fresh default; checking every category is the natural "all" state. ---- */
  function setStoreFilters(next, force, persist) {
    const normalized = normalizeStoreFilters(next);
    if (!normalized.length) return false;
    const changed = !sameStoreFilters(normalized, storeFilters);
    storeFilters = normalized;
    if (persist) rememberStoreFilters(storeFilters);
    const filter = $("#store-filter");
    if (filter) {
      const current = $(".store-filter-current", filter), toggle = $(".store-filter-toggle", filter);
      if (current) current.textContent = storeFilterLabel(storeFilters);
      if (toggle) toggle.setAttribute("aria-label", "Filter store listings. Selected: " + storeFilterPhrase(storeFilters) + ".");
      $$('[role="menuitemcheckbox"][data-filter]', filter).forEach((option) => {
        const checked = storeFilters.indexOf(option.dataset.filter) >= 0;
        option.setAttribute("aria-checked", checked ? "true" : "false");
        option.setAttribute("aria-disabled", checked && storeFilters.length === 1 ? "true" : "false");
      });
    }
    if (changed || force) renderGrid();
    return changed;
  }
  function toggleStoreFilter(category, persist) {
    if (STORE_FILTERS.indexOf(category) < 0) return false;
    const selected = storeFilters.indexOf(category) >= 0;
    if (selected && storeFilters.length === 1) {
      const status = $("#store-filter-status");
      if (status) status.textContent = "At least one category must remain selected.";
      return false;
    }
    const next = selected ? storeFilters.filter((item) => item !== category) : storeFilters.concat(category);
    return setStoreFilters(next, false, persist !== false);
  }
  function wireStoreFilter() {
    const filter = $("#store-filter"); if (!filter) { renderGrid(); return; }
    const toggle = $(".store-filter-toggle", filter), menu = $(".store-filter-menu", filter);
    const options = $$('[role="menuitemcheckbox"][data-filter]', filter);
    if (!toggle || !menu || !options.length) { renderGrid(); return; }
    let active = 0;
    const selectedIndex = () => Math.max(0, options.findIndex((option) => storeFilters.indexOf(option.dataset.filter) >= 0));
    const setActive = (index) => {
      active = (index + options.length) % options.length;
      options.forEach((option, i) => option.classList.toggle("is-active", i === active));
      menu.setAttribute("aria-activedescendant", options[active].id);
    };
    const isOpen = () => filter.classList.contains("is-open");
    const closeMenu = (restoreFocus) => {
      filter.classList.remove("is-open"); toggle.setAttribute("aria-expanded", "false"); menu.setAttribute("aria-hidden", "true");
      menu.removeAttribute("aria-activedescendant");
      options.forEach((option) => option.classList.remove("is-active"));
      if (restoreFocus) toggle.focus();
    };
    const openMenu = (index) => {
      filter.classList.add("is-open"); toggle.setAttribute("aria-expanded", "true"); menu.setAttribute("aria-hidden", "false");
      setActive(index == null ? selectedIndex() : index);
      try { menu.focus({ preventScroll: true }); } catch (e) { menu.focus(); }
    };
    const choose = (option) => {
      if (!option) return;
      toggleStoreFilter(option.dataset.filter, true);
      try { menu.focus({ preventScroll: true }); } catch (e) { menu.focus(); }
    };
    toggle.addEventListener("click", () => { if (isOpen()) closeMenu(false); else openMenu(); });
    toggle.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen()) { e.preventDefault(); closeMenu(true); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); openMenu(e.key === "ArrowDown" ? 0 : options.length - 1);
      }
    });
    menu.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
      else if (e.key === "Home") { e.preventDefault(); setActive(0); }
      else if (e.key === "End") { e.preventDefault(); setActive(options.length - 1); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(options[active]); }
      else if (e.key === "Escape") { e.preventDefault(); closeMenu(true); }
      else if (e.key === "Tab") setTimeout(() => closeMenu(false), 0);
    });
    options.forEach((option, i) => {
      option.addEventListener("pointerenter", () => setActive(i));
      option.addEventListener("click", () => choose(option));
    });
    document.addEventListener("pointerdown", (e) => {
      if (isOpen() && !filter.contains(e.target)) closeMenu(document.activeElement === menu);
    });
    const syncPreference = () => setStoreFilters(preferredStoreFilters(), false, false);
    window.addEventListener("pageshow", syncPreference);
    window.addEventListener("storage", (e) => {
      if (e.key === STORE_FILTER_KEY || e.key === null) { syncPreference(); return; }
      if (e.key !== LEGACY_STORE_FILTER_KEY) return;
      try { if (localStorage.getItem(STORE_FILTER_KEY) === null) syncPreference(); } catch (err) {}
    });
    setStoreFilters(preferredStoreFilters(), true, false);
  }

  /* ---- store index grid: one card per product line/category, linking to the
     representative build on the existing product detail page. ---- */
  function renderGrid() {
    const grid = $("#store-grid");
    if (!grid) return;
    grid.classList.toggle("is-filter-update", grid.dataset.rendered === "true");
    grid.innerHTML = "";
    const listings = visibleListings();
    listings.forEach((listing) => {
      const p = listing.product;
      const heroFile = listingHeroFile(listing);
      const hero = heroFile ? themedUrl((p.imageBase || "") + heroFile) : "";
      const mp = listingMinPrice(listing);
      const buyBuild = listingBuyBuild(listing);
      const href = listingDetailHref(listing);
      const showFrom = listing.variants.length > 1;
      const card = document.createElement("div");
      card.className = "product-card";
      card.dataset.category = listing.category;
      card.innerHTML =
        '<a class="pc-stretch" href="' + href + '" aria-label="' + escapeHtml(listing.title) + '"></a>' +
        '<div class="pc-imgwrap"' + (hero && bgFor(hero) ? ' style="background:' + bgFor(hero) + '"' : '') + '>' + (hero ? '<img class="pc-img" src="' + hero + '" alt="' + escapeHtml(listing.title) + '" loading="lazy">' : '<span class="pc-img"></span>') + "</div>" +
        '<div class="pc-body">' + (buyBuild ? '<button class="pc-add" type="button" aria-label="Add ' + escapeHtml(listing.title) + ' to cart"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>' : "") +
          '<p class="pc-title">' + escapeHtml(listing.title) + '</p><p class="pc-desc">' + escapeHtml(listing.teaser) + '</p>' +
          '<p class="pc-price">' + (mp != null ? (showFrom ? '<span class="from">from</span>' : "") + money(mp) : listingStatus(listing)) + "</p></div>";
      const add = card.querySelector(".pc-add");
      if (add) add.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); addToCart(p.id, buyBuild, 1); });
      grid.appendChild(card);
    });
    grid.dataset.rendered = "true";
    const status = $("#store-filter-status");
    if (status) {
      if (storeFilters.length === 1) {
        const noun = { products: "product", kits: "kit", accessories: "accessory" }[storeFilters[0]];
        const plural = noun === "accessory" ? "accessories" : noun + "s";
        status.textContent = "Showing " + listings.length + " " + (listings.length === 1 ? noun : plural) + ".";
      } else if (storeFilters.length === STORE_FILTERS.length) {
        status.textContent = "Showing " + listings.length + " store listings.";
      } else {
        status.textContent = "Showing " + listings.length + " listings: " + storeFilterPhrase(storeFilters) + ".";
      }
    }
    reveal();
    track("view_item_list");
  }

  /* ---- product detail page ---- */
  let root, P, build, qty = 1, slide = 0, navTrail = [];

  function detailSections(p) {
    let h = '<details class="pe-details"><summary>What’s in the box</summary><ul class="pe-contents-list pe-box-contents"></ul></details>';
    (p.sections || []).forEach((s) => {
      h += '<details class="pe-details"><summary>' + s.label + "</summary>" +
        (s.items ? '<ul class="pe-contents-list">' + s.items.map((x) => "<li>" + x + "</li>").join("") + "</ul>"
                 : '<div class="pe-details-body">' + (s.html || "") + "</div>") + "</details>";
    });
    if (p.colophon) h += '<details class="pe-details"><summary>Software &amp; licenses</summary><div class="pe-details-body">' + p.colophon + "</div></details>";
    return h;
  }
  /* Where the back arrow points: return to the product page you actually arrived from.
     `parentId` remains catalog taxonomy only; without a valid browsing trail every product,
     including an accessory opened from the main grid, returns to the store index. */
  /* Breadcrumb trail (sessionStorage) so the back arrow follows your real path and never
     loops: going deeper (a card click) pushes the current page; the back arrow / browser
     Back pops it. So Store -> Bird Mic -> Avian Visitors -> (back) -> Bird Mic still backs
     to Store, instead of Bird Mic <-> Avian Visitors pinging forever. */
  const TRAIL_KEY = "store_trail";
  function productIdFromPath(pathname) {
    const match = String(pathname || "").match(/^\/store\/([^\/]+)\/?$/);
    if (!match) return null;
    let id; try { id = decodeURIComponent(match[1]); } catch (e) { return null; }
    return getProduct(id) ? id : null;
  }
  function normalizedTrailEntry(raw) {
    if (!raw || typeof raw !== "object") return null;
    const legacyId = typeof raw.id === "string" ? raw.id : "";
    const rawHref = typeof raw.href === "string" && raw.href ? raw.href
      : (legacyId ? "/store/" + encodeURIComponent(legacyId) + "/" : "");
    let url; try { url = new URL(rawHref, location.origin); } catch (e) { return null; }
    if (url.origin !== location.origin) return null;
    const id = productIdFromPath(url.pathname);
    if (!id || (legacyId && legacyId !== id)) return null;
    return { id: id, href: url.pathname + url.search + url.hash };
  }
  const readTrail = () => {
    try {
      const raw = JSON.parse(sessionStorage.getItem(TRAIL_KEY));
      if (!Array.isArray(raw)) return [];
      return raw.slice(-12).map(normalizedTrailEntry).filter(Boolean);
    } catch (e) { return []; }
  };
  const writeTrail = (trail) => {
    const safe = (Array.isArray(trail) ? trail : []).slice(-12).map(normalizedTrailEntry).filter(Boolean);
    try { sessionStorage.setItem(TRAIL_KEY, JSON.stringify(safe)); } catch (e) {}
  };
  function currentProductTrailEntry(p) {
    const entry = normalizedTrailEntry({ id: p.id, href: location.pathname + location.search + location.hash });
    return entry || { id: p.id, href: "/store/" + encodeURIComponent(p.id) + "/" };
  }
  // Frontmatter-authored detail copy can link to another product just like an
  // accessory card. Record only a real same-tab product navigation.
  function detailProductLinkId(link) {
    if (!link || typeof link.getAttribute !== "function") return null;
    const target = String(link.getAttribute("target") || "").trim().toLowerCase();
    if (target && target !== "_self") return null;
    if (typeof link.hasAttribute === "function" && link.hasAttribute("download")) return null;
    const rawHref = link.getAttribute("href");
    if (typeof rawHref !== "string" || !rawHref.trim()) return null;
    let url;
    try {
      const base = location.origin + (location.pathname || "/") + (location.search || "") + (location.hash || "");
      url = new URL(rawHref, base);
    } catch (e) { return null; }
    if (url.origin !== location.origin) return null;
    return productIdFromPath(url.pathname);
  }
  function rememberDetailProductLink(p, link, e) {
    if (!p || !e || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
    const targetId = detailProductLinkId(link);
    if (!targetId || targetId === p.id) return false;
    writeTrail(navTrail.concat([currentProductTrailEntry(p)]));
    return true;
  }
  function wireDetailProductLinks(p, scope) {
    $$(".pe-details a[href]", scope || root).forEach((link) => {
      link.addEventListener("click", (e) => { rememberDetailProductLink(p, link, e); });
    });
  }
  function referrerProductId() {
    let ref; try { ref = new URL(document.referrer); } catch (e) { return null; }
    if (ref.origin !== location.origin) return null;
    return productIdFromPath(ref.pathname);
  }
  function isReloadNavigation() {
    try {
      const entry = performance.getEntriesByType("navigation")[0];
      return !!entry && entry.type === "reload";
    } catch (e) { return false; }
  }
  // Reconcile the stored trail with how we actually arrived at page p, then persist it.
  function reconcileTrail(p) {
    let trail = readTrail();
    const referrerId = referrerProductId(), reload = isReloadNavigation();
    if (!reload && referrerId === null) trail = [];                                // from the grid / off-site / a non-product page -> fresh
    else if (!reload && trail.length && trail[trail.length - 1].id === p.id)
      while (trail.length && trail[trail.length - 1].id === p.id) trail.pop();     // browser-Back to a page that had pushed itself
    else if (!reload && trail.length && trail[trail.length - 1].id !== referrerId)
      trail = [];                                                                  // a typed/direct product jump cannot inherit an unrelated trail
    writeTrail(trail);
    return trail;
  }
  function backTarget() {
    const entry = navTrail.length ? normalizedTrailEntry(navTrail[navTrail.length - 1]) : null;
    const parent = entry && getProduct(entry.id);
    return parent ? { href: entry.href, label: parent.title } : { href: "/store/", label: "Store" };
  }
  function detailHTML(p) {
    const multiVariant = (p.variants || []).length > 1;
    const hasVariantDesc = (p.variants || []).some((v) => !!v.desc);
    const hasSoftwareNote = !!p.softwareNote || (p.variants || []).some((v) => !!v.softwareNote);
    const hasLaunch = (p.variants || []).some((v) => launchTime(v) != null);
    const hasBatch = hasLaunch || (p.variants || []).some((v) => Number.isSafeInteger(v.batchSize) && v.batchSize > 0);
    const builds = p.variants.map((v) => '<button type="button" data-opt="' + v.id + '">' + v.label + "</button>").join("");
    const back = backTarget();
    return (
      '<div class="return2feed"><a href="' + escapeHtml(back.href) + '"><i class="fa-solid fa-arrow-left-long" aria-hidden="true"></i> ' + escapeHtml(back.label) + "</a></div>" +
      '<div class="pd-media"><div class="pe-carousel">' +
        '<button class="pe-arrow prev" type="button" aria-label="Previous"><i class="fa-solid fa-chevron-left"></i></button>' +
        '<div class="pe-frame"><div class="pe-slides"></div></div>' +
        '<button class="pe-arrow next" type="button" aria-label="Next"><i class="fa-solid fa-chevron-right"></i></button>' +
      '</div><div class="pe-dots"></div></div>' +
      '<div class="pd-info"><h2 class="pe-title">' + p.title + "</h2><p class=\"pe-sub\">" + (p.sub || "") + "</p>" +
        (multiVariant ? '<div class="opt-seg" data-group="build"><i class="opt-pill" aria-hidden="true"></i>' + builds + "</div>" : "") +
        (hasVariantDesc ? '<p class="pe-variant-desc"></p>' : "") +
        '<div class="pe-buyrow"><div class="pe-price"></div><div class="pe-qty"><button type="button" data-q="-1" aria-label="Decrease quantity">−</button><span>1</span><button type="button" data-q="1" aria-label="Increase quantity">+</button></div>' +
          (hasBatch ? '<div class="pe-batch" aria-live="polite" hidden></div>' : '') + '</div>' +
        '<button class="pe-buy" type="button"></button>' + (hasLaunch ? '<div class="pe-countdown" hidden></div>' : '') + '<div class="pe-waitlist" hidden></div>' +
        (hasSoftwareNote ? '<p class="pe-softnote"></p>' : "") +
        detailSections(p) +
      "</div>"
    );
  }

  function renderDetail(p) {
    root = $("#product-detail");
    if (!root) return;
    let requested = null;
    try { requested = new URLSearchParams(location.search).get("variant"); } catch (e) {}
    const initial = requested && exactVariant(p, requested);
    P = p; build = initial ? initial.id : (p.defaultBuild || p.variants[0].id); qty = 1;
    navTrail = reconcileTrail(p);
    root.innerHTML = detailHTML(p);
    renderCarousel(); wireDetail(); updateVariant(!!initial);
    renderAccessories(p);
    track("view_item", { product: p.id, build: build, value: evItemValue(p, build) });
    ga4("view_item", { currency: "USD", value: (variantById(p, build) || {}).price || 0, items: [ga4Item(p.id, build, 1)] });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncPill);
    maybeAutoWaitlist(p);
  }

  /* ---- accessory add-ons: standalone one-variant products (accessory:true) shown as small
     cards on their parent product page. The card links to the accessory's own page; the +
     adds to the cart and becomes a live quantity counter (reads/writes the cart line). ---- */
  const accessoriesFor = (p) => PRODUCTS.filter((a) => a.accessory && a.parentId === p.id && (a.published || DEV_SHOW_UNPUBLISHED));
  const cartQtyOf = (id, b) => { const l = cart.find((x) => x.id === id && x.build === b); return l ? l.qty : 0; };
  function setCartQty(id, b, q) {
    q = Math.max(0, Math.min(variantMaxQuantity(id, b), Math.floor(q)));
    const i = cart.findIndex((x) => x.id === id && x.build === b);
    if (q <= 0) { if (i >= 0) cart.splice(i, 1); }
    else if (i >= 0) cart[i].qty = q;
    else cart.push({ id, build: b, qty: q });
    saveCart(); renderCart(); updateBadge(true);   // renderCart() re-syncs the cards via syncAccCards()
  }
  const ICON_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  function accAddHTML(a) {
    const b = defaultBuyBuild(a); if (!b) return "";   // quick-add the default buyable variant
    const q = cartQtyOf(a.id, b);
    if (q > 0) return '<div class="pc-qty"><button type="button" data-q="-1" aria-label="Remove one">−</button><span>' + q + '</span><button type="button" data-q="1" aria-label="Add one">+</button></div>';
    return '<button class="pc-add" type="button" aria-label="Add to cart">' + ICON_PLUS + "</button>";
  }
  function accCardHTML(a) {
    const hero = carouselUrls(a)[0];
    const media = hero
      ? '<img class="pc-img" src="' + hero + '" alt="' + escapeHtml(a.title) + '" loading="lazy">'
      : '<span class="pc-img pc-ph"><i class="' + (a.icon || "fa-solid fa-cube") + '" aria-hidden="true"></i></span>';
    const mp = minPrice(a);
    // true accessory (single variant) -> exact price; cross-sell product (multi-variant) -> "from $X"
    const priceHTML = a.accessory ? money((a.variants[0] || {}).price)
      : (mp != null ? '<span class="from">from</span>' + money(mp) : productStatus(a));
    return '<div class="product-card product-card--mini" data-acc="' + escapeHtml(a.id) + '">' +
      '<a class="pc-stretch" href="/store/' + encodeURIComponent(a.id) + '/" aria-label="' + escapeHtml(a.title) + '"></a>' +
      '<div class="pc-imgwrap"' + (hero && bgFor(hero) ? ' style="background:' + bgFor(hero) + '"' : '') + '>' + media + "</div>" +
      '<div class="pc-body"><div class="pc-tophead"><p class="pc-title">' + escapeHtml(a.title) + '</p><span class="pc-addwrap">' + accAddHTML(a) + "</span></div>" +
        '<p class="pc-price">' + priceHTML + "</p></div></div>";
  }
  function syncAccCards() {
    $$(".product-card--mini").forEach((card) => {
      const a = getProduct(card.dataset.acc); if (!a) return;
      const wrap = $(".pc-addwrap", card); if (wrap) wrap.innerHTML = accAddHTML(a);
    });
  }
  function renderAccessories(p) {
    if (!root) return;
    const prev = document.querySelector(".pd-accessories"); if (prev) prev.remove();   // re-render safety
    const accs = accessoriesFor(p).filter((a) => buyable(a.variants[0]));   // true accessories
    const related = (p.related || []).map(getProduct).filter(Boolean);       // cross-sell products
    const cards = accs.concat(related).map(accCardHTML);                      // every card gets the + quick-add
    if (!cards.length) return;
    const sec = document.createElement("section");
    sec.className = "pd-accessories";
    sec.innerHTML = '<h3 class="acc-heading">Accessories</h3><div class="acc-grid" style="--acc-cols:' + Math.min(cards.length, 4) + '">' + cards.join("") + "</div>";
    root.insertAdjacentElement("afterend", sec);
    sec.addEventListener("click", (e) => {
      const card = e.target.closest(".product-card--mini"); if (!card) return;
      const a = getProduct(card.dataset.acc); if (!a) return;
      const b = defaultBuyBuild(a);
      if (b && e.target.closest(".pc-add")) { e.preventDefault(); setCartQty(a.id, b, 1); track("add_to_cart", { product: a.id, build: b, qty: 1, value: evItemValue(a, b) }); ga4("add_to_cart", { currency: "USD", value: (ga4Item(a.id, b, 1).price) || 0, items: [ga4Item(a.id, b, 1)] }); }
      else if (b && e.target.closest('.pc-qty button[data-q="1"]')) { e.preventDefault(); setCartQty(a.id, b, cartQtyOf(a.id, b) + 1); }
      else if (b && e.target.closest('.pc-qty button[data-q="-1"]')) { e.preventDefault(); setCartQty(a.id, b, cartQtyOf(a.id, b) - 1); }
      else if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey)
        writeTrail(navTrail.concat([currentProductTrailEntry(p)]));   // same-tab body click -> push this exact page so the child's back returns here
    });
    syncAccCards();
    reveal();   // inventory refresh replaces these cards after the initial page reveal
  }

  function renderCarousel() {
    const urls = carouselUrls(P);
    slide = 0;
    if (!urls.length) {
      $(".pe-slides", root).innerHTML = '<div class="pe-slide active"><span class="pe-ph"><i class="' + (P.icon || "fa-solid fa-cube") + '" aria-hidden="true"></i></span></div>';
      $(".pe-dots", root).innerHTML = "";
      $(".pe-carousel", root).classList.add("is-single");
      return;
    }
    $(".pe-slides", root).innerHTML = urls.map((u, i) => '<div class="pe-slide' + (i ? "" : " active") + '"' + (bgFor(u) ? ' style="background:' + bgFor(u) + '"' : '') + '><img src="' + u + '" alt="' + escapeHtml(P.title) + ' photo ' + (i + 1) + '"></div>').join("");
    $(".pe-dots", root).innerHTML = urls.length > 1 ? urls.map((_, i) => '<button class="pe-dot' + (i ? "" : " active") + '" type="button" data-i="' + i + '" aria-label="image ' + (i + 1) + '"></button>').join("") : "";
    const multi = urls.length > 1;
    $(".pe-carousel", root).classList.toggle("is-single", !multi);
    $$(".pe-dot", root).forEach((d) => d.addEventListener("click", () => goto(+d.dataset.i)));
    if (multi) {
      const frame = $(".pe-frame", root); let sx = 0, sy = 0, down = false;
      frame.addEventListener("pointerdown", (e) => { down = true; sx = e.clientX; sy = e.clientY; });
      frame.addEventListener("pointerup", (e) => {
        if (!down) return; down = false;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) goto(slide + (dx < 0 ? 1 : -1));
      });
      frame.addEventListener("pointercancel", () => { down = false; });
    }
  }
  function goto(n) {
    const slides = $$(".pe-slide", root); if (slides.length < 2) return;
    const dots = $$(".pe-dot", root);
    slides[slide].classList.remove("active"); if (dots[slide]) dots[slide].classList.remove("active");
    slide = (n + slides.length) % slides.length;
    slides[slide].classList.add("active"); if (dots[slide]) dots[slide].classList.add("active");
  }
  function syncPill() {
    const seg = $(".opt-seg", root); if (!seg) return;
    const pill = seg.querySelector(".opt-pill"), active = seg.querySelector('button[aria-current="true"]') || seg.querySelector("button");
    if (!pill || !active) return;
    pill.style.width = active.offsetWidth + "px";
    pill.style.transform = "translateX(" + active.offsetLeft + "px)";
  }
  window.addEventListener("resize", () => {
    if (document.getElementById("product-detail")) syncPill();
  });
  function updateVariant(jump = true) {
    const v = variantById(P, build);
    qty = Math.min(qty, variantMaxQuantity(P.id, build));
    $$(".opt-seg button", root).forEach((b) => b.setAttribute("aria-current", b.dataset.opt === build ? "true" : "false"));
    syncPill();
    // jump the carousel to this variant's photo (frontmatter variant `image:`), then the user can still swipe
    const vslide = (v.image && Array.isArray(P.images)) ? P.images.indexOf(v.image) : -1;
    if (jump && vslide >= 0) goto(vslide);
    const variantDesc = $(".pe-variant-desc", root);
    if (variantDesc) {
      variantDesc.textContent = v.desc || "";
      variantDesc.hidden = !variantDesc.textContent;
    }
    $(".pe-box-contents", root).innerHTML = (v.contents || []).map((c) => "<li>" + c + "</li>").join("");
    const softwareNote = $(".pe-softnote", root);
    if (softwareNote) {
      softwareNote.innerHTML = v.softwareNote || P.softwareNote || "";
      softwareNote.hidden = !softwareNote.innerHTML;
    }
    $(".pe-qty span", root).textContent = String(qty);
    const st = STATUS[statusOf(v)], can = buyable(v), launchAt = countdownTarget(v);
    // a counting-down drop keeps its price visible; other unbuyable states show only their status
    $(".pe-price", root).innerHTML = can ? money(v.price) + (st.tag ? ' <span class="pe-tag">' + st.tag + "</span>" : "")
      : launchAt != null && v.price != null ? money(v.price) : '<span class="pe-status">' + (st.tag || "Unavailable") + "</span>";
    $(".pe-qty", root).style.display = can ? "inline-flex" : "none";
    const batch = $(".pe-batch", root);
    if (batch) {
      // before a drop, the date replaces the remaining-count line so the batch size stays private
      batch.textContent = launchAt != null ? launchText(v) : batchAvailabilityText(v, P);
      batch.hidden = !batch.textContent;
    }
    const buy = $(".pe-buy", root);
    const wl = $(".pe-waitlist", root);
    if (wl) { wl.hidden = true; wl.innerHTML = ""; }
    const cd = $(".pe-countdown", root);
    stopCountdown();
    if (cd) { cd.hidden = true; cd.innerHTML = ""; }
    buy.style.display = ""; buy.disabled = false;
    if (can) { buy.classList.remove("is-waitlist"); buy.innerHTML = "<span>" + st.cta + "</span><span>" + money(v.price * qty) + "</span>"; }
    else if (launchAt != null && cd) { buy.style.display = "none"; startCountdown(cd, v, launchAt); }
    else { buy.classList.add("is-waitlist"); buy.textContent = "Notify me"; }
  }

  /* ---- drop countdown: fills the buy button's slot while a variant waits on its launchAt. Each
     digit rolls when it changes. "Notify me" swaps the field for the waitlist email form; after a
     signup the countdown returns marked "On the list" (remembered per product in this browser). ---- */
  const WAITLIST_KEY = "store:waitlist:v1";
  const joinedWaitlist = (id) => { try { const m = JSON.parse(localStorage.getItem(WAITLIST_KEY)); return !!m && m[id] === true; } catch (e) { return false; } };
  const rememberWaitlist = (id) => {
    try {
      let m = JSON.parse(localStorage.getItem(WAITLIST_KEY));
      if (!m || typeof m !== "object" || Array.isArray(m)) m = {};
      m[id] = true; localStorage.setItem(WAITLIST_KEY, JSON.stringify(m));
    } catch (e) {}
  };
  const CD_UNITS = [["d", 86400, "day"], ["h", 3600, "hour"], ["m", 60, "minute"], ["s", 1, "second"]];
  // whole seconds rounded up, so the display reaches 00s exactly at launch
  function countdownParts(ms) {
    let s = Math.max(0, Math.ceil(ms / 1000));
    return CD_UNITS.map((u) => { const n = Math.floor(s / u[1]); s -= n * u[1]; return n; });
  }
  let cdTimer = null, cdTick = null;
  function stopCountdown() { if (cdTimer != null) clearTimeout(cdTimer); cdTimer = null; cdTick = null; }
  const reducedMotion = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } };
  function rollDigit(slot, ch) {
    const cur = slot.lastElementChild;
    if (cur && cur.textContent === ch) return;
    // a hidden tab pauses animations, so an outgoing digit may never finish; keep at most the
    // current digit before rolling in the next one
    while (slot.firstElementChild && slot.firstElementChild !== cur) slot.firstElementChild.remove();
    const next = document.createElement("span");
    next.textContent = ch;
    slot.appendChild(next);
    if (!cur) return;
    if (!cur.textContent || document.hidden || reducedMotion() || typeof next.animate !== "function") { cur.remove(); return; }
    const timing = { duration: 460, easing: "cubic-bezier(0.215, 0.61, 0.355, 1)" };
    cur.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-0.7em)", opacity: 0 }], Object.assign({ fill: "forwards" }, timing)).onfinish = () => cur.remove();
    next.animate([{ transform: "translateY(0.7em)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], timing);
  }
  function setDigits(num, text) {
    while (num.children.length < text.length) { const s = document.createElement("span"); s.className = "pe-cd-digit"; num.insertBefore(s, num.firstChild); }
    while (num.children.length > text.length) num.removeChild(num.firstChild);
    for (let i = 0; i < text.length; i++) rollDigit(num.children[i], text[i]);
  }
  function startCountdown(host, v, at) {
    host.hidden = false;
    host.innerHTML =
      '<span class="pe-cd-time" aria-hidden="true">' +
        CD_UNITS.map((u) => '<span class="pe-cd-unit"><span class="pe-cd-num"></span><span class="pe-cd-label">' + u[0] + "</span></span>").join("") +
      '</span><span class="pe-cd-sr"></span>' +
      (joinedWaitlist(P.id) ? '<span class="pe-cd-joined">On the list</span>'
                            : '<button class="pe-cd-notify" type="button">Notify me</button>');
    const notify = $(".pe-cd-notify", host);
    if (notify) notify.addEventListener("click", openWaitlist);
    const nums = $$(".pe-cd-num", host), sr = $(".pe-cd-sr", host);
    const opens = (v.launchLabel || "This drop") + " opens in ";
    const tick = () => {
      if (cdTimer != null) clearTimeout(cdTimer);
      cdTimer = null;
      const left = at - Date.now();
      if (left <= 0) { stopCountdown(); onLaunch(); return; }
      const parts = countdownParts(left);
      nums.forEach((num, i) => setDigits(num, String(parts[i]).padStart(2, "0")));
      const said = opens + parts.slice(0, 3).map((n, i) => n + " " + CD_UNITS[i][2] + (n === 1 ? "" : "s")).join(", ");
      if (sr && sr.textContent !== said) sr.textContent = said;   // per-minute text for screen readers, not a live region
      cdTimer = setTimeout(tick, (left % 1000 || 1000) + 5);    // land each tick just past the second boundary
    };
    cdTick = tick;
    tick();
  }
  // background tabs throttle timers; catch the display up the moment the page is visible again
  document.addEventListener("visibilitychange", () => { if (!document.hidden && cdTick) cdTick(); });
  /* the drop opened while the page was open: repaint so a sellable variant's Add to cart appears
     without a reload (finite stock is unchanged since a successful page-load read, because
     checkout refuses the variant before launchAt) and a still-closed one falls back to the
     plain waitlist. */
  function onLaunch() {
    if (root && P) updateVariant(false);
    renderCart();
    if (!INVENTORY_READY) retryInventory(1);   // the read failed earlier; try again now that it matters
  }
  function wireDetail() {
    const backLink = $(".return2feed a", root);
    if (backLink) backLink.addEventListener("click", (e) => {
      if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey)
        writeTrail(navTrail.slice(0, -1));   // same-tab navigation up: pop the trail so it doesn't loop back
    });
    wireDetailProductLinks(P);
    $$(".opt-seg button", root).forEach((b) => b.addEventListener("click", () => { build = b.dataset.opt; qty = 1; updateVariant(); }));
    wireSlider();
    $(".pe-arrow.prev", root).addEventListener("click", () => goto(slide - 1));
    $(".pe-arrow.next", root).addEventListener("click", () => goto(slide + 1));
    $$(".pe-qty button", root).forEach((b) => b.addEventListener("click", () => {
      const v = variantById(P, build);
      const maxQty = variantMaxQuantity(P.id, build);
      qty = Math.min(maxQty, Math.max(1, qty + (+b.dataset.q)));
      $(".pe-qty span", root).textContent = String(qty);
      if (buyable(v)) $(".pe-buy", root).innerHTML = "<span>" + STATUS[statusOf(v)].cta + "</span><span>" + money(v.price * qty) + "</span>";
    }));
    $(".pe-buy", root).addEventListener("click", () => {
      const v = variantById(P, build);
      if (buyable(v)) addToCart(P.id, build, qty);
      else openWaitlist();
    });
  }
  /* drag (or tap) across the segmented control to choose a build */
  function wireSlider() {
    const seg = $(".opt-seg", root); if (!seg) return;
    const pickAt = (x) => {
      let pick = null, best = Infinity;
      $$(".opt-seg button", root).forEach((b) => {
        const r = b.getBoundingClientRect();
        if (x >= r.left && x <= r.right) { pick = b; best = -1; }
        else if (best !== -1) { const d = Math.min(Math.abs(x - r.left), Math.abs(x - r.right)); if (d < best) { best = d; pick = b; } }
      });
      if (pick && pick.dataset.opt !== build) { build = pick.dataset.opt; qty = 1; updateVariant(); }
    };
    let dragging = false;
    const move = (e) => { if (dragging) pickAt(e.clientX); };
    const up = () => { dragging = false; seg.classList.remove("dragging"); document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); };
    seg.addEventListener("pointerdown", (e) => { dragging = true; seg.classList.add("dragging"); pickAt(e.clientX); document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); });
  }
  function openWaitlist() {
    const wl = $(".pe-waitlist", root); if (!wl) return;
    track("waitlist_open", { product: P.id, build: build });
    $(".pe-buy", root).style.display = "none";
    const cd = $(".pe-countdown", root);
    if (cd) { stopCountdown(); cd.hidden = true; }
    wl.hidden = false;
    wl.innerHTML = '<form class="pe-wl-form"><input type="email" required placeholder="you@email.com" aria-label="Email for availability notifications"><button type="submit" aria-label="Notify me"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></form>';
    $("input", wl).focus();
    // Escape backs out to the countdown / Notify me button without submitting
    $("input", wl).addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); updateVariant(false); } });
    $(".pe-wl-form", wl).addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $("input", wl), email = (input.value || "").trim();
      if (!email || email.indexOf("@") < 1) { input.focus(); return; }
      track("waitlist_submit", { product: P.id, build: build });
      wl.innerHTML = '<p class="pe-wl-done">Adding you to the list…</p>';   // instant feedback; the request finishes in the background
      // tag with `waitlist` + the product id so this list can be emailed on its own when the kit goes live
      fetch("/api/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, tags: ["waitlist", P.id] }), keepalive: true })
        .then((r) => r.json().catch(() => ({})).then((d) => {
          const joined = r.ok && d && d.ok;
          track(joined ? "waitlist_success" : "waitlist_error", { product: P.id, build: build });
          if (joined) rememberWaitlist(P.id);
          const pendingDrop = variantById(P, build);
          if (joined && countdownTarget(pendingDrop) != null) {
            // back to the ticking countdown, now marked "On the list". New Buttondown signups get a
            // double opt-in email, and an unconfirmed address never receives the launch email.
            updateVariant(false);
            wl.hidden = false;
            wl.innerHTML = '<p class="pe-wl-note">You’re on the list. If you’re new here, confirm the email we just sent so you hear when ' +
              escapeHtml(pendingDrop.launchLabel || "it") + " opens.</p>";
            return;
          }
          wl.innerHTML = joined
            ? '<p class="pe-wl-done">Thanks, you’re on the list. We’ll email you when it’s ready.</p>'
            : '<p class="pe-wl-done">That didn’t go through. Email <a href="mailto:support@theodore.net">support@theodore.net</a> and we’ll add you.</p>';
        }))
        .catch(() => {
          track("waitlist_error", { product: P.id, build: build });
          wl.innerHTML = '<p class="pe-wl-done">Network error. Email <a href="mailto:support@theodore.net">support@theodore.net</a> and we’ll add you.</p>';
        });
    });
  }

  /* Shareable waitlist deep-link: /store/<product>/?join=1[&email=...][&variant=<id>] auto-opens the waitlist
     form on a coming-soon variant and prefills (NEVER submits) the email, so a single link shared on social
     grows the per-product waitlist. No regression when ?join is absent (returns immediately); no-ops on a
     product with no waitlist-eligible variant. The email is prefilled only and scrubbed from the URL after. */
  function maybeAutoWaitlist(p) {
    let params; try { params = new URLSearchParams(location.search); } catch (e) { return; }
    if (params.get("join") !== "1") return;
    const reqId = params.get("variant");
    let target = reqId ? exactVariant(p, reqId) : null;            // ?variant only selects among this product's own ids
    if (!target || buyable(target)) target = buyable(variantById(p, build)) ? null : variantById(p, build);
    if (!target) target = comingSoonVariant(p);
    if (!target) return;                                           // nothing waitlist-eligible -> leave the page normal
    if (target.id !== build) { build = target.id; qty = 1; updateVariant(true); }  // re-select -> repaints the "Join the waitlist" state
    openWaitlist();                                                // reused as-is: hides buy, injects + focuses the form
    const wlHost = root && $(".pe-waitlist", root);
    if (wlHost) { try { wlHost.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) {} }   // mobile: bring the form into view
    const email = (params.get("email") || "").trim();
    if (email && email.indexOf("@") > 0) {                         // prefill ONLY -- user must click submit themselves
      const input = wlHost && $("input", wlHost);
      if (input) { input.value = email.slice(0, 200); input.focus(); }
    }
    params.delete("join"); params.delete("email"); params.delete("variant");   // keep the email out of history / re-shares
    const qs = params.toString();
    try { history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash); } catch (e) {}
  }

  /* ---- cart ---- */
  let cartBtn, drawer, scrim;
  function injectHeaderCart() {
    const inner = document.querySelector(".md-header__inner");
    if (!inner) return;
    if (inner.querySelector(".store-cart-btn")) { cartBtn = inner.querySelector(".store-cart-btn"); updateBadge(); return; }
    const icons = inner.querySelectorAll(".md-header__button.md-icon");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "md-header__button md-icon store-cart-btn";
    btn.setAttribute("aria-label", "Open cart");
    btn.innerHTML = ICON_BAG + '<span class="store-cart-count">0</span>';
    btn.addEventListener("click", function () { track("view_cart"); openCart(); });
    inner.insertBefore(btn, icons[icons.length - 1] || null);
    cartBtn = btn;
  }
  function updateBadge(bump) {
    if (!cartBtn) return;
    const c = cartCount();
    $(".store-cart-count", cartBtn).textContent = String(c);
    cartBtn.classList.toggle("has-items", c > 0);
    if (bump) cartBtn.animate([{ transform: "scale(1)" }, { transform: "scale(0.86)" }, { transform: "scale(1)" }], { duration: 240, easing: "ease" });
  }
  function ensureDrawer() {
    if (drawer) return;
    scrim = document.createElement("div");
    scrim.className = "cart-scrim";
    scrim.addEventListener("click", closeCart);
    drawer = document.createElement("aside");
    drawer.className = "cart-drawer";
    drawer.innerHTML =
      '<div class="cart-head"><h3>Cart</h3><button class="cart-close" type="button" aria-label="Close">' + ICON_CLOSE + "</button></div>" +
      '<div class="cart-items"></div>' +
      '<div class="cart-foot"><div class="cart-subtotal"><span>Subtotal</span><span class="cart-sub-val">$0</span></div>' +
      '<p class="cart-note">Shipping and tax calculated at checkout.</p>' +
      '<p class="cart-error" role="alert" hidden></p>' +
      '<button class="cart-checkout" type="button" disabled>Checkout</button></div>';
    document.body.appendChild(scrim); document.body.appendChild(drawer);
    $(".cart-close", drawer).addEventListener("click", closeCart);
    $(".cart-checkout", drawer).addEventListener("click", checkout);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCart(); });
  }
  function openCart() { if (/^\/store\/(checkout|confirmation)/.test(location.pathname)) return; ensureDrawer(); renderCart(); drawer.classList.add("is-open"); scrim.classList.add("is-open"); }
  function closeCart() { if (drawer) { drawer.classList.remove("is-open"); scrim.classList.remove("is-open"); } }
  function renderCart() {
    ensureDrawer(); updateBadge();
    const items = $(".cart-items", drawer);
    if (!cart.length) { items.innerHTML = '<p class="cart-empty">Your cart is empty.</p><a class="cart-shop-link" href="/store">Go to store</a>'; }
    else {
      items.innerHTML = cart.map((l, i) => {
        const p = getProduct(l.id); if (!p) return "";   // sanitizeCart drops these; this keeps a since-removed product from throwing mid-render
        const v = variantById(p, l.build), hero = carouselUrls(p)[0], gone = !buyable(v);
        return '<div class="cart-line' + (gone ? " cart-line-gone" : "") + '">' + (hero ? '<img class="cart-line-img" src="' + hero + '" alt="">' : '<span class="cart-line-img"></span>') +
          '<div class="cart-line-meta"><div class="cart-line-info"><p class="cart-line-title">' + p.title + '</p><p class="cart-line-variant">' + v.label + (gone ? ' <span class="cart-line-warn">no longer available</span>' : "") + "</p></div>" +
          '<div class="cart-line-qty"><button type="button" data-i="' + i + '" data-q="-1">−</button><span>' + l.qty + '</span><button type="button" data-i="' + i + '" data-q="1">+</button></div></div>' +
          '<div class="cart-line-side"><div class="cart-line-price">' + money((v.price || 0) * l.qty) + '</div><button class="cart-line-remove" type="button" data-rm="' + i + '">remove</button></div></div>';
      }).join("") + '<button class="cart-shop-link" type="button">Continue shopping</button>';
      $$(".cart-line-qty button", items).forEach((b) => b.addEventListener("click", () => setLineQty(+b.dataset.i, cart[+b.dataset.i].qty + (+b.dataset.q))));
      $$("[data-rm]", items).forEach((b) => b.addEventListener("click", () => setLineQty(+b.dataset.rm, 0)));
    }
    $$(".cart-shop-link", items).forEach((el) => el.addEventListener("click", closeCart));
    $(".cart-sub-val", drawer).textContent = money(cartSubtotal());
    $(".cart-checkout", drawer).disabled = !cart.length || unavailableLines().length > 0;
    syncAccCards();   // keep any on-page accessory cards' +/counter in sync with the cart
  }
  function checkout() {
    if (!cart.length) return;
    location.href = "/store/checkout/";   // on-site Payment Element checkout page
  }

  /* ---- on-site checkout page (Stripe Payment Element, styled to match the site) ---- */
  function coLineHTML(l, i) {
    const p = getProduct(l.id); if (!p) return "";
    const v = variantById(p, l.build), hero = carouselUrls(p)[0], gone = !buyable(v), unit = v.price || 0;
    return '<div class="co-line' + (gone ? " co-line-gone" : "") + '">' +
      (hero ? '<img class="co-line-img" src="' + hero + '" alt="">' : '<span class="co-line-img"></span>') +
      '<div class="co-line-mid"><p class="co-line-title">' + p.title + '</p><p class="co-line-variant">' + v.label + (gone ? ' <span class="cart-line-warn">no longer available</span>' : "") + "</p>" +
        '<button class="co-line-remove" type="button" data-rm="' + i + '">remove</button></div>' +
      '<div class="co-line-right"><div class="co-line-price">' + money(unit * l.qty) + "</div>" +
        '<div class="co-line-unit">' + (l.qty > 1 ? l.qty + " &times; " + money(unit) : "&nbsp;") + "</div>" +
        '<div class="co-line-qty"><button type="button" data-i="' + i + '" data-q="-1" aria-label="less">&minus;</button><span>' + l.qty + '</span><button type="button" data-i="' + i + '" data-q="1" aria-label="more">+</button></div>' +
      "</div></div>";
  }
  function coSummaryHTML() {
    return '<div class="co-lines">' + cart.map(coLineHTML).join("") + "</div>" +
      '<hr class="co-rule">' +
      '<form class="co-voucher" novalidate><input type="text" placeholder="Voucher code" aria-label="Voucher code" autocomplete="off"><button type="submit" aria-label="Apply voucher"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></form>' +
      '<p class="co-voucher-msg" hidden></p>' +
      '<hr class="co-rule">' +
      '<div class="co-row"><span>Subtotal</span><span>' + money2(cartSubtotal()) + "</span></div>" +
      '<div class="co-row co-muted"><span>Sales tax</span><span class="co-tax">&mdash;</span></div>' +
      '<div class="co-row co-muted"><span>Shipping</span><span class="co-ship">&mdash;</span></div>' +
      '<hr class="co-rule">' +
      '<div class="co-row co-total-row"><span>Total</span><span class="co-total-val">&mdash;</span></div>';
  }
  function resolvedColor(varName, fallback) {
    try { const t = document.createElement("span"); t.style.cssText = "color:var(" + varName + ");position:absolute;opacity:0;pointer-events:none"; document.body.appendChild(t); const c = getComputedStyle(t).color; t.remove(); return c || fallback; } catch (e) { return fallback; }
  }
  function checkoutAppearance() {
    const dark = isDark();
    // resolve the site's real colors to rgb so Stripe doesn't fall back to its blue-tinted night defaults
    const fg = resolvedColor("--md-default-fg-color", dark ? "rgb(227,227,227)" : "rgb(27,27,31)");
    const bg = resolvedColor("--md-default-bg-color", dark ? "rgb(33,34,38)" : "rgb(255,255,255)");
    const line = dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.14)";
    return {
      theme: dark ? "night" : "stripe",
      variables: {
        fontFamily: '"JetBrains Mono", monospace', fontWeightNormal: "300",
        borderRadius: "14px", colorPrimary: dark ? "#ffffff" : "#000000",
        colorBackground: bg, colorText: fg, colorDanger: "#d64545", spacingUnit: "4px",
      },
      rules: {
        ".Input": { backgroundColor: bg, border: "1.2px solid " + line, boxShadow: "none", color: fg },
        ".Input:focus": { border: "1.2px solid " + fg, boxShadow: "none", outline: "none" },
        ".Tab, .Block, .PickerItem, .CheckboxInput, .CodeInput": { backgroundColor: bg, boxShadow: "none" },
        ".Tab--selected, .Tab--selected:focus": { borderColor: fg },
        ".Label": { fontWeight: "300", opacity: "0.75" },
      },
    };
  }
  function coWireSummary(host) {
    $$(".co-line-qty button", host).forEach((b) => b.addEventListener("click", () => { const i = +b.dataset.i; if (!cart[i]) return; setLineQty(i, cart[i].qty + (+b.dataset.q)); coRefreshSummary(host); }));
    $$(".co-line-remove", host).forEach((b) => b.addEventListener("click", () => { setLineQty(+b.dataset.rm, 0); coRefreshSummary(host); }));
    const vf = $(".co-voucher", host);
    if (vf) vf.addEventListener("submit", (e) => { e.preventDefault(); const input = $("input", vf), m = $(".co-voucher-msg", host); if (!m) return; if (input && !input.value.trim()) { m.hidden = true; return; } m.textContent = "Not an active voucher."; m.hidden = false; });
  }
  function coRefreshSummary(host) {
    if (!cart.length) { location.href = "/store/?cart=open"; return; }   // emptied here -> back to the cart
    $(".co-summary", host).innerHTML = coSummaryHTML();
    coWireSummary(host);
    swapProductImages();
    if (host.__updateSubmit) host.__updateSubmit();   // keep the button label ("Continue to payment" / "Pay $X") correct
    if (host.__recalc) host.__recalc();   // re-price (subtotal + shipping/tax if a US address is set) and sync the PaymentIntent
  }
  async function renderCheckout() {
    const host = $("#checkout"); if (!host) return;
    loadCart();
    if (!cart.length) { host.innerHTML = '<div class="co-empty"><p>Your cart is empty.</p><a class="cart-shop-link" href="/store">Go to store</a></div>'; return; }
    track("begin_checkout", { value: cartSubtotal() * 100 });
    ga4("begin_checkout", { currency: "USD", value: cartSubtotal(), items: cart.map(function (l) { return ga4Item(l.id, l.build, l.qty); }) });
    host.innerHTML =
      '<div class="conf-back-top"><a href="/store/?cart=open" class="co-tocart"><i class="fa-solid fa-arrow-left-long" aria-hidden="true"></i> Cart</a></div>' +
      '<div class="co-grid">' +
        '<aside class="co-summary">' + coSummaryHTML() + "</aside>" +
        '<div class="co-detail">' +
          '<div class="return2feed"><a href="/store/?cart=open" class="co-tocart"><i class="fa-solid fa-arrow-left-long" aria-hidden="true"></i> Cart</a></div>' +
          '<form class="co-pay" id="co-form" novalidate>' +
            '<section class="co-section is-open" data-sec="shipping"><button class="co-section-head" type="button"><span class="co-h">Shipping</span><i class="fa-solid fa-chevron-down co-chev" aria-hidden="true"></i></button><div class="co-section-body"><div id="address-element"></div></div></section>' +
            '<section class="co-section" data-sec="payment"><button class="co-section-head" type="button"><span class="co-h">Payment</span><i class="fa-solid fa-chevron-down co-chev" aria-hidden="true"></i></button><div class="co-section-body">' +
              '<label class="co-field-label" for="co-email">Email for your receipt</label>' +
              '<input class="co-email" id="co-email" type="email" placeholder="you@email.com" autocomplete="email">' +
              '<label class="co-check"><input type="checkbox" id="co-news"><span>Email me occasional updates and offers</span></label>' +
              '<div id="payment-element"></div>' +
            "</div></section>" +
            '<p class="co-error" role="alert" hidden></p>' +
            '<button class="co-submit" type="submit" disabled><span>Pay ' + money(cartSubtotal()) + "</span></button>" +
            '<p class="co-terms">By placing your order you agree to our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</p>' +
          "</form>" +
        "</div>" +
      "</div>";
    coWireSummary(host); swapProductImages();
    const sections = $$(".co-section", host);
    const err = $(".co-error", host), submit = $(".co-submit", host);
    const paymentOpen = () => $('.co-section[data-sec="payment"]', host).classList.contains("is-open");
    let peReady = false, setupReady = false, addrComplete = false, processing = false, curShip = null, lastTotal = null;
    const updateSubmit = () => {
      const sp = submit.querySelector("span");
      if (processing) { if (sp) sp.textContent = "Processing…"; submit.disabled = true; return; }
      const onPay = paymentOpen();
      const amt = lastTotal != null ? lastTotal / 100 : cartSubtotal();
      if (sp) sp.textContent = onPay ? "Pay " + money2(amt) : "Continue to payment";
      submit.disabled = !setupReady || (onPay && (!peReady || !addrComplete));   // can't pay until the Payment Element is ready and a US address gives the final total
    };
    const applyBreakdown = (d) => {
      const noAddr = d.shipping == null;   // no shipping/tax until a US address is entered
      const set = (sel, html, muted) => { const el = $(sel, host); if (!el) return; el.innerHTML = html; const row = el.closest(".co-row"); if (row) row.classList.toggle("co-muted", muted); };
      set(".co-tax", noAddr ? "&mdash;" : money2((d.tax || 0) / 100), noAddr);
      set(".co-ship", noAddr ? "&mdash;" : (d.shipping === 0 ? "Free" : money2(d.shipping / 100)), noAddr);
      const tot = $(".co-total-val", host); if (tot) tot.innerHTML = noAddr ? "&mdash;" : money2(d.total / 100);
      lastTotal = noAddr ? null : d.total;
      updateSubmit();
    };
    const openSection = (name) => { sections.forEach((s) => s.classList.toggle("is-open", s.dataset.sec === name)); updateSubmit(); };
    $$(".co-section-head", host).forEach((h) => h.addEventListener("click", () => openSection(h.parentElement.dataset.sec)));
    host.__updateSubmit = updateSubmit; updateSubmit();   // shipping is open first -> button reads "Continue to payment"
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    const gone = unavailableLines();
    if (gone.length) { fail(gone.map(lineLabel).join(", ") + (gone.length > 1 ? " are" : " is") + " no longer available. Please edit your cart."); return; }
    if (!window.Stripe) { fail("Payment could not load. Please refresh the page."); return; }
    let data;
    try {
      const res = await fetch("/api/payment-intent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.assign({ cart: cart }, evAttribution())) });
      data = await res.json().catch(() => ({}));
      if (!res.ok || !data.clientSecret) { fail(data.item ? lineLabel(data.item) + " is no longer available. Please edit your cart." : (data.error || "Could not start checkout. Please try again.")); return; }
    } catch (e) { fail("Network error. Check your connection and try again."); return; }
    if (!data.publishableKey) { fail("Payment is not fully configured yet."); return; }
    const piId = data.clientSecret.split("_secret_")[0] || "";
    const updateToken = data.updateToken || "";   // proves to the server we created this PI; required to update it
    applyBreakdown(data);   // show the subtotal now; shipping + tax fill in once a US address is entered

    const stripe = window.Stripe(data.publishableKey);
    const elements = stripe.elements({ clientSecret: data.clientSecret, appearance: checkoutAppearance(), fonts: [{ cssSrc: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500&display=swap" }] });
    const addressEl = elements.create("address", { mode: "shipping", allowedCountries: ["US", "CA", "AU", "GB"], autocomplete: { mode: "disabled" } });   // the kits also ship to CA/AU/GB (the server checks the cart); disable search-first autocomplete so all fields show expanded
    addressEl.mount("#address-element");
    const pe = elements.create("payment", { layout: "tabs", wallets: { applePay: "auto", googlePay: "auto" } });   // surface Apple Pay / Google Pay when eligible
    pe.mount("#payment-element");
    pe.on("ready", () => { peReady = true; updateSubmit(); });
    // re-price the order: subtotal always, plus shipping + tax once a US address is known (amount stays server-authoritative)
    const recalc = async () => {
      const emailVal = (($("#co-email", host) || {}).value || "").trim();
      const reqBody = { cart, paymentIntentId: piId, updateToken };
      if (curShip) reqBody.shipping = curShip;
      if (emailVal.indexOf("@") > 0) reqBody.email = emailVal;
      try {
        const r = await fetch("/api/payment-intent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(reqBody) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { fail(d.item ? lineLabel(d.item) + " is no longer available. Please edit your cart." : (d.error || "Could not update your order. Please try again.")); return null; }
        err.hidden = true; applyBreakdown(d);
        try { elements.fetchUpdates(); } catch (e) {}   // keep amount-aware payment methods in sync with the new total
        return d;
      } catch (e) { fail("Network error. Check your connection and try again."); return null; }
    };
    host.__recalc = recalc;
    addressEl.on("change", (e) => {
      addrComplete = !!e.complete;
      if (e.complete && e.value) { curShip = { name: e.value.name, address: e.value.address }; recalc().then((d) => { if (d) openSection("payment"); }); }   // auto-advance once shipping is complete and priced
      else updateSubmit();
    });

    $("#co-form", host).addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!addrComplete) { fail("Add your shipping address to continue."); openSection("shipping"); return; }   // shipping + tax need a US address
      if (!paymentOpen()) { err.hidden = true; openSection("payment"); return; }   // "Continue to payment" -> reveal payment, don't pay yet
      processing = true; updateSubmit(); err.hidden = true;
      const synced = await recalc();   // final server-authoritative total (address + email) before charging
      if (!synced) { processing = false; updateSubmit(); return; }
      const email = (($("#co-email", host) || {}).value || "").trim();
      if ((($("#co-news", host) || {}).checked) && email) { try { fetch("/api/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, tags: ["customer"] }), keepalive: true }); } catch (e3) {} }   // server-side Buttondown signup; keepalive lets it finish across the Stripe redirect (never broadcasts)
      const { error } = await stripe.confirmPayment({ elements, confirmParams: { return_url: location.origin + "/store/confirmation/" } });
      if (error) { processing = false; fail(error.message || "Payment failed. Please try again."); updateSubmit(); }
      // on success Stripe redirects to return_url, where handleCheckoutReturn() clears the cart
    });
    setupReady = true; updateSubmit();   // checkout is fully wired -> enable the button
    const obs = new MutationObserver(() => { try { elements.update({ appearance: checkoutAppearance() }); } catch (e) {} });
    obs.observe(document.body, { attributes: true, attributeFilter: ["data-md-color-scheme"] });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-md-color-scheme"] });
  }

  /* ---- fade-in ---- */
  function reveal() {
    const els = document.querySelectorAll(".intro-section, .store-feed, .legal-section, .footer, .product-card");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { els.forEach((el) => el.classList.add("visible")); return; }
    let i = 0;
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.style.animationDelay = (en.target.classList.contains("product-card") ? (i++ % 6) * 55 : en.target.classList.contains("legal-section") ? 160 : 0) + "ms";
      en.target.classList.add("visible"); io.unobserve(en.target);
    }), { threshold: 0.02, rootMargin: "60px" });
    els.forEach((el) => io.observe(el));
    setTimeout(() => els.forEach((el) => el.classList.add("visible")), 1400);
  }

  /* keep the cart in sync if it changes in another tab */
  window.addEventListener("storage", (e) => { if (e.key === CART_KEY) { loadCart(); renderCart(); } });

  /* re-point already-rendered product images at the right light/dark variant */
  function swapProductImages() {
    $$("img.pc-img, .pe-slide img, img.cart-line-img, img.co-line-img").forEach((img) => {
      const cur = img.getAttribute("src"); if (!cur) return;
      const want = themedUrl(cur);
      if (cur !== want) img.setAttribute("src", want);
      const holder = img.closest(".pe-slide, .pc-imgwrap");   // keep the letterbox color matched to the themed image
      if (holder) { const bg = bgFor(want); if (bg) holder.style.background = bg; }
    });
  }
  let themeObserved = false;
  function setupThemeSwap() {
    if (themeObserved) return;
    themeObserved = true;
    const obs = new MutationObserver(swapProductImages);
    obs.observe(document.body, { attributes: true, attributeFilter: ["data-md-color-scheme"] });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-md-color-scheme"] });
  }

  /* returning from Stripe: ?checkout=cancel reopens the cart (so they can adjust and
     retry), ?checkout=success empties it. The query is then stripped from the URL. */
  /* ---- order confirmation page (Stripe redirects here after a successful payment) ---- */
  const backHome = '<div class="return2feed"><a href="https://teddywarner.com" class="co-tocart"><i class="fa-solid fa-arrow-left-long" aria-hidden="true"></i> Home</a></div>';
  const backStore = '<div class="return2feed"><a href="/store" class="co-tocart"><i class="fa-solid fa-arrow-left-long" aria-hidden="true"></i> Store</a></div>';
  function trackUrl(carrier, tracking) {
    if (!tracking) return "";
    const t = encodeURIComponent(tracking), c = carrier || "";
    if (/usps/i.test(c)) return "https://tools.usps.com/go/TrackConfirmAction?tLabels=" + t;
    if (/ups/i.test(c)) return "https://www.ups.com/track?tracknum=" + t;
    if (/fedex/i.test(c)) return "https://www.fedex.com/fedextrack/?trknbr=" + t;
    return "";
  }
  function timelineHTML(d) {
    const shipped = d.fulfillment === "shipped";
    const steps = [["Ordered", "done"], ["Building", shipped ? "done" : "current"], ["Shipped", shipped ? "current" : "upcoming"], ["Delivered", "upcoming"]];
    // A big order can ship in SEVERAL boxes, each with its own tracking number, so list every parcel.
    // `parcels` falls back to the single carrier/tracking, which keeps a normal order rendering as before.
    const parcels = (d.parcels && d.parcels.length) ? d.parcels : (d.tracking ? [{ box: 1, of: 1, carrier: d.carrier, tracking: d.tracking }] : []);
    const line = (p) => {
      const u = trackUrl(p.carrier, p.tracking);
      const label = p.of > 1 ? "Box " + p.box + " of " + p.of + " - " : "";
      return '<p class="tl-track">' + label + escapeHtml(p.carrier || "") + " - " +
        (u ? '<a href="' + u + '" target="_blank" rel="noopener">' + escapeHtml(p.tracking) + "</a>" : escapeHtml(p.tracking)) + "</p>";
    };
    const note = shipped ? parcels.map(line).join("") : "";
    return '<div class="conf-block"><p class="conf-block-h">Status</p><div class="conf-timeline-h" role="list">' +
      steps.map((s) => '<div class="tl-step tl-' + s[1] + '" role="listitem"><span class="tl-dot"></span><span class="tl-label">' + s[0] + "</span></div>").join("") +
      "</div>" + note + "</div>";
  }
  function confLineHTML(l) {
    l = migratedLine(l);
    const p = getProduct(l.id);
    const hero = p ? carouselUrls(p)[0] : "";
    const v = p ? variantById(p, l.build) : null;
    const title = p ? p.title : l.id;
    const label = v ? v.label : l.build;
    const unit = v ? (v.price || 0) : 0;
    return '<div class="co-line">' +
      (hero ? '<img class="co-line-img" src="' + hero + '" alt="">' : '<span class="co-line-img"></span>') +
      '<div class="co-line-mid"><p class="co-line-title">' + escapeHtml(title) + '</p><p class="co-line-variant">' + escapeHtml(label) + " &times; " + l.qty + "</p></div>" +
      (unit ? '<div class="co-line-right"><div class="co-line-price">' + money(unit * l.qty) + "</div></div>" : "") +
      "</div>";
  }
  function renderOrder(host, d, back) {
    back = back || backHome;
    const b = d.breakdown || {};
    const rows =
      (b.subtotal != null ? '<div class="co-row"><span>Subtotal</span><span>' + money2(b.subtotal / 100) + "</span></div>" : "") +
      (b.tax != null ? '<div class="co-row"><span>Sales tax</span><span>' + money2(b.tax / 100) + "</span></div>" : "") +
      (b.shipping != null ? '<div class="co-row"><span>Shipping</span><span>' + (b.shipping === 0 ? "Free" : money2(b.shipping / 100)) + "</span></div>" : "") +
      '<hr class="co-rule"><div class="co-row co-total-row"><span>Total</span><span>' + money2((b.total != null ? b.total : d.amount) / 100) + "</span></div>";
    const a = d.shipping && d.shipping.address ? d.shipping.address : null;
    // if a product in the order has a project writeup, point at it in the shipping note
    let proj = null;
    (d.items || []).some((it) => { const p = getProduct(migratedLine(it).id); if (p && p.project) { proj = p; return true; } return false; });
    const projNote = proj ? '<p class="conf-note">In the meantime, see how the ' + escapeHtml(proj.title) + ' works: <a href="' + escapeHtml(proj.project) + '">read the project writeup</a></p>' : "";
    const shipBlock = a ? '<div class="conf-block"><p class="conf-block-h">Shipping to</p><p class="conf-addr">' +
      [d.shipping.name, a.line1, a.line2, ((a.city ? a.city + ", " : "") + (a.state || "") + " " + (a.postal_code || "")).trim()].filter(Boolean).map(escapeHtml).join("<br>") +
      '</p><p class="conf-note">Made to order. Allow about a week to build and ship, plus a few days in transit. You’ll get a tracking link by email.</p>' + projNote + '</div>' : "";
    const pay = d.payment, brand = pay && pay.brand ? pay.brand.charAt(0).toUpperCase() + pay.brand.slice(1) : "";
    const payBlock = '<div class="conf-block"><p class="conf-block-h">Payment</p>' +
      (pay && pay.last4 ? '<p class="conf-row2">' + escapeHtml(brand) + " ending in " + escapeHtml(pay.last4) + "</p>" : "") +
      '<p class="conf-row2">Total paid ' + money2((b.total != null ? b.total : d.amount) / 100) + "</p>" +
      (d.email ? '<p class="conf-note">Receipt sent to ' + escapeHtml(d.email) + "</p>" : "") + "</div>";
    host.innerHTML =
      '<div class="conf-back-top">' + back + "</div>" +
      '<div class="co-grid">' +
        '<aside class="co-summary">' +
          '<h2 class="co-h conf-title">' + (d.fulfillment === "shipped" ? "Your order" : "Order confirmed") + "</h2>" +
          '<p class="conf-order">Order #' + escapeHtml(d.orderNo || "") + "</p>" +
          '<div class="co-lines">' + (d.items || []).map(confLineHTML).join("") + '</div><hr class="co-rule">' + rows +
        "</aside>" +
        '<div class="co-detail">' + back + timelineHTML(d) + shipBlock + payBlock +
          '<p class="conf-help">Questions? <a href="mailto:support@theodore.net">support@theodore.net</a></p>' +
        "</div>" +
      "</div>";
    swapProductImages(); reveal();
  }
  function renderMessage(host, msg, noteHtml) {
    host.innerHTML = '<div class="conf-back-top">' + backHome + '</div><div class="co-grid"><aside class="co-summary"><h2 class="co-h conf-title">' + msg + '</h2><p class="conf-note">' +
      (noteHtml || 'If you were charged, a receipt is on its way. Questions? <a href="mailto:support@theodore.net">support@theodore.net</a>') + '</p></aside><div class="co-detail">' + backHome + "</div></div>";
    reveal();
  }
  /* A limited-batch order is only an authorization when Stripe redirects here: the webhook's
     capture gate then reserves a unit and captures it a few seconds later, or cancels the
     authorization if the batch sold out first. Ask again until it settles, so nobody sees
     "Order confirmed" for a frame they didn't get. */
  const CONFIRM_POLL_MS = 2000, CONFIRM_POLL_TRIES = 45;
  const settling = (d) => d && (d.status === "requires_capture" || d.status === "processing");
  async function settledOrder(pi, cs, d) {
    for (let i = 0; i < CONFIRM_POLL_TRIES && settling(d); i++) {
      await new Promise((resolve) => setTimeout(resolve, CONFIRM_POLL_MS));
      try {
        const res = await fetch("/api/order", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pi: pi, cs: cs }) });
        if (res.ok) d = await res.json().catch(() => d);
      } catch (e) {}
    }
    return d;
  }
  function renderLookup(host, note) {
    host.innerHTML =
      '<div class="conf-back-top">' + backStore + "</div>" +
      '<div class="co-grid">' +
        '<aside class="co-summary">' +
          '<h2 class="co-h conf-title">Find your order</h2>' +
          '<p class="conf-note">Enter your order number and the email on your receipt.</p>' +
          '<form class="conf-lookup-form" id="lookup-form" novalidate>' +
            '<label class="co-field-label" for="lk-order">Order number</label>' +
            '<input class="co-email" id="lk-order" type="text" placeholder="e.g. 3TJKLJRPSN" autocomplete="off">' +
            '<label class="co-field-label" for="lk-email">Email</label>' +
            '<input class="co-email" id="lk-email" type="email" placeholder="you@email.com" autocomplete="email">' +
            '<p class="co-error" role="alert"' + (note ? "" : " hidden") + ">" + (note || "") + "</p>" +
            '<button class="co-submit" type="submit"><span>Find order</span></button>' +
          "</form>" +
        "</aside>" +
        '<div class="co-detail">' + backStore +
          '<div class="conf-block"><p class="conf-block-h">Need a hand?</p><p class="conf-row2">Can\'t find your order number? It is the 10-character code on your receipt. Email <a href="mailto:support@theodore.net">support@theodore.net</a> and we will look it up for you.</p></div>' +
          '<div class="conf-block"><p class="conf-block-h">Changed your mind?</p><p class="conf-row2">Kits are made to order, so you can cancel for a full refund any time before yours ships. Email <a href="mailto:returns@theodore.net">returns@theodore.net</a> with your order number.</p></div>' +
        "</div>" +
      "</div>";
    reveal();
    const err = $(".co-error", host), submit = $(".co-submit", host);
    $("#lookup-form", host).addEventListener("submit", async (e) => {
      e.preventDefault();
      const orderNo = (($("#lk-order", host) || {}).value || "").trim(), email = (($("#lk-email", host) || {}).value || "").trim();
      if (!orderNo || email.indexOf("@") < 1) { err.textContent = "Enter your order number and email."; err.hidden = false; return; }
      submit.disabled = true; submit.querySelector("span").textContent = "Finding…"; err.hidden = true;
      try {
        const r = await fetch("/api/order-lookup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderNo, email }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { err.textContent = d.error || "We couldn't find that order."; err.hidden = false; submit.disabled = false; submit.querySelector("span").textContent = "Find order"; return; }
        renderOrder(host, d, backStore);
      } catch (e2) { err.textContent = "Network error. Please try again."; err.hidden = false; submit.disabled = false; submit.querySelector("span").textContent = "Find order"; }
    });
  }
  async function renderConfirmation() {
    const host = $("#confirmation"); if (!host) return;
    const params = new URLSearchParams(location.search);
    const pi = params.get("payment_intent") || "", cs = params.get("payment_intent_client_secret") || "", status = params.get("redirect_status") || "";
    if (!pi || !cs) { renderLookup(host); return; }   // direct visit -> order lookup
    cart = []; saveCart(); updateBadge();   // arrived from a payment; empty the cart
    let d = {}, ok = false;
    try {
      const res = await fetch("/api/order", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pi: pi, cs: cs }) });
      ok = res.ok; d = await res.json().catch(() => ({}));
    } catch (e) {}
    if (!ok) { renderLookup(host, "We couldn't load that order. Look it up below."); return; }
    const help = '<a href="mailto:support@theodore.net">support@theodore.net</a>';
    if (settling(d) && status !== "failed") {
      renderMessage(host, "Confirming your order", "This usually takes a few seconds.");
      d = await settledOrder(pi, cs, d);
    }
    if (d.status === "canceled") {
      const first = (d.items || [])[0], again = first ? "/store/" + encodeURIComponent(migratedLine(first).id) + "/?join=1" : "/store/";
      if (d.soldOut) renderMessage(host, "This batch sold out", "Every unit was claimed before your payment went through, so your card was not charged. The pending hold will drop off your statement in a few days. <a href=\"" + again + "\">Get on the list for the next batch</a>.");
      else renderMessage(host, "Your payment did not go through", "Your card was not charged. Questions? " + help);
      return;
    }
    if (settling(d)) { renderMessage(host, "Your order is still confirming", "You’ll get a receipt by email once it’s confirmed. If none arrives within the hour, email " + help + " with order #" + escapeHtml(d.orderNo || "") + "."); return; }
    if ((status && status !== "succeeded") && d.status !== "succeeded") { renderMessage(host, "Your payment did not complete"); return; }
    // GA4 purchase: transaction_id = the PaymentIntent id, so refreshes of the
    // confirmation page dedupe server-side in GA4 and never double-count revenue.
    // Fire only on a server-confirmed success: an authorized limited-batch order
    // that later loses the race for the last unit must never count.
    if (d.status === "succeeded")
    ga4("purchase", {
      transaction_id: pi, currency: "USD",
      value: ((d.breakdown && d.breakdown.total != null ? d.breakdown.total : d.amount) || 0) / 100,
      shipping: ((d.breakdown && d.breakdown.shipping) || 0) / 100,
      tax: ((d.breakdown && d.breakdown.tax) || 0) / 100,
      items: (d.items || []).map(function (it) { return ga4Item(it.id, it.build, it.qty); })
    });
    renderOrder(host, d);
  }

  /* ---- Meta Shop checkout-URL handoff ----
     Instagram/Facebook Shop product links land on /store/checkout/ with
     ?products=<feedId>:<qty>,<feedId>:<qty> (feed ids are "<productId>-<variantId>"
     exactly as /meta-catalog.csv publishes them) plus params Meta appends
     (utm_*, fbclid, cart_origin, coupon). Per Meta's checkout-URL spec the cart
     is REPLACED, unknown ids are ignored, and nothing price-like is ever read
     from the URL (the backend recomputes all prices). Also accepts the
     hand-shareable ?product=<id>&build=<variant>&qty=N form. All handled params
     are scrubbed afterward so re-shared URLs stay clean. */
  function importCartFromUrl() {
    if (!/^\/store\/checkout(\/|$)/.test(location.pathname)) return;
    if (!PRODUCTS.length) return;   // catalog failed to load: never touch the stored cart on unvalidatable input
    let params; try { params = new URLSearchParams(location.search); } catch (e) { return; }
    const spec = params.get("products"), one = params.get("product");
    if (!spec && !one) return;
    const lines = [];
    const feedLine = (fid, qty) => {
      // Product ids themselves contain hyphens (avian-visitors vs avian-visitors-parts),
      // so resolve against the LONGEST product id that prefixes the feed id.
      let best = null;
      PRODUCTS.forEach((p) => {
        const pid = String(p.id || "");
        if ((fid === pid || fid.indexOf(pid + "-") === 0) && (!best || pid.length > best.length)) best = pid;
      });
      if (!best) return;
      lines.push({ id: best, build: fid === best ? "" : fid.slice(best.length + 1), qty });
    };
    if (spec) {
      spec.split(",").forEach((entry) => {
        const at = entry.lastIndexOf(":");   // qty sits after the LAST colon
        const fid = (at < 0 ? entry : entry.slice(0, at)).trim();
        const qty = at < 0 ? 1 : Math.floor(Number(entry.slice(at + 1)));
        if (fid) feedLine(fid, isFinite(qty) && qty > 0 ? qty : 1);
      });
    } else {
      const qty = Math.floor(Number(params.get("qty") || 1));
      lines.push({ id: String(one), build: String(params.get("build") || ""), qty: isFinite(qty) && qty > 0 ? qty : 1 });
    }
    lines.forEach((l) => { if (!l.build) { const p = getProduct(l.id); l.build = String((p && p.defaultBuild) || ""); } });
    // validate + clamp, then drop unbuyable variants (coming-soon/sold-out): a link
    // to something that can't be purchased must not displace a purchasable cart.
    const next = sanitizeCart(lines).filter((l) => { const p = getProduct(l.id); const v = p && variantById(p, l.build); return v && buyable(v); });
    if (!next.length) { /* nothing purchasable resolved -- leave the cart alone */ }
    else if (one && !spec) {
      // Hand-shared single-product links MERGE (a shopper's built-up cart survives
      // clicking a posted link); only the Meta ?products= handoff replaces, per spec.
      next.forEach((l) => { const ex = cart.find((c) => c.id === l.id && c.build === l.build); if (ex) ex.qty = Math.min(ex.qty + l.qty, variantMaxQuantity(l.id, l.build)); else cart.push(l); });
      saveCart();
    } else { cart = next; saveCart(); }
    ["products", "product", "build", "qty", "coupon", "cart_origin", "fbclid",
     "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach((k) => params.delete(k));
    const qs = params.toString();
    try { history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash); } catch (e) {}
  }

  function handleCheckoutReturn() {
    let params;
    try { params = new URLSearchParams(location.search); } catch (e) { return; }
    const c = params.get("checkout"), openCartParam = params.get("cart") === "open";
    if (!c && !openCartParam) return;
    if (c === "success") { cart = []; saveCart(); renderCart(); }
    else if (c === "cancel" || openCartParam) { openCart(); }
    params.delete("checkout"); params.delete("session_id"); params.delete("cart");
    const qs = params.toString();
    try { history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash); } catch (e) {}
  }

  // On a legal page (privacy/terms/returns), if the visitor came from checkout, point
  // the back arrow at Checkout instead of the store.
  function setupLegalBackLink() {
    if (["/privacy", "/terms", "/returns"].indexOf(location.pathname.replace(/\/$/, "")) < 0) return;
    let ref; try { ref = new URL(document.referrer); } catch (e) { return; }
    if (ref.origin !== location.origin || ref.pathname.indexOf("/store/checkout") !== 0) return;
    const link = $(".return2feed a"); if (!link) return;
    link.setAttribute("href", "/store/checkout/");
    link.innerHTML = link.innerHTML.replace("Store", "Checkout");
  }

  function init() {
    PRODUCTS = (typeof window !== "undefined" && Array.isArray(window.STORE_PRODUCTS)) ? window.STORE_PRODUCTS : [];
    DARK_IMAGES = {};
    (Array.isArray(window.STORE_DARK_IMAGES) ? window.STORE_DARK_IMAGES : []).forEach((u) => { DARK_IMAGES[u] = true; });
    IMAGE_BG = (window.STORE_IMAGE_BG && typeof window.STORE_IMAGE_BG === "object") ? window.STORE_IMAGE_BG : {};
    // Inventory starts fail closed for finite variants, but it must never delay
    // ordinary product rendering or interaction. Refresh only affected surfaces
    // after the bounded authority read succeeds.
    const inventoryRefresh = loadInventoryAvailability();
    evInit(); injectHeaderCart(); loadCart(); importCartFromUrl(); ensureDrawer(); renderCart();
    if ($("#store-grid")) wireStoreFilter();
    else if ($("#product-detail")) {
      const p = getProduct($("#product-detail").dataset.product);
      const legacyTarget = p ? legacyAvianKitDetailTarget(p.id, location.search, location.hash) : "";
      if (legacyTarget) { try { location.replace(legacyTarget); } catch (e) { location.href = legacyTarget; } return; }
      if (p) renderDetail(p); reveal();
    }
    else if ($("#checkout")) { renderCheckout(); reveal(); }
    else if ($("#confirmation")) { renderConfirmation(); }   // renderConfirmation() calls reveal() itself
    else reveal();
    setupThemeSwap();
    handleCheckoutReturn();
    setupLegalBackLink();
    void inventoryRefresh.then((ready) => {
      if (!ready) { if (!INVENTORY_READY) retryInventory(1); return; }
      reconcileCartToInventory();
      refreshInventorySurfaces();
    });
  }
  /* A failed availability read leaves finite variants fail-closed as "Sold out". Retry a few
     times so a brief blip (say, the rush at a drop) doesn't read as a sellout until a reload. */
  function retryInventory(attempt) {
    setTimeout(() => {
      void loadInventoryAvailability().then((ready) => {
        if (ready) { reconcileCartToInventory(); refreshInventorySurfaces(); }
        else if (!INVENTORY_READY && attempt < 3) retryInventory(attempt + 1);
      });
    }, 3000 * attempt);
  }
  let booted = false;
  function boot() { if (booted) return; booted = true; void init(); }
  // Boot as soon as this (deferred) script runs so the checkout summary is painted
  // before the cross-document view-transition snapshot. document$ / DOMContentLoaded
  // stay as fallbacks; the guard makes init run exactly once.
  if (typeof window.document$ !== "undefined" && window.document$.subscribe) window.document$.subscribe(boot);
  if (document.readyState !== "loading") boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
