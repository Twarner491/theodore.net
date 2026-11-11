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
  const GIFT_KEY = "store:gift:v1";
  function giftDraft() {
    try { const d = JSON.parse(sessionStorage.getItem(GIFT_KEY)); return d && d.gift === true ? { gift: true, giftFrom: typeof d.giftFrom === "string" ? d.giftFrom.slice(0, 160) : "" } : { gift: false, giftFrom: "" }; }
    catch (_) { return { gift: false, giftFrom: "" }; }
  }
  function saveGiftDraft(gift) {
    try { if (gift.gift) sessionStorage.setItem(GIFT_KEY, JSON.stringify(gift)); else sessionStorage.removeItem(GIFT_KEY); } catch (_) {}
  }
  let localRecovery = null;
  let recoveryBootstrapPending = false;
  let recoveryBootstrapReady = null;
  const recoveryEventBuffer = [];
  function recordRecoveryEvent(type, extra) {
    if (localRecovery) localRecovery.recordEvent(type, extra);
    else if (recoveryBootstrapPending && recoveryEventBuffer.length < 50)
      recoveryEventBuffer.push({ type, extra: extra || {} });
  }
  function recordRecoveryCart(value, type = "cart_updated") {
    if (localRecovery) localRecovery.recordCart(value, type);
    else recordRecoveryEvent(type, { cart: value.map((line) => ({ id: line.id, build: line.build, qty: line.qty })) });
  }

  const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 6 18 18M18 6 6 18"/></svg>';
  // Font Awesome Free 7.1.0 (CC BY 4.0), from Material's bundled icon set.
  // Inline paths keep navigation and product placeholders independent of the remote kit.
  const STORE_ICON_PATHS = {
    "arrow-left-long": [576, "M9.4 233.4c-12.5 12.5-12.5 32.8 0 45.3l128 128c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L109.3 288H544c17.7 0 32-14.3 32-32s-14.3-32-32-32H109.3l73.4-73.4c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-128 128z"],
    "chevron-down": [448, "M201.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L224 338.7 54.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"],
    "chevron-left": [320, "M9.4 233.4c-12.5 12.5-12.5 32.8 0 45.3l192 192c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L77.3 256 246.6 86.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-192 192z"],
    "chevron-right": [320, "M311.1 233.4c12.5 12.5 12.5 32.8 0 45.3l-192 192c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3L243.2 256 73.9 86.6c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l192 192z"],
    "cube": [512, "M224.3-2.5c19.8-11.4 44.2-11.4 64 0L464.2 99c19.8 11.4 32 32.6 32 55.4v203c0 22.9-12.2 44-32 55.4L288.3 514.5a64.16 64.16 0 0 1-64 0L48.5 413c-19.8-11.4-32-32.6-32-55.4v-203c0-22.9 12.2-44 32-55.4zm207.8 360V191.4l-143.8 83v166.1z"],
    "cubes": [512, "M284-1.3c-17.3-10-38.7-10-56 0l-84.2 48.6c-17.3 10-28 28.5-28 48.5v101.9l-88.3 51c-17.3 10-28 28.5-28 48.5v97.3c0 20 10.7 38.5 28 48.5l84.3 48.6c17.3 10 38.7 10 56 0l88.3-51 88.3 51c17.3 10 38.7 10 56 0l84.1-48.6c17.3-10 28-28.5 28-48.5v-97.3c0-20-10.7-38.5-28-48.5l-88.3-51V95.8c0-20-10.7-38.5-28-48.5zm-52 293.9v106.5l-88.3 51c-1.2.7-2.6 1.1-4 1.1V345.9zm231.4.6c.7 1.2 1.1 2.6 1.1 4v97.3c0 2.9-1.5 5.5-4 6.9L376.2 450c-1.2.7-2.6 1.1-4 1.1V345.8zM348.3 95.8v101.9L256 251V144.5l91.2-52.6c.7 1.2 1.1 2.6 1.1 4z"],
    "screwdriver-wrench": [576, "M70.8-6.7c5.4-5.4 13.8-6.2 20.2-2l118.9 79.2c8.9 5.9 14.2 15.9 14.2 26.6v49.6l90.8 90.8c33.3-15 73.9-8.9 101.2 18.5l126.1 126.1c18.7 18.7 18.7 49.1 0 67.9l-60.1 60.1c-18.7 18.7-49.1 18.7-67.9 0L288.1 384c-27.4-27.4-33.5-67.9-18.5-101.2L178.8 192h-49.6c-10.7 0-20.7-5.3-26.6-14.2L23.4 58.9c-4.2-6.3-3.4-14.8 2-20.2zm145 303.5c-6.3 36.9 2.3 75.9 26.2 107.2l-94.9 95c-28.1 28.1-73.7 28.1-101.8 0s-28.1-73.7 0-101.8l135.4-135.5 35.2 35.1zM384.1 0c20.1 0 39.4 3.7 57.1 10.5 10 3.8 11.8 16.5 4.3 24.1l-56.7 56.7c-3 3-4.7 7.1-4.7 11.3V144c0 8.8 7.2 16 16 16h41.4c4.2 0 8.3-1.7 11.3-4.7l56.7-56.7c7.6-7.5 20.3-5.7 24.1 4.3 6.8 17.7 10.5 37 10.5 57.1 0 43.2-17.2 82.3-45 111.1L450 222c-33.1-33-78.5-45.7-121.1-38.4l-56.8-56.8V97.1l-.2-5c-.8-12.4-4.4-24.3-10.5-34.9C290.8 22.2 334.8 0 384.1-.1z"],
    "pen-nib": [512, "m368.5 18.3-50.1 50.1 125.3 125.3 50.1-50.1c21.9-21.9 21.9-57.3 0-79.2l-46.1-46.1c-21.9-21.9-57.3-21.9-79.2 0m-89.2 78.9-.5.1-144.1 43.2c-19.9 6-35.7 21.2-42.3 41L3.8 445.8c-2.9 8.7-1.9 18.2 2.5 26l155.4-155.4c-1.1-4-1.6-8.1-1.6-12.4 0-26.5 21.5-48 48-48s48 21.5 48 48-21.5 48-48 48c-4.3 0-8.5-.6-12.4-1.6L40.3 505.7c7.8 4.4 17.2 5.4 26 2.5l264.3-88.6c19.7-6.6 35-22.4 41-42.3l43.2-144.1.1-.5L279.4 97.2z"],
    "image": [448, "M64 32C28.7 32 0 60.7 0 96v320c0 35.3 28.7 64 64 64h320c35.3 0 64-28.7 64-64V96c0-35.3-28.7-64-64-64zm64 80a48 48 0 1 1 0 96 48 48 0 1 1 0-96m144 112c8.4 0 16.1 4.4 20.5 11.5l88 144c4.5 7.4 4.7 16.7.5 24.3S368.7 416 360 416H88c-8.9 0-17.2-5-21.3-12.9s-3.5-17.5 1.6-24.8l56-80c4.5-6.4 11.8-10.2 19.7-10.2s15.2 3.8 19.7 10.2l26.4 37.8 61.4-100.5c4.4-7.1 12.1-11.5 20.5-11.5z"],
  };
  function storeIcon(name, classes = "") {
    const icon = STORE_ICON_PATHS[name] || STORE_ICON_PATHS.cube;
    return '<svg class="store-icon' + (classes ? ' ' + classes : '') + '" viewBox="0 0 ' + icon[0] + ' 512" fill="currentColor" aria-hidden="true" focusable="false"><path d="' + icon[1] + '"/></svg>';
  }
  function productIcon(classes) {
    const name = String(classes || '').split(/\s+/).map((c) => c.replace(/^fa-/, '')).find((c) => Object.hasOwn(STORE_ICON_PATHS, c));
    return storeIcon(name || 'cube');
  }
  const ICON_BAG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6h-2c0-2.8-2.2-5-5-5S7 3.2 7 6H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2m-7-3c1.7 0 3 1.3 3 3H9c0-1.7 1.3-3 3-3m7 17H5V8h14zm-7-8c-1.7 0-3-1.3-3-3H7c0 2.8 2.2 5 5 5s5-2.2 5-5h-2c0 1.7-1.3 3-3 3"/></svg>';

  /* product data is generated from docs/store/*.md frontmatter by hooks/store_products.py and loaded as window.STORE_PRODUCTS; populated in init() */
  let PRODUCTS = [];
  let INVENTORY_READY = false;
  let INVENTORY_LOADING = false;
  let INVENTORY_ROWS = Object.create(null);
  const INVENTORY_TIMEOUT_MS = 2500;
  let PRODUCTION_BATCH_ROWS = Object.create(null);
  let productionBatchLoading = false;
  let productionBatchRead = null;
  let batchExposure = null;
  let batchExposureSession = null;
  const batchExposureSeen = new Set();
  const BATCH_EXPOSURE_KEY = "store:batch-exposures:v1";
  const BATCH_EXPERIMENT = "avian-count-v1";
  const COUNT_EXPERIMENT_ENABLED = true;
  let batchExperimentIdentity;

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
    loading:    { sell: false, cta: "Checking availability", tag: "Checking availability" },
    unavailable: { sell: false, cta: "Check availability", tag: "Availability unavailable" },
    paused:     { sell: false, cta: "Orders paused", tag: "Orders paused" },
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
  const productionBatchGroupOf = (v) => v && v.productionBatchGroup === "avian-visitors" ? v.productionBatchGroup : "";
  const productionBatchOf = (v) => PRODUCTION_BATCH_ROWS[productionBatchGroupOf(v)] || null;
  function cartVariantLabelHTML(v) {
    const group = productionBatchGroupOf(v);
    if (!group) return escapeHtml(v.label);
    const row = productionBatchOf(v);
    return '<span data-production-batch-label="' + group + '" data-variant-label="' + escapeHtml(v.label) + '">' +
      escapeHtml(row ? "Batch " + row.ordinal : v.label) + '</span>';
  }
  function refreshCartBatchLabels() {
    // This is the current public batch, not a reservation. Paid allocations are
    // rendered separately on the receipt. Never remount payment fields here.
    $$("[data-production-batch-label]").forEach((label) => {
      const row = PRODUCTION_BATCH_ROWS[label.dataset.productionBatchLabel];
      label.textContent = row ? "Batch " + row.ordinal : label.dataset.variantLabel;
    });
  }
  function productionBatchHTML(v) {
    const row = productionBatchOf(v);
    if (!row) return "";
    const assignment = batchExperimentAssignment();
    const concealed = !COUNT_EXPERIMENT_ENABLED || (assignment && assignment.arm === "label");
    return '<span class="pe-batch-label' + (concealed ? ' pe-batch-label--solo' : '') + '">Batch ' + row.ordinal + '</span><span class="pe-batch-remaining' +
      (concealed ? ' pe-batch-remaining--concealed" aria-hidden="true' : '') + '">' +
      row.remaining + (row.remaining === 1 ? ' frame remaining' : ' frames remaining') + '</span>';
  }
  function batchAvailabilityText(v, product) {
    const total = v && Number.isSafeInteger(v.batchSize) && v.batchSize > 0 ? v.batchSize : 0;
    if (!total) return v && typeof v.batchLabel === "string" ? v.batchLabel : "";
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
    return remaining === null ? "" : (v.batchLabel ? v.batchLabel + ", " + remaining : remaining + " of " + total) + " remaining";
  }
  const statusOf = (v) => {
    const configured = configuredStatusOf(v);
    if (!STATUS[configured].sell) return configured;
    if (launchPending(v)) return "comingSoon";
    const production = productionBatchOf(v);
    if (production && production.paused) return "paused";
    const sku = inventorySkuOf(v);
    if (sku && (!INVENTORY_READY || !INVENTORY_ROWS[sku] || INVENTORY_ROWS[sku].soldOut)) {
      // An explicitly marked, unpublished product can show its finished price/CTA on
      // localhost before D1 is provisioned. Production and checkout remain fail-closed:
      // DEV_SHOW_UNPUBLISHED is host-bound, and unpublished products never enter the
      // trusted server catalog generated by hooks/store_products.py.
      if (DEV_SHOW_UNPUBLISHED && v.localPreview === true) return configured;
      return !INVENTORY_READY || !INVENTORY_ROWS[sku]
        ? (INVENTORY_LOADING ? "loading" : "unavailable") : "soldout";
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
  let IMAGE_SOURCES = {};
  const bgFor = (u) => (IMAGE_SOURCES[u] && IMAGE_SOURCES[u].background) || IMAGE_BG[u] || "";
  const carouselUrls = (p) => (p.images || []).map((f) => themedUrl(p.imageBase + f));
  const IMAGE_SIZES = {
    grid: "(max-width: 695px) 90vw, (max-width: 860px) 44vw, 30vw",
    gallery: "(max-width: 860px) 90vw, 45vw",
    accessory: "(max-width: 700px) 44vw, 240px",
    thumbnail: "64px",
  };
  function imageSource(url) {
    const record = IMAGE_SOURCES[url], sources = record && record.sources;
    if (!Array.isArray(sources) || !sources.length) return { src: url };
    return { src: sources[0].url, srcset: sources.map((source) => source.url + " " + source.width + "w").join(", "),
      width: record.width, height: record.height };
  }
  function productImageAttrs(url, size, deferred = false) {
    const source = imageSource(url);
    const identity = ' data-store-image="' + escapeHtml(toLight(url)) + '"';
    const dimensions = source.width ? ' width="' + source.width + '" height="' + source.height + '"' : "";
    const responsive = ' sizes="' + escapeHtml(IMAGE_SIZES[size] || size) + '" decoding="async"' + dimensions;
    if (deferred) return identity + responsive + ' data-store-image-pending="true"';
    return ' src="' + escapeHtml(source.src) + '"' + (source.srcset ? ' srcset="' + escapeHtml(source.srcset) + '"' : "") + identity + responsive;
  }
  function loadProductImage(img) {
    if (!img) return;
    const original = img.getAttribute("data-store-image") || img.getAttribute("src");
    if (!original) return;
    const source = imageSource(themedUrl(original));
    if (source.srcset) {
      if (img.getAttribute("srcset") !== source.srcset) img.setAttribute("srcset", source.srcset);
    } else img.removeAttribute("srcset");
    if (img.getAttribute("src") !== source.src) img.setAttribute("src", source.src);
    img.removeAttribute("data-store-image-pending");
  }
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
  const waitlistEligible = (v) => v != null && (statusOf(v) === "comingSoon" || statusOf(v) === "soldout");
  const comingSoonVariant = (p) => (p.variants || []).find(waitlistEligible) || null;

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
    const production = productionBatchOf(v);
    if (production && !production.paused) return Math.min(limit, production.remaining);
    return Math.max(1, limit);
  }
  function canIncreaseQuantity(id, build) {
    const p = getProduct(id), v = p && exactVariant(p, build), production = productionBatchOf(v);
    return buyable(v) && (!productionBatchGroupOf(v) || !!production) && cartQtyOf(id, build) < variantMaxQuantity(id, build);
  }
  function checkoutIsBusy() { const host = $("#checkout"); return !!(host && host.__checkoutBusy && host.__checkoutBusy()); }
  function detailQuantityLimit() {
    const v = P && exactVariant(P, build), limit = P ? variantMaxQuantity(P.id, build) : 1;
    return Math.max(1, productionBatchGroupOf(v) ? limit - cartQtyOf(P.id, build) : limit);
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
  function currentCartIdentity(id, build) {
    const identity = migrateCartIdentity(id, build);
    const product = getProduct(identity.id);
    // Only an unbound shopping cart moves to the current offering. Historical
    // receipts and existing payment bindings retain their original batch ids.
    if (identity.id === "avian-visitors" && ["assembled", "assembled-batch-2"].indexOf(identity.build) >= 0 &&
        product && !exactVariant(product, identity.build) && exactVariant(product, "assembled-continuous"))
      return { id: identity.id, build: "assembled-continuous" };
    return identity;
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
      const migrated = currentCartIdentity(id, build); id = migrated.id; build = migrated.build;
      let qty = Math.floor(Number(l.qty));
      if (!id || !isFinite(qty) || qty <= 0) return;
      qty = Math.min(qty, known ? variantMaxQuantity(id, build) : MAX_QTY);
      if (qty <= 0) return;
      if (known) { const p = getProduct(id); if (!p || !(p.variants || []).some((v) => v.id === build)) return; }
      const key = id + "\u0000" + build;
      if (seen[key] != null) { out[seen[key]].qty = Math.min(out[seen[key]].qty + qty, known ? variantMaxQuantity(id, build) : MAX_QTY); return; }
      seen[key] = out.length; out.push({ id, build, qty });
    });
    return out;
  }
  const saveCart = () => { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {} if (!cart.length) saveGiftDraft({ gift: false }); recordRecoveryCart(cart); };
  const loadCart = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(CART_KEY));
      const hadLegacyIdentity = Array.isArray(raw) && raw.some((l) => l && (() => {
        const current = currentCartIdentity(l.id, l.build);
        return current.id !== l.id || current.build !== l.build;
      })());
      cart = sanitizeCart(raw);
      if (hadLegacyIdentity) saveCart();   // make the one-time identity migration persistent
    } catch (e) { cart = []; }
    if (!cart.length) saveGiftDraft({ gift: false });
    recordRecoveryCart(cart, "cart_observed");
  };
  const cartCount = () => cart.reduce((n, l) => n + l.qty, 0);
  const cartSubtotal = () => cart.reduce((s, l) => { const p = getProduct(l.id); if (!p) return s; const v = variantById(p, l.build); return s + (v.price ? v.price * l.qty : 0); }, 0);
  function addToCart(id, build, qty) {
    if (checkoutIsBusy() || !canIncreaseQuantity(id, build)) return;
    const ex = cart.find((l) => l.id === id && l.build === build);
    const added = Math.min(Math.max(0, Math.floor(qty)), variantMaxQuantity(id, build) - (ex ? ex.qty : 0));
    if (!Number.isFinite(added) || added <= 0) return;
    if (ex) ex.qty += added; else cart.push({ id, build, qty: added });
    metaItem("AddToCart", id, build, added);
    saveCart(); renderCart(); updateBadge(true); openCart();
    var atcUnit = evItemValue(getProduct(id), build); track("add_to_cart", { product: id, build: build, qty: added, value: atcUnit != null ? atcUnit * added : null });
    var ga4Qty = added, ga4Line = ga4Item(id, build, ga4Qty);
    ga4("add_to_cart", { currency: "USD", value: (ga4Line.price || 0) * ga4Qty, items: [ga4Line] });
  }
  function setLineQty(i, qty) {
    const line = cart[i];
    if (!line || checkoutIsBusy() || !Number.isFinite(qty) || (qty > line.qty && !canIncreaseQuantity(line.id, line.build))) return;
    qty = Math.min(Math.floor(qty), variantMaxQuantity(line.id, line.build));
    const added = qty - line.qty;
    if (qty <= 0) cart.splice(i, 1); else line.qty = qty;
    if (added > 0) metaItem("AddToCart", line.id, line.build, added);
    saveCart(); renderCart();
  }

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
    INVENTORY_LOADING = true;
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
    } finally {
      INVENTORY_LOADING = false;
    }
  }

  async function loadProductionBatches() {
    if (productionBatchRead) return productionBatchRead;
    const groups = [...new Set(PRODUCTS.filter((p) => p.published)
      .flatMap((p) => (p.variants || []).map(productionBatchGroupOf)).filter(Boolean))];
    if (!groups.length) return false;
    productionBatchLoading = true;
    productionBatchRead = (async () => {
      try {
        await Promise.all(groups.map(async (group) => {
          const controller = typeof AbortController === "function" ? new AbortController() : null;
          let timer = null;
          try {
            const timeout = new Promise((_, reject) => {
              timer = setTimeout(() => {
                if (controller) controller.abort();
                reject(new Error("production batch timeout"));
              }, INVENTORY_TIMEOUT_MS);
            });
            const request = (async () => {
              const response = await fetch("/api/production-batch?group=" + encodeURIComponent(group), {
                cache: "no-store", ...(controller ? { signal: controller.signal } : {}),
              });
              const row = await response.json();
              if (!response.ok || !row || row.group !== group || !Number.isSafeInteger(row.ordinal) || row.ordinal < 1 ||
                  !Number.isSafeInteger(row.remaining) || row.remaining < 0 || typeof row.paused !== "boolean")
                throw new Error("invalid production batch response");
              return { group, ordinal: row.ordinal, remaining: row.remaining, paused: row.paused };
            })();
            PRODUCTION_BATCH_ROWS[group] = await Promise.race([request, timeout]);
          } catch (_) {
            // Preserve the saved cart on a read failure, but do not allow quantity
            // increases without a current ledger projection. Rendering stays immediate.
            delete PRODUCTION_BATCH_ROWS[group];
          } finally { if (timer != null) clearTimeout(timer); }
        }));
      } finally { productionBatchLoading = false; productionBatchRead = null; }
      return true;
    })();
    return productionBatchRead;
  }

  function reconcileCartToProductionBatches() {
    if (checkoutIsBusy()) return false;
    const before = JSON.stringify(cart);
    cart = cart.map((line) => {
      const product = getProduct(line.id), variant = product && exactVariant(product, line.build), row = productionBatchOf(variant);
      return row && !row.paused ? { ...line, qty: Math.min(line.qty, variantMaxQuantity(line.id, line.build)) } : line;
    }).filter((line) => line.qty > 0);
    if (JSON.stringify(cart) === before) return false;
    saveCart(); return true;
  }
  function syncLineQuantityControls(host, busy = false) {
    $$(".co-line-qty button, .co-line-remove[data-rm]", host).forEach((button) => {
      const line = cart[+button.dataset.i];
      button.disabled = busy || (button.dataset.q === "1" && (!line || !canIncreaseQuantity(line.id, line.build)));
    });
  }
  function refreshProductionBatchSurfaces() {
    const host = $("#checkout");
    // Accepted/processing payment quantities never change underneath confirmation.
    if (checkoutIsBusy()) { refreshCartBatchLabels(); return; }
    const changed = reconcileCartToProductionBatches();
    if (host) {
      refreshCartBatchLabels();
      if (changed && $(".co-summary", host)) coRefreshSummary(host);
      else { syncLineQuantityControls(host); if (host.__paintVoucher) host.__paintVoucher(); }
    } else if ($("#store-grid")) renderGrid();
    else if ($("#product-detail") && root && P) { updateVariant(false); renderAccessories(P); }
    else refreshCartBatchLabels();
    renderCart();
  }

  async function reconcileProductionQuantityLimit(data, isCurrent) {
    if (!data || data.code !== "production_quantity_limit" || !data.item ||
        data.item.id !== "avian-visitors" || data.item.build !== "assembled-continuous" ||
        !Number.isSafeInteger(data.maxQuantity) || data.maxQuantity < 0 ||
        !Number.isSafeInteger(data.currentOrdinal) || data.currentOrdinal < 1) return false;
    await loadProductionBatches();
    if (!isCurrent() || checkoutIsBusy()) return false;
    const before = JSON.stringify(cart), line = cart.find((l) => l.id === data.item.id && l.build === data.item.build);
    const product = getProduct(data.item.id), variant = product && exactVariant(product, data.item.build), row = productionBatchOf(variant);
    // A newer rollover supersedes the rejection. Otherwise the signed quote's
    // limit is still authoritative if the public availability read fails.
    if (line && !(row && row.ordinal > data.currentOrdinal)) {
      line.qty = Math.min(line.qty, data.maxQuantity);
      cart = cart.filter((l) => l.qty > 0);
    }
    reconcileCartToProductionBatches();
    const changed = before !== JSON.stringify(cart), rolledOver = !!(row && row.ordinal > data.currentOrdinal);
    if (changed || rolledOver) {
      if (changed) saveCart();
      renderCart();
      const host = $("#checkout"); if (host && $(".co-summary", host)) coRefreshSummary(host);
    } else refreshProductionBatchSurfaces();
    return changed || rolledOver;
  }

  function refreshProductionBatches() {
    if (!$("#store-grid") && !$("#product-detail") && !$("#checkout") && !(drawer && drawer.classList.contains("is-open"))) return;
    void loadProductionBatches().then((changed) => { if (changed) refreshProductionBatchSurfaces(); });
  }

  function refreshInventorySurfaces() {
    if ($("#store-grid")) renderGrid();
    else if ($("#product-detail") && root && P) {
      updateVariant(false); renderAccessories(P);
      if (INVENTORY_READY) maybeAutoWaitlist(P);
    }
    else if ($("#checkout") && cart.some((line) => {
      const product = getProduct(line.id), variant = product && exactVariant(product, line.build);
      return !!inventorySkuOf(variant);
    })) { void renderCheckout(); }
    else if ($("#checkout")) {
      const host = $("#checkout");
      // Related finite products can become available even when this cart has
      // no finite items. Refresh recommendations without remounting payment.
      if ($(".co-summary", host) && !(host.__checkoutBusy && host.__checkoutBusy())) coRefreshSummary(host);
    }
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
  let evSessionFallback = "";
  function evSess() { let s = ssg(EV_SID); if (!s) { s = evSessionFallback || evRid(); evSessionFallback = s; sss(EV_SID, s); } return s; }
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
  let paidArrivalSent = "";
  function recordPaidArrival() {
    try {
      const attribution = window.TheodorePaidAttribution;
      if (!attribution) return;
      attribution.capture();
      const paidAttribution = attribution.arrival();
      if (!paidAttribution || paidAttribution.last.id === paidArrivalSent) return;
      paidArrivalSent = paidAttribution.last.id;
      const body = JSON.stringify({ anon: evAnon(), session: evSess(), paidAttribution });
      fetch("/api/ad-attribution", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true })
        .then(async (response) => {
          const result = response.ok && await response.json();
          if (result && result.recorded) attribution.acknowledge(paidAttribution.last.id);
          else paidArrivalSent = "";
        }).catch(() => { paidArrivalSent = ""; });
    } catch (_) { /* Optional measurement cannot delay checkout. */ }
  }
  function evInit() {
    try { if (ssg(EV_LAND) == null) sss(EV_LAND, location.pathname.slice(0, 256)); evSource(); } catch (e) {}
    recordPaidArrival();
    try { if (window.TheodoreMetaTracking) window.TheodoreMetaTracking.context(evAnon()); } catch (_) {}
  }
  // expose the session's first-party identity so checkout can stamp it onto the order (attribution join)
  function evAttribution() {
    const context = { anon: evAnon(), source: evSource() };
    try {
      recordPaidArrival();
      const paid = window.TheodorePaidAttribution && window.TheodorePaidAttribution.snapshot();
      if (paid) context.paidAttribution = paid;
    } catch (_) {}
    try {
      const meta = window.TheodoreMetaTracking && window.TheodoreMetaTracking.context(context.anon);
      if (meta) context.metaTracking = meta;
    } catch (_) {}
    return context;
  }
  function evItemValue(p, b) { try { const v = variantById(p, b || (p.defaultBuild || (p.variants[0] || {}).id)); return v && v.price ? v.price * 100 : null; } catch (e) { return null; } }
  /* ---- GA4 ecommerce mirrors: the same moments the first-party beacon tracks,
     emitted as standard gtag ecommerce events so channel/conversion reporting works
     in GA4 without any new
     tracking surface. Material queues its analytics in dataLayer without exposing
     gtag. Without initialized analytics these are silent no-ops and never break
     the store. item_id matches the Meta catalog feed ids ("<product>-<variant>"). ---- */
  function ga4(name, params) {
    if (DEV_SHOW_UNPUBLISHED || (localRecovery && localRecovery.mode === "local")) return;
    try {
      if (window.TheodoreAnalyticsPreference && !window.TheodoreAnalyticsPreference.state().allowed) return;
      if (typeof window.__theodoreAnalyticsParams !== "function") return;
      params = window.__theodoreAnalyticsParams(params);
      if (typeof window.gtag === "function") window.gtag("event", name, params);
      else if (Array.isArray(window.dataLayer) && window.dataLayer.some((command) =>
        command && command[0] === "config" && typeof command[1] === "string" && /^G-[A-Z0-9]+$/i.test(command[1]))) {
        (function () { window.dataLayer.push(arguments); })("event", name, params);
      }
    } catch (e) { /* never breaks the store */ }
  }
  function ga4Item(id, buildId, qty) {
    const identity = migrateCartIdentity(String(id || ""), String(buildId || "")); id = identity.id; buildId = identity.build;
    const p = getProduct(id);
    const b = buildId || ((p && p.defaultBuild) || "");
    const v = p ? variantById(p, b) : null;
    return { item_id: id + "-" + b, item_name: (p && p.title) || id, item_variant: b, price: (v && v.price) || 0, quantity: qty || 1 };
  }
  function metaCatalogItem(id, buildId, quantity) {
    const p = getProduct(id), v = p && exactVariant(p, buildId);
    if (!p || !p.published || !v || !Number.isFinite(v.price) ||
        (p.metaCatalogId && buildId !== p.defaultBuild)) return null;
    return { id: p.metaCatalogId || id + "-" + buildId, quantity, value: v.price * quantity };
  }
  function metaItem(name, id, buildId, quantity) {
    try {
      const item = metaCatalogItem(id, buildId, quantity);
      if (item && window.TheodoreMetaTracking) window.TheodoreMetaTracking.itemEvent(name, item);
    } catch (_) { /* Optional advertising cannot interrupt shopping. */ }
  }

  // Versioned assignment is reproducible from the existing random visitor id.
  // The collector verifies the same unsigned FNV-1a hash; this never authorizes money or stock.
  function batchExperimentArm(anon) {
    if (typeof anon !== "string" || !/^[a-z0-9_-]{8,40}$/i.test(anon)) return null;
    let hash = 2166136261;
    const input = BATCH_EXPERIMENT + ":" + anon;
    for (let i = 0; i < input.length; i++) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619) >>> 0;
    return hash < 0x80000000 ? "label" : "count";
  }
  function batchExperimentAssignment() {
    if (!COUNT_EXPERIMENT_ENABLED) return null;
    if (batchExperimentIdentity !== undefined) return batchExperimentIdentity;
    batchExperimentIdentity = null;
    try {
      const anon = evAnon();
      // Without a persistent id we cannot keep returns in the same arm or join purchases.
      if (localStorage.getItem(EV_AID) !== anon) return null;
      const arm = batchExperimentArm(anon);
      if (arm) batchExperimentIdentity = { experiment: BATCH_EXPERIMENT, arm, anon };
    } catch (_) {}
    return batchExperimentIdentity;
  }

  function track(type, ex) {
    try {
      const batchEvent = type === "batch_view" || type === "batch_exposure";
      if (batchEvent && !COUNT_EXPERIMENT_ENABLED) return;
      if (batchEvent && (!ex || ex.product !== "avian-visitors" || ex.build !== "assembled-continuous" ||
          !Number.isSafeInteger(ex.batch_ordinal) || ex.batch_ordinal < 1 || ex.batch_ordinal > 1000000 ||
          !Number.isSafeInteger(ex.batch_remaining) || ex.batch_remaining < 0 || ex.batch_remaining > 10000)) return;
      const ev = { t: type, a: evAnon(), s: evSess(), src: evSource() };
      if (type === "batch_exposure") {
        if (ex.experiment !== BATCH_EXPERIMENT || !["label", "count"].includes(ex.arm) || ex.arm !== batchExperimentArm(ev.a)) return;
        ev.experiment = ex.experiment; ev.arm = ex.arm;
      }
      const land = ssg(EV_LAND); if (land) ev.l = land;
      let host = ""; try { host = new URL(document.referrer).hostname; } catch (e) {}
      if (host) ev.r = host.slice(0, 128);
      if (ex) { if (ex.product) ev.p = String(ex.product).slice(0, 64); if (ex.build) ev.b = String(ex.build).slice(0, 40); if (ex.qty != null) ev.q = ex.qty; if (ex.value != null && isFinite(ex.value)) ev.v = Math.round(ex.value); }
      if (batchEvent) { ev.batch_ordinal = ex.batch_ordinal; ev.batch_remaining = ex.batch_remaining; }
      else recordRecoveryEvent(type, ex);
      if (localRecovery && localRecovery.mode === "local") return;
      const body = JSON.stringify(ev);
      if (navigator.sendBeacon) navigator.sendBeacon(EV_URL, body);
      else fetch(EV_URL, { method: "POST", headers: { "content-type": "text/plain" }, body: body, keepalive: true }).catch(() => {});
    } catch (e) { /* analytics never breaks the page */ }
  }

  function rememberBatchExposure(key) {
    if (batchExposureSession === null) {
      batchExposureSession = evSess();
      try {
        const saved = JSON.parse(ssg(BATCH_EXPOSURE_KEY));
        if (saved && saved.session === batchExposureSession && Array.isArray(saved.states))
          saved.states.slice(-256).forEach((state) => { if (typeof state === "string" && /^(label|count):\d{1,7}:\d{1,5}$/.test(state)) batchExposureSeen.add(state); });
      } catch (_) {}
    }
    if (batchExposureSeen.has(key)) return false;
    batchExposureSeen.add(key);
    sss(BATCH_EXPOSURE_KEY, JSON.stringify({ session: batchExposureSession, states: [...batchExposureSeen].slice(-256) }));
    return true;
  }

  function observeProductionBatchCounter(element, product, variant) {
    if (batchExposure) batchExposure.observer.disconnect();
    batchExposure = null;
    const row = productionBatchOf(variant), assignment = batchExperimentAssignment();
    if (!element || element.hidden || !row || row.paused || !assignment || !product || product.id !== "avian-visitors" ||
        !variant || variant.id !== "assembled-continuous" || typeof IntersectionObserver !== "function") return;
    // Both arms use the same reserved purchase-area box, including the concealed
    // count in the label arm. Capture this render, not a later ledger response.
    const state = { element, ordinal: row.ordinal, remaining: row.remaining, assignment, observer: null };
    try {
      state.observer = new IntersectionObserver((entries) => {
        try {
          if (batchExposure !== state || document.hidden || element.hidden || !element.isConnected) return;
          if (!entries.some((entry) => entry.target === element && entry.isIntersecting && entry.intersectionRatio >= 1)) return;
          const style = getComputedStyle(element);
          if (style.visibility !== "visible" || style.display === "none" || Number(style.opacity) === 0) return;
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
          // A drawer or sticky header can cover an intersecting element. Do not
          // count that as an exposure to a visible counter.
          const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          if (!top || (top !== element && !element.contains(top))) return;
          if (rememberBatchExposure(state.assignment.arm + ":" + state.ordinal + ":" + state.remaining)) track("batch_exposure", {
            product: product.id, build: variant.id, batch_ordinal: state.ordinal, batch_remaining: state.remaining,
            experiment: state.assignment.experiment, arm: state.assignment.arm,
          });
        } catch (_) { /* missing telemetry must not interrupt shopping */ }
      }, { threshold: 1 });
      batchExposure = state;
      state.observer.observe(element);
    } catch (_) { batchExposure = null; }   // measurement cannot gate the product UI
  }

  function resumeBatchExposure() {
    if (!batchExposure || document.hidden) return;
    // Foregrounding a tab does not necessarily change intersection geometry.
    try {
      batchExposure.observer.unobserve(batchExposure.element);
      batchExposure.observer.observe(batchExposure.element);
    } catch (_) {}
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
        '<div class="pc-imgwrap"' + (hero && bgFor(hero) ? ' style="background:' + bgFor(hero) + '"' : '') + '>' + (hero ? '<img class="pc-img"' + productImageAttrs(hero, "grid") + ' alt="' + escapeHtml(listing.title) + '" loading="lazy">' : '<span class="pc-img"></span>') + "</div>" +
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
    const hasBatch = hasLaunch || (p.variants || []).some((v) => productionBatchGroupOf(v) || v.batchLabel || (Number.isSafeInteger(v.batchSize) && v.batchSize > 0));
    const builds = p.variants.map((v) => '<button type="button" data-opt="' + v.id + '">' + v.label + "</button>").join("");
    const back = backTarget();
    return (
      '<div class="return2feed"><a href="' + escapeHtml(back.href) + '">' + storeIcon("arrow-left-long") + ' ' + escapeHtml(back.label) + "</a></div>" +
      '<div class="pd-media"><div class="pe-carousel">' +
        '<button class="pe-arrow prev" type="button" aria-label="Previous">' + storeIcon("chevron-left") + '</button>' +
        '<div class="pe-frame"><div class="pe-slides"></div></div>' +
        '<button class="pe-arrow next" type="button" aria-label="Next">' + storeIcon("chevron-right") + '</button>' +
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
    renderCarousel(initial && initial.image); wireDetail(); updateVariant(!!initial);
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
  function accessoryBuyBuild(p, includePendingInventory = false) {
    const eligible = (v) => buyable(v) || (includePendingInventory && v && inventorySkuOf(v) && !INVENTORY_READY && STATUS[configuredStatusOf(v)].sell && !launchPending(v) && v.price != null && !!v.stripePrice);
    const printed = exactVariant(p, "electronics-printed");
    if (printed) return eligible(printed) ? printed.id : null;
    const preferred = exactVariant(p, p.defaultBuild);
    const selected = eligible(preferred) ? preferred : (p.variants || []).find(eligible);
    return selected ? selected.id : null;
  }
  const cartQtyOf = (id, b) => { const l = cart.find((x) => x.id === id && x.build === b); return l ? l.qty : 0; };
  function setCartQty(id, b, q) {
    if (checkoutIsBusy() || !Number.isFinite(q) || (q > cartQtyOf(id, b) && !canIncreaseQuantity(id, b))) return;
    q = Math.max(0, Math.min(variantMaxQuantity(id, b), Math.floor(q)));
    const added = q - cartQtyOf(id, b);
    const i = cart.findIndex((x) => x.id === id && x.build === b);
    if (q <= 0) { if (i >= 0) cart.splice(i, 1); }
    else if (i >= 0) cart[i].qty = q;
    else cart.push({ id, build: b, qty: q });
    if (added > 0) metaItem("AddToCart", id, b, added);
    saveCart(); renderCart(); updateBadge(true);   // renderCart() re-syncs the cards via syncAccCards()
  }
  const ICON_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  function accAddHTML(a, selectedBuild) {
    const b = selectedBuild || accessoryBuyBuild(a); if (!b) return "";
    const q = cartQtyOf(a.id, b);
    const atLimit = !canIncreaseQuantity(a.id, b);
    if (q > 0) return '<div class="pc-qty"><button type="button" data-q="-1" aria-label="Remove one ' + escapeHtml(a.title) + '">−</button><span>' + q + '</span><button type="button" data-q="1" aria-label="Add one ' + escapeHtml(a.title) + '"' + (atLimit ? ' disabled' : '') + '>+</button></div>';
    return '<button class="pc-add" type="button" aria-label="Add ' + escapeHtml(a.title) + ' to cart"' + (atLimit ? ' disabled' : '') + '>' + ICON_PLUS + "</button>";
  }
  function accCardHTML(a, options = {}) {
    const b = options.build || accessoryBuyBuild(a), variant = b && exactVariant(a, b);
    if (!b) return "";
    const hero = variant && variant.image ? themedUrl(a.imageBase + variant.image) : carouselUrls(a)[0];
    const media = hero
      ? '<img class="pc-img"' + productImageAttrs(hero, "accessory") + ' alt="' + escapeHtml(a.title) + '" loading="lazy">'
      : '<span class="pc-img pc-ph">' + productIcon(a.icon) + '</span>';
    const priceHTML = money(variant.price);
    const controls = '<span class="pc-addwrap">' + accAddHTML(a, b) + '</span>';
    const title = '<p class="pc-title">' + escapeHtml(a.title) + '</p>';
    const body = options.checkout
      ? title + (!a.accessory ? '<p class="co-accessory-variant">' + escapeHtml(variant.label) + '</p>' : '') +
        '<div class="co-accessory-footer"><p class="pc-price">' + priceHTML + '</p>' + controls + '</div>'
      : '<div class="pc-tophead">' + title + controls + '</div><p class="pc-price">' + priceHTML + '</p>';
    return '<div class="product-card product-card--mini' + (options.checkout ? ' co-accessory' : '') + '" data-acc="' + escapeHtml(a.id) + '"' + (b ? ' data-build="' + escapeHtml(b) + '"' : '') + '>' +
      '<a class="pc-stretch" href="/store/' + encodeURIComponent(a.id) + '/' + (b ? '?variant=' + encodeURIComponent(b) : '') + '" aria-label="' + escapeHtml(a.title) + '"></a>' +
      '<div class="pc-imgwrap"' + (hero && bgFor(hero) ? ' style="background:' + bgFor(hero) + '"' : '') + '>' + media + "</div>" +
      '<div class="pc-body">' + body + '</div></div>';
  }
  function syncAccCards() {
    $$(".product-card--mini").forEach((card) => {
      const a = getProduct(card.dataset.acc); if (!a) return;
      // Checkout owns its handlers and focus while rebuilding the order summary.
      if (card.classList.contains("co-accessory")) return;
      const wrap = $(".pc-addwrap", card); if (wrap) wrap.innerHTML = accAddHTML(a);
    });
  }
  function renderAccessories(p) {
    if (!root) return;
    const prev = document.querySelector(".pd-accessories"); if (prev) prev.remove();   // re-render safety
    const accs = accessoriesFor(p).filter((a) => accessoryBuyBuild(a));   // true accessories
    const related = (p.related || []).map(getProduct).filter(Boolean);       // cross-sell products
    const cards = accs.concat(related).map((a) => accCardHTML(a)).filter(Boolean);
    if (!cards.length) return;
    const sec = document.createElement("section");
    sec.className = "pd-accessories";
    sec.innerHTML = '<h3 class="acc-heading">Accessories</h3><div class="acc-grid" style="--acc-cols:' + Math.min(cards.length, 4) + '">' + cards.join("") + "</div>";
    root.insertAdjacentElement("beforeend", sec);
    sec.addEventListener("click", (e) => {
      const card = e.target.closest(".product-card--mini"); if (!card) return;
      const a = getProduct(card.dataset.acc); if (!a) return;
      const b = accessoryBuyBuild(a);
      if (b && e.target.closest(".pc-add")) { e.preventDefault(); setCartQty(a.id, b, 1); track("add_to_cart", { product: a.id, build: b, qty: 1, value: evItemValue(a, b) }); ga4("add_to_cart", { currency: "USD", value: (ga4Item(a.id, b, 1).price) || 0, items: [ga4Item(a.id, b, 1)] }); }
      else if (b && e.target.closest('.pc-qty button[data-q="1"]')) { e.preventDefault(); setCartQty(a.id, b, cartQtyOf(a.id, b) + 1); }
      else if (b && e.target.closest('.pc-qty button[data-q="-1"]')) { e.preventDefault(); setCartQty(a.id, b, cartQtyOf(a.id, b) - 1); }
      else if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey)
        writeTrail(navTrail.concat([currentProductTrailEntry(p)]));   // same-tab body click -> push this exact page so the child's back returns here
    });
    syncAccCards();
    reveal();   // inventory refresh replaces these cards after the initial page reveal
  }

  function carouselImageHTML(url, index, active, title) {
    return '<div class="pe-slide' + (active ? " active" : "") + '"' + (bgFor(url) ? ' style="background:' + bgFor(url) + '"' : '') + '><img' +
      productImageAttrs(url, "gallery", !active) + ' alt="' + escapeHtml(title) + ' photo ' + (index + 1) + '" loading="eager" fetchpriority="' + (active ? "high" : "auto") + '"></div>';
  }
  function renderCarousel(initialImage) {
    const urls = carouselUrls(P);
    slide = initialImage ? Math.max(0, (P.images || []).indexOf(initialImage)) : 0;
    if (!urls.length) {
      $(".pe-slides", root).innerHTML = '<div class="pe-slide active"><span class="pe-ph">' + productIcon(P.icon) + '</span></div>';
      $(".pe-dots", root).innerHTML = "";
      $(".pe-carousel", root).classList.add("is-single");
      return;
    }
    $(".pe-slides", root).innerHTML = urls.map((u, i) => carouselImageHTML(u, i, i === slide, P.title)).join("");
    $(".pe-dots", root).innerHTML = urls.length > 1 ? urls.map((_, i) => '<button class="pe-dot' + (i === slide ? " active" : "") + '" type="button" data-i="' + i + '" aria-label="image ' + (i + 1) + '"></button>').join("") : "";
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
    loadProductImage(slides[slide].querySelector("img"));
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
    qty = Math.min(qty, detailQuantityLimit());
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
    $$(".pe-qty button", root).forEach((button) => { button.disabled = button.dataset.q === "1"
      ? !canIncreaseQuantity(P.id, build) || qty >= detailQuantityLimit() : qty <= 1; });
    const status = statusOf(v), st = STATUS[status], can = buyable(v), launchAt = countdownTarget(v);
    // Keep the price visible during a countdown or an inventory check; confirmed closed states show their status.
    $(".pe-price", root).innerHTML = can ? money(v.price) + (st.tag ? ' <span class="pe-tag">' + st.tag + "</span>" : "")
      : (launchAt != null || status === "loading" || status === "unavailable" || status === "paused") && v.price != null ? money(v.price) : '<span class="pe-status">' + (st.tag || "Unavailable") + "</span>";
    $(".pe-qty", root).style.display = can ? "inline-flex" : "none";
    const batch = $(".pe-batch", root);
    if (batch) {
      // before a drop, the date replaces the remaining-count line so the batch size stays private
      if (productionBatchGroupOf(v) && launchAt == null) {
        batch.classList.add("pe-batch--production");
        batch.innerHTML = productionBatchHTML(v);
        batch.hidden = !batch.innerHTML;
      } else {
        batch.classList.remove("pe-batch--production");
        batch.textContent = launchAt != null ? launchText(v) : batchAvailabilityText(v, P);
        batch.hidden = !batch.textContent;
      }
    }
    observeProductionBatchCounter(batch, P, v);
    const buy = $(".pe-buy", root);
    const wl = $(".pe-waitlist", root);
    if (wl) { wl.hidden = true; wl.innerHTML = ""; }
    const cd = $(".pe-countdown", root);
    stopCountdown();
    if (cd) { cd.hidden = true; cd.innerHTML = ""; }
    buy.style.display = ""; buy.disabled = false;
    if (can) {
      buy.classList.remove("is-waitlist"); buy.innerHTML = "<span>" + st.cta + "</span><span>" + money(v.price * qty) + "</span>";
      buy.disabled = !canIncreaseQuantity(P.id, build);
      if (productionBatchGroupOf(v) && !productionBatchOf(v)) { buy.textContent = "Check availability"; buy.disabled = productionBatchLoading; }
    }
    else if (launchAt != null && cd) { buy.style.display = "none"; startCountdown(cd, v, launchAt); }
    else if (status === "loading" || status === "unavailable") {
      buy.classList.remove("is-waitlist"); buy.textContent = st.cta; buy.disabled = status === "loading";
    }
    else if (status === "paused") { buy.classList.remove("is-waitlist"); buy.textContent = st.cta; buy.disabled = true; }
    else { buy.classList.add("is-waitlist"); buy.textContent = "Notify me"; }
    metaItem("ViewContent", P.id, build, 1);
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
      const maxQty = detailQuantityLimit();
      if (+b.dataset.q > 0 && !canIncreaseQuantity(P.id, build)) return;
      qty = Math.min(maxQty, Math.max(1, qty + (+b.dataset.q)));
      updateVariant(false);
    }));
    $(".pe-buy", root).addEventListener("click", () => {
      const v = variantById(P, build);
      if (productionBatchGroupOf(v) && !productionBatchOf(v)) refreshProductionBatches();
      else if (buyable(v)) addToCart(P.id, build, qty);
      else if (statusOf(v) === "unavailable") void checkInventoryAvailability();
      else if (waitlistEligible(v)) openWaitlist();
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
    if (!P || !waitlistEligible(variantById(P, build))) return;
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
      if (!waitlistEligible(variantById(P, build))) { updateVariant(false); return; }
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
    if (!waitlistEligible(target)) target = waitlistEligible(variantById(p, build)) ? variantById(p, build) : null;
    if (!target) target = comingSoonVariant(p);
    // Keep the link pending until stock is known, then scrub its email even when the product is buyable.
    if (!target && (p.variants || []).some((v) => statusOf(v) === "loading" || statusOf(v) === "unavailable")) return;
    const email = (params.get("email") || "").trim();
    params.delete("join"); params.delete("email"); params.delete("variant");   // keep the email out of history / re-shares
    const qs = params.toString();
    try { history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash); } catch (e) {}
    if (!target) return;                                           // nothing waitlist-eligible -> leave the page normal
    if (target.id !== build) { build = target.id; qty = 1; updateVariant(true); }  // re-select -> repaints the "Join the waitlist" state
    openWaitlist();                                                // reused as-is: hides buy, injects + focuses the form
    const wlHost = root && $(".pe-waitlist", root);
    if (wlHost) { try { wlHost.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) {} }   // mobile: bring the form into view
    if (email && email.indexOf("@") > 0) {                         // prefill ONLY -- user must click submit themselves
      const input = wlHost && $("input", wlHost);
      if (input) { input.value = email.slice(0, 200); input.focus(); }
    }
  }

  /* ---- cart ---- */
  let cartBtn, drawer, scrim;
  function injectHeaderCart() {
    const inner = document.querySelector(".md-header__inner");
    if (!inner) return;
    let btn = inner.querySelector(".store-cart-btn");
    if (!btn) {
      const icons = inner.querySelectorAll(".md-header__button.md-icon");
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "md-header__button md-icon store-cart-btn";
      btn.setAttribute("aria-label", "Open cart");
      btn.innerHTML = ICON_BAG + '<span class="store-cart-count">0</span>';
      inner.insertBefore(btn, icons[icons.length - 1] || null);
    }
    if (!btn.dataset.storeCartBound) {
      btn.addEventListener("click", function () { track("view_cart"); openCart(); });
      btn.dataset.storeCartBound = "true";
    }
    btn.disabled = false;
    cartBtn = btn;
    updateBadge();
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
    drawer.addEventListener("transitionend", (event) => {
      if (event.target === drawer && !drawer.classList.contains("is-open")) resumeBatchExposure();
    });
    $(".cart-close", drawer).addEventListener("click", closeCart);
    $(".cart-checkout", drawer).addEventListener("click", checkout);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCart(); });
  }
  function openCart() { if (/^\/store\/(checkout|confirmation)/.test(location.pathname)) return; ensureDrawer(); renderCart(); drawer.classList.add("is-open"); scrim.classList.add("is-open"); refreshProductionBatches(); }
  function closeCart() { if (drawer) { drawer.classList.remove("is-open"); scrim.classList.remove("is-open"); resumeBatchExposure(); } }
  function renderCart() {
    ensureDrawer(); updateBadge();
    const items = $(".cart-items", drawer);
    if (!cart.length) { items.innerHTML = '<p class="cart-empty">Your cart is empty.</p><a class="cart-shop-link" href="/store">Go to store</a>'; }
    else {
      items.innerHTML = cart.map((l, i) => {
        const p = getProduct(l.id); if (!p) return "";   // sanitizeCart drops these; this keeps a since-removed product from throwing mid-render
        const v = variantById(p, l.build), hero = carouselUrls(p)[0], gone = !buyable(v);
        return '<div class="cart-line' + (gone ? " cart-line-gone" : "") + '">' + (hero ? '<img class="cart-line-img"' + productImageAttrs(hero, "thumbnail") + ' alt=""' + (bgFor(hero) ? ' style="background:' + bgFor(hero) + '"' : '') + '>' : '<span class="cart-line-img"></span>') +
          '<div class="cart-line-meta"><div class="cart-line-info"><p class="cart-line-title">' + p.title + '</p><p class="cart-line-variant">' + cartVariantLabelHTML(v) + (gone ? ' <span class="cart-line-warn">no longer available</span>' : "") + "</p></div>" +
          '<div class="cart-line-qty"><button type="button" data-i="' + i + '" data-q="-1">−</button><span>' + l.qty + '</span><button type="button" data-i="' + i + '" data-q="1"' + (!canIncreaseQuantity(l.id, l.build) ? ' disabled' : '') + '>+</button></div></div>' +
          '<div class="cart-line-side"><div class="cart-line-price">' + money((v.price || 0) * l.qty) + '</div><button class="cart-line-remove" type="button" data-rm="' + i + '">remove</button></div></div>';
      }).join("") + '<button class="cart-shop-link" type="button">Continue shopping</button>';
      $$(".cart-line-qty button", items).forEach((b) => b.addEventListener("click", () => setLineQty(+b.dataset.i, cart[+b.dataset.i].qty + (+b.dataset.q))));
      $$("[data-rm]", items).forEach((b) => b.addEventListener("click", () => setLineQty(+b.dataset.rm, 0)));
    }
    $$(".cart-shop-link", items).forEach((el) => el.addEventListener("click", closeCart));
    $(".cart-sub-val", drawer).textContent = money(cartSubtotal());
    $(".cart-checkout", drawer).disabled = !cart.length || unavailableLines().length > 0;
    syncAccCards();   // keep any on-page accessory cards' +/counter in sync with the cart
    if ($("#product-detail") && root && P) updateVariant(false);
  }
  async function checkout() {
    if (!cart.length) return;
    try {
      if (window.TheodoreMetaTracking) window.TheodoreMetaTracking.checkoutEvent(
        cart.map((line) => metaCatalogItem(line.id, line.build, line.qty)));
    } catch (_) { /* Optional advertising cannot delay navigation. */ }
    // Recovery requests already use keepalive; never hold a navigation click
    // for optional background work.
    if (localRecovery) void localRecovery.flush(1000).catch(() => {});
    location.href = "/store/checkout/";   // on-site Payment Element checkout page
  }

  /* ---- on-site checkout page (Stripe Payment Element, styled to match the site) ---- */
  function coLineHTML(l, i) {
    const p = getProduct(l.id); if (!p) return "";
    const v = variantById(p, l.build), hero = carouselUrls(p)[0], gone = !buyable(v), unit = v.price || 0;
    return '<div class="co-line' + (gone ? " co-line-gone" : "") + '">' +
      (hero ? '<img class="co-line-img"' + productImageAttrs(hero, "thumbnail") + ' alt=""' + (bgFor(hero) ? ' style="background:' + bgFor(hero) + '"' : '') + '>' : '<span class="co-line-img"></span>') +
      '<div class="co-line-mid"><p class="co-line-title">' + p.title + '</p><p class="co-line-variant">' + cartVariantLabelHTML(v) + (gone ? ' <span class="cart-line-warn">no longer available</span>' : "") + "</p>" +
        '<button class="co-line-remove" type="button" data-rm="' + i + '" aria-label="Remove ' + escapeHtml(p.title) + '">remove</button></div>' +
      '<div class="co-line-right"><div class="co-line-price">' + money(unit * l.qty) + "</div>" +
        '<div class="co-line-unit">' + (l.qty > 1 ? l.qty + " &times; " + money(unit) : "&nbsp;") + "</div>" +
        '<div class="co-line-qty"><button type="button" data-i="' + i + '" data-q="-1" aria-label="less">&minus;</button><span>' + l.qty + '</span><button type="button" data-i="' + i + '" data-q="1" aria-label="more"' + (!canIncreaseQuantity(l.id, l.build) ? ' disabled' : '') + '>+</button></div>' +
      "</div></div>";
  }
  // Only add-ons chosen here keep a quantity control; items brought into
  // checkout are not recommended again. This lasts for this page visit only.
  const checkoutAddedAccessories = new Map();
  let checkoutRecommendationIds = null;
  function initialCheckoutAccessories() {
    const included = new Set(cart.map((line) => line.id)), suggestions = [];
    const frameIds = ["avian-visitors", "avian-visitors-kit"];
    if (frameIds.some((id) => included.has(id))) frameIds.forEach((id) => included.add(id));
    const printedParts = { "avian-mic": "bird-mic-case", "avian-visitors-kit": "avian-visitors-parts", polargraph: "polargraph-parts" };
    const add = (a) => {
      if (!a || included.has(a.id) || !(a.published || DEV_SHOW_UNPUBLISHED) || !accessoryBuyBuild(a, true)) return;
      included.add(a.id); suggestions.push(a);
    };
    const orderedAccessories = (p) => accessoriesFor(p).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const related = [];
    cart.forEach((line) => {
      const p = getProduct(line.id); if (!p) return;
      (p.related || []).map(getProduct).filter(Boolean).forEach((a) => { related.push(a); add(a); });
    });
    cart.forEach((line) => {
      const p = getProduct(line.id); if (!p) return;
      orderedAccessories(p).filter((a) => line.build !== "electronics-printed" || a.id !== printedParts[p.id]).forEach(add);
    });
    // Include the first authored accessory for a related product (for example,
    // the Bird Mic's mount alongside the mic on a frame order).
    related.forEach((p) => { if (suggestions.some((a) => a.id === p.id)) add(orderedAccessories(p)[0]); });
    return suggestions.slice(0, 3);
  }
  function checkoutAccessories() {
    if (!checkoutRecommendationIds) checkoutRecommendationIds = initialCheckoutAccessories().map((p) => p.id);
    checkoutAddedAccessories.forEach((b, id) => { if (!cartQtyOf(id, b)) checkoutAddedAccessories.delete(id); });
    const frameIds = ["avian-visitors", "avian-visitors-kit"];
    return checkoutRecommendationIds.map(getProduct).filter((p) => {
      if (!p || !accessoryBuyBuild(p)) return false;
      const chosen = checkoutAddedAccessories.has(p.id);
      if (cart.some((line) => line.id === p.id) && !chosen) return false;
      if (frameIds.includes(p.id) && cart.some((line) => frameIds.includes(line.id) && line.id !== p.id)) return false;
      return true;
    });
  }
  function coAccessoriesHTML() {
    const suggestions = checkoutAccessories();
    if (!suggestions.length) return "";
    return '<section class="co-accessories" aria-labelledby="co-accessories-title"><h3 id="co-accessories-title">Add-ons</h3><div class="co-accessories-grid">' + suggestions.map((a) =>
      accCardHTML(a, { checkout: true, build: checkoutAddedAccessories.get(a.id) || accessoryBuyBuild(a) })
    ).join('') + '</div></section>';
  }
  function coSummaryHTML() {
    return '<div class="co-lines">' + cart.map(coLineHTML).join("") + "</div>" +
      '<hr class="co-rule">' +
      '<details class="co-voucher-details"><summary>Add a voucher ' + storeIcon("chevron-down", "co-chev") + '</summary><form class="co-voucher" novalidate><input type="text" placeholder="Voucher code" aria-label="Voucher code" autocomplete="off"><button type="submit" aria-label="Apply voucher"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></form>' +
      '<p class="co-voucher-msg" role="status" hidden></p><button type="button" class="co-line-remove" data-remove-voucher hidden>Remove voucher</button></details>' +
      '<div class="co-gift"><label class="co-check" for="co-gift"><input type="checkbox" id="co-gift" name="gift" form="co-form" aria-controls="co-gift-details"><span>This is a gift</span></label>' +
        '<div id="co-gift-details" hidden><label class="co-field-label" for="co-gift-from">From</label><input class="co-email" id="co-gift-from" name="giftFrom" form="co-form" type="text" autocomplete="off" maxlength="160" aria-describedby="co-gift-error" disabled><p id="co-gift-error" class="co-gift-error" role="alert" hidden></p></div></div>' +
      '<hr class="co-rule">' +
      '<div class="co-row"><span>Subtotal</span><span>' + money2(cartSubtotal()) + "</span></div>" +
      '<div class="co-row co-discount-row" hidden><span>Discount</span><span class="co-discount"></span></div>' +
      '<div class="co-row co-muted"><span>Sales tax</span><span class="co-tax">&mdash;</span></div>' +
      '<div class="co-row co-muted"><span>Shipping</span><span class="co-ship">&mdash;</span></div>' +
      '<hr class="co-rule">' +
      '<div class="co-row co-total-row"><span>Total</span><span class="co-total-val">&mdash;</span></div>' + coAccessoriesHTML();
  }
  function checkoutAllowedCountries() {
    return cart.some((line) => {
      const p = getProduct(line.id), v = p && exactVariant(p, line.build);
      return v && v.shippingProfile === "contiguous-us-ground";
    }) ? ["US"] : ["US", "CA", "AU", "GB"];
  }
  function checkoutFiniteDemand() {
    const demand = {};
    cart.forEach((line) => {
      const p = getProduct(line.id), sku = p && inventorySkuOf(exactVariant(p, line.build));
      if (sku) demand[sku] = (demand[sku] || 0) + line.qty;
    });
    return JSON.stringify(Object.keys(demand).sort().map((sku) => [sku, demand[sku]]));
  }
  let stripeLoading = null;
  function loadStripe() {
    if (typeof window.Stripe === "function") return Promise.resolve(true);
    if (stripeLoading) return stripeLoading;
    stripeLoading = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "https://js.stripe.com/v3/"; script.async = true;
      let finished = false;
      const done = () => {
        if (finished) return; finished = true; clearTimeout(timer);
        const ready = typeof window.Stripe === "function";
        if (!ready) { stripeLoading = null; script.remove(); }
        resolve(ready);
      };
      const timer = setTimeout(done, 10000);
      script.addEventListener("load", done); script.addEventListener("error", done);
      document.head.appendChild(script);
    });
    return stripeLoading;
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
    $$(".co-line-qty button", host).forEach((b) => b.addEventListener("click", () => { if (host.__checkoutBusy && host.__checkoutBusy()) return; const i = +b.dataset.i; if (!cart[i]) return; setLineQty(i, cart[i].qty + (+b.dataset.q)); coRefreshSummary(host); }));
    $$(".co-line-remove[data-rm]", host).forEach((b) => b.addEventListener("click", () => { if (host.__checkoutBusy && host.__checkoutBusy()) return; setLineQty(+b.dataset.rm, 0); coRefreshSummary(host); }));
    $$(".co-accessory", host).forEach((row) => {
      $$(".pc-add, .pc-qty button", row).forEach((button) => button.addEventListener("click", () => {
        if (host.__checkoutBusy && host.__checkoutBusy()) return;
        const product = checkoutAccessories().find((p) => p.id === row.dataset.acc);
        const build = row.dataset.build, delta = button.dataset.q === "-1" ? -1 : 1;
        if (!product || !exactVariant(product, build)) return;
        const before = cartQtyOf(product.id, build);
        if (delta > 0 && (!buyable(exactVariant(product, build)) || before >= variantMaxQuantity(product.id, build))) return;
        if (delta > 0) { checkoutAddedAccessories.set(product.id, build); addToCart(product.id, build, 1); }
        else setCartQty(product.id, build, before - 1);
        coRefreshSummary(host);
        const replacement = $$(".co-accessory", host).find((card) => card.dataset.acc === product.id);
        const requestedFocus = replacement && ($(delta < 0 ? '.pc-qty button[data-q="-1"]' : '.pc-qty button[data-q="1"]', replacement) || $(".pc-add", replacement));
        const focus = requestedFocus && !requestedFocus.disabled ? requestedFocus
          : replacement ? $('.pc-qty button[data-q="-1"]', replacement) : $(".co-line-remove[data-rm]", host);
        if (focus) focus.focus({ preventScroll: true });
        const status = $(".co-cart-status", host);
        if (status) status.textContent = product.title + (delta > 0 ? " added to your order." : " quantity updated.") + " Quantity " + cartQtyOf(product.id, build) + ". Subtotal " + money2(cartSubtotal()) + ".";
      }));
    });
    const vf = $(".co-voucher", host);
    const voucherDetails = $(".co-voucher-details", host);
    if (voucherDetails) {
      voucherDetails.open = !!host.__voucherOpen;
      voucherDetails.addEventListener("toggle", () => { host.__voucherOpen = voucherDetails.open; });
    }
    if (vf) {
      vf.addEventListener("submit", (e) => { e.preventDefault(); if (host.__applyVoucher) host.__applyVoucher(($("input", vf).value || "").trim()); });
      $("input", vf).addEventListener("input", () => { if (host.__editVoucher) host.__editVoucher(); });
    }
    const remove = $("[data-remove-voucher]", host);
    if (remove) remove.addEventListener("click", () => { if (host.__applyVoucher) host.__applyVoucher(""); });
    if (host.__paintVoucher) host.__paintVoucher();
    if (host.__wireGift) host.__wireGift();
  }
  function coRefreshSummary(host) {
    if (!cart.length) { location.href = "/store/?cart=open"; return; }
    $(".co-summary", host).innerHTML = coSummaryHTML();
    coWireSummary(host);
    swapProductImages();
    if (host.__cartChanged) host.__cartChanged();
    else if (host.__updateSubmit) host.__updateSubmit();
  }
  async function renderCheckout(restoredDraft) {
    const host = $("#checkout"); if (!host) return;
    const draft = restoredDraft || (host.__captureCheckout ? host.__captureCheckout() : null);
    const renderId = (host.__renderId || 0) + 1; host.__renderId = renderId;
    const current = () => host.__renderId === renderId;
    if (host.__disposeCheckout) host.__disposeCheckout();
    for (const key of ["__applyVoucher", "__editVoucher", "__paintVoucher", "__cartChanged", "__recalc", "__updateSubmit", "__checkoutBusy", "__wireGift", "__captureCheckout", "__disposeCheckout"]) delete host[key];
    loadCart();
    if (!cart.length) { saveGiftDraft({ gift: false }); host.innerHTML = '<div class="co-empty"><p>Your cart is empty.</p><a class="cart-shop-link" href="/store">Go to store</a></div>'; return; }
    track("begin_checkout", { value: cartSubtotal() * 100 });
    ga4("begin_checkout", { currency: "USD", value: cartSubtotal(), items: cart.map(function (l) { return ga4Item(l.id, l.build, l.qty); }) });
    host.innerHTML =
      '<div class="conf-back-top"><a href="/store/?cart=open" class="co-tocart">' + storeIcon("arrow-left-long") + ' Cart</a></div>' +
      '<p class="co-cart-status co-sr-only" role="status"></p>' +
      '<div class="co-grid">' +
        '<aside class="co-summary">' + coSummaryHTML() + "</aside>" +
        '<div class="co-detail">' +
          '<div class="return2feed"><a href="/store/?cart=open" class="co-tocart">' + storeIcon("arrow-left-long") + ' Cart</a></div>' +
          '<form class="co-pay" id="co-form" novalidate>' +
            '<section class="co-section is-open" data-sec="shipping"><button class="co-section-head" type="button" aria-expanded="true" aria-controls="co-shipping-content"><span class="co-h">Shipping</span>' + storeIcon("chevron-down", "co-chev") + '</button><div class="co-section-body" id="co-shipping-content" aria-hidden="false"><div id="address-element"></div></div></section>' +
            '<section class="co-section" data-sec="payment"><button class="co-section-head" type="button" aria-expanded="false" aria-controls="co-payment-content"><span class="co-h">Payment</span>' + storeIcon("chevron-down", "co-chev") + '</button><div class="co-section-body" id="co-payment-content" aria-hidden="true" inert>' +
              '<label class="co-field-label" for="co-email">Email for your receipt</label>' +
              '<input class="co-email" id="co-email" type="email" placeholder="you@email.com" autocomplete="email" required maxlength="200" pattern="[^\\s@]+@[^\\s@]+\\.[^\\s@]+">' +
              '<label class="co-check"><input type="checkbox" id="co-news"><span>Email me occasional updates and offers</span></label>' +
              (draft && draft.paymentResetNotice ? '<p class="co-payment-note" role="status">Your order changed. Please enter your payment details again.</p>' : '') +
              '<div id="payment-element"></div>' +
            "</div></section>" +
            '<p class="co-error" role="alert" hidden></p>' +
            '<button class="co-submit" type="submit" disabled><span>Pay ' + money(cartSubtotal()) + "</span></button>" +
            '<p class="co-terms">By placing your order you agree to our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</p>' +
          "</form>" +
        "</div>" +
      "</div>";
    if (draft) { $("#co-email", host).value = draft.email || ""; $("#co-news", host).checked = !!draft.newsletter; }
    coWireSummary(host); swapProductImages();
    const sections = $$(".co-section", host);
    const err = $(".co-error", host), submit = $(".co-submit", host);
    const paymentOpen = () => $('.co-section[data-sec="payment"]', host).classList.contains("is-open");
    let peReady = false, setupReady = false, addrComplete = false, processing = false, curShip = null, lastTotal = null, paymentHadInput = false;
    let addressDraft = draft && draft.address || null, addressDraftComplete = false, countryBlocked = false;
    let giftCheck, giftFrom, giftDetails, giftError;
    let gift = draft && draft.gift || giftDraft(), giftErrorMessage = "";
    const giftValue = () => ({ gift: gift.gift, giftFrom: gift.gift ? gift.giftFrom.normalize("NFC").trim().replace(/\s+/g, " ") : "" });
    const paintGift = () => {
      if (!giftCheck) return;
      giftCheck.checked = gift.gift; giftCheck.disabled = processing;
      giftDetails.hidden = !gift.gift; giftFrom.disabled = !gift.gift || processing;
      if (giftFrom.value !== gift.giftFrom) giftFrom.value = gift.giftFrom;
      giftError.hidden = !giftErrorMessage; giftError.textContent = giftErrorMessage;
      if (giftErrorMessage) giftFrom.setAttribute("aria-invalid", "true");
      else giftFrom.removeAttribute("aria-invalid");
    };
    const clearGiftError = () => { giftErrorMessage = ""; paintGift(); };
    const giftProblem = () => {
      if (gift.gift && /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(gift.giftFrom)) return "Enter the sender names on one line.";
      if (gift.gift && Array.from(giftValue().giftFrom).length > 80) return "Use 80 characters or fewer for the sender names.";
      return "";
    };
    const validateGift = () => {
      const message = giftProblem();
      if (!message) { clearGiftError(); return true; }
      giftErrorMessage = message; paintGift();
      if (giftFrom) giftFrom.focus();
      return false;
    };
    const wireGift = () => {
      giftCheck = $("#co-gift", host); giftFrom = $("#co-gift-from", host);
      giftDetails = $("#co-gift-details", host); giftError = $("#co-gift-error", host);
      if (!giftCheck) return;
      giftCheck.addEventListener("change", () => {
        if (processing) return;
        gift = { gift: giftCheck.checked, giftFrom: giftCheck.checked ? gift.giftFrom : "" };
        saveGiftDraft(gift); clearGiftError();
      });
      giftFrom.addEventListener("input", () => {
        if (processing) return;
        gift.giftFrom = giftFrom.value; saveGiftDraft(gift); clearGiftError();
      });
      paintGift();
    };
    host.__wireGift = wireGift; wireGift();
    // Voucher text stays only in this checkout's memory and request bodies, never storage or telemetry.
    let voucherCode = draft && draft.voucherCode || "", voucherDiscount = 0, voucherState = "none", voucherMessage = "", voucherVersion = 0;
    if (voucherCode || (draft && (draft.voucherState === "editing" || draft.voucherState === "invalid"))) {
      voucherState = draft.voucherState === "editing" || draft.voucherState === "invalid" ? draft.voucherState : "checking";
      voucherMessage = voucherState === "checking" ? "Checking voucher…" : draft.voucherMessage;
    }
    let priceVersion = 0, repricing = false, pricingQueue = Promise.resolve();
    const voucherBlocked = () => voucherState !== "none" && voucherState !== "applied";
    const paintVoucher = () => {
      const input = $(".co-voucher input", host), apply = $(".co-voucher button", host);
      const message = $(".co-voucher-msg", host), remove = $("[data-remove-voucher]", host);
      const details = $(".co-voucher-details", host);
      if (details && (voucherCode || voucherState !== "none")) { details.open = true; host.__voucherOpen = true; }
      if (input) { input.disabled = processing || !setupReady; if (input.value !== voucherCode) input.value = voucherCode; }
      if (apply) apply.disabled = processing || !setupReady || voucherState === "checking";
      if (message) { message.textContent = voucherMessage; message.hidden = !voucherMessage; }
      if (remove) { remove.hidden = !voucherCode && voucherState === "none"; remove.disabled = processing || !setupReady; }
      const row = $(".co-discount-row", host), amount = $(".co-discount", host);
      if (row) { row.hidden = !voucherDiscount; row.style.display = voucherDiscount ? "" : "none"; }
      if (amount) amount.textContent = voucherDiscount ? "-" + money2(voucherDiscount / 100) : "";
      syncLineQuantityControls(host, processing);
      $$(".co-accessory", host).forEach((row) => {
        const product = getProduct(row.dataset.acc), build = row.dataset.build;
        const atLimit = !product || !canIncreaseQuantity(product.id, build);
        $$(".pc-add, .pc-qty button", row).forEach((button) => { button.disabled = processing || (button.dataset.q !== "-1" && atLimit); });
      });
    };
    const updateSubmit = () => {
      paintVoucher(); paintGift();
      const sp = submit.querySelector("span");
      if (processing) { if (sp) sp.textContent = "Processing…"; submit.disabled = true; return; }
      const onPay = paymentOpen();
      const amt = lastTotal != null ? lastTotal / 100 : cartSubtotal();
      if (sp) sp.textContent = onPay ? "Pay " + money2(amt) : "Continue to payment";
      submit.disabled = !setupReady || voucherBlocked() || repricing || !addrComplete || lastTotal == null || (onPay && !peReady);
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
    const openSection = (name) => {
      sections.forEach((s) => {
        const open = s.dataset.sec === name, head = $(".co-section-head", s), body = $(".co-section-body", s);
        s.classList.toggle("is-open", open);
        if (head) head.setAttribute("aria-expanded", String(open));
        if (body) { body.inert = !open; body.setAttribute("aria-hidden", String(!open)); }
      });
      updateSubmit();
    };
    const captureCheckout = (restartingPayment = false) => ({
      email: $("#co-email", host).value, newsletter: $("#co-news", host).checked,
      address: addressDraft, gift: { ...gift }, voucherCode, voucherState, voucherMessage,
      paymentOpen: paymentOpen(), paymentResetNotice: !!(draft && draft.paymentResetNotice) || (restartingPayment && (paymentOpen() || paymentHadInput)),
    });
    host.__captureCheckout = captureCheckout;
    $$(".co-section-head", host).forEach((h) => h.addEventListener("click", () => openSection(h.parentElement.dataset.sec)));
    host.__updateSubmit = updateSubmit; openSection(draft && draft.paymentOpen ? "payment" : "shipping");
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    if (cart.some((line) => { const product = getProduct(line.id); return productionBatchGroupOf(product && exactVariant(product, line.build)); })) {
      // Show the summary immediately, but clamp restored quantities before creating a payment.
      await loadProductionBatches();
      if (!current()) return;
      refreshProductionBatchSurfaces();
      if (!cart.length) return;
    }
    const gone = unavailableLines();
    if (gone.length) { fail(gone.map(lineLabel).join(", ") + (gone.length > 1 ? " are" : " is") + " no longer available. Please edit your cart."); return; }
    const stripeReady = loadStripe(); // Load in parallel with the initial quote, after content is rendered.
    const paymentFiniteDemand = checkoutFiniteDemand();
    let data;
    const initialCart = JSON.stringify(cart);
    try {
      const res = await fetch("/api/payment-intent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.assign({ cart: cart }, evAttribution(), await recoveryCheckoutContext())) });
      data = await res.json().catch(() => ({}));
      if (!current()) return;
      if (paymentFiniteDemand !== checkoutFiniteDemand()) { void renderCheckout(captureCheckout(true)); return; }
      if (!res.ok || !data.clientSecret) {
        if (data.code === "production_quantity_limit") {
          const changed = await reconcileProductionQuantityLimit(data, current);
          if (!current()) return;
          if (changed || initialCart !== JSON.stringify(cart)) { void renderCheckout(captureCheckout()); return; }
          fail(data.error || "The current batch quantity changed. Please update your cart."); return;
        }
        fail(data.item ? lineLabel(data.item) + " is no longer available. Please edit your cart." : (data.error || "Could not start checkout. Please try again.")); return;
      }
    } catch (e) { fail("Network error. Check your connection and try again."); return; }
    if (!data.publishableKey) { fail("Payment is not fully configured yet."); return; }
    if (!await stripeReady) { if (current()) fail("Payment could not load. Please refresh the page."); return; }
    if (!current()) return;
    // The cart remains editable while the SDK loads; its signed scope must still match.
    if (paymentFiniteDemand !== checkoutFiniteDemand()) { void renderCheckout(captureCheckout(true)); return; }
    const piId = data.clientSecret.split("_secret_")[0] || "";
    const updateToken = data.updateToken || "";   // proves to the server we created this PI; required to update it
    applyBreakdown(data);   // show the subtotal now; shipping + tax fill in once a US address is entered

    const stripe = window.Stripe(data.publishableKey);
    const elements = stripe.elements({ clientSecret: data.clientSecret, appearance: checkoutAppearance(), fonts: [{ cssSrc: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500&display=swap" }] });
    let addressEl = null, addressCountries = checkoutAllowedCountries(), addressGeneration = 0;
    const pe = elements.create("payment", { layout: "tabs", wallets: { applePay: "auto", googlePay: "auto" } });   // surface Apple Pay / Google Pay when eligible
    pe.mount("#payment-element");
    pe.on("ready", () => { peReady = true; updateSubmit(); });
    pe.on("change", (e) => { if (e.empty === false) paymentHadInput = true; });
    host.__disposeCheckout = () => { addressGeneration += 1; if (addressEl) addressEl.destroy(); pe.destroy(); };
    const invalidatePrice = () => {
      priceVersion += 1; repricing = false;
      applyBreakdown({ shipping: null });
    };
    // Serialize updates to this PaymentIntent. A stale quote must never overwrite a newer voucher or cart.
    const recalc = (finalize = false) => {
      if (!curShip || !addrComplete || voucherBlocked()) return Promise.resolve(null);
      const version = ++priceVersion;
      // In-progress sender text must not block an address quote. Submit validates it before the final sync.
      const cartSnapshot = JSON.stringify(cart), codeSnapshot = voucherCode, giftSnapshot = JSON.stringify(giftProblem() ? { gift: gift.gift, giftFrom: "" } : giftValue());
      const emailVal = (($("#co-email", host) || {}).value || "").trim();
      const reqBody = Object.assign({ cart: JSON.parse(cartSnapshot), paymentIntentId: piId, updateToken, shipping: curShip, voucherCode: codeSnapshot }, JSON.parse(giftSnapshot));
      if (emailVal) reqBody.email = emailVal;
      if (finalize) reqBody.finalize = true;
      repricing = true; updateSubmit();
      const task = pricingQueue.then(async () => {
        if (!current() || version !== priceVersion) return null;
        try {
          Object.assign(reqBody, evAttribution(), await recoveryCheckoutContext());
          if (!current() || version !== priceVersion) return null;
          const r = await fetch("/api/payment-intent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(reqBody) });
          const d = await r.json().catch(() => ({}));
          if (!current() || version !== priceVersion || cartSnapshot !== JSON.stringify(cart) || codeSnapshot !== voucherCode) return null;
          if (!r.ok) {
            if (codeSnapshot && d.code === "discount_unavailable") {
              voucherState = "invalid"; voucherMessage = d.error || "That code is not available for this order."; voucherDiscount = 0;
            }
            lastTotal = null;
            if (d.code === "production_quantity_limit") {
              // The server rejected this finalize before acceptance; confirmation must stop.
              if (finalize) processing = false;
              fail(d.error || "The current batch quantity changed. Please review your order.");
              await reconcileProductionQuantityLimit(d, current);
              return null;
            }
            fail(d.item ? lineLabel(d.item) + " is no longer available. Please edit your cart." : (d.error || "Could not update your order. Please try again.")); return null;
          }
          if ((d.discount || 0) !== voucherDiscount) {
            lastTotal = null; voucherMessage = "Your discount changed. Apply your voucher again before paying."; fail(voucherMessage); voucherState = "invalid"; return null;
          }
          err.hidden = true; applyBreakdown(d);
          try { await elements.fetchUpdates(); } catch (e) {}
          if (!current() || version !== priceVersion || cartSnapshot !== JSON.stringify(cart) || codeSnapshot !== voucherCode) return null;
          return d;
        } catch (e) {
          if (current() && version === priceVersion) { lastTotal = null; fail("Network error. Check your connection and try again."); }
          return null;
        } finally {
          if (current() && version === priceVersion) { repricing = false; updateSubmit(); }
        }
      });
      pricingQueue = task.catch(() => null);
      return task;
    };
    const acceptAddressDraft = () => {
      addrComplete = addressDraftComplete && !!addressDraft && checkoutAllowedCountries().includes(addressDraft.address.country);
      curShip = addrComplete ? addressDraft : null;
    };
    const mountAddress = (countries, defaults) => {
      const generation = ++addressGeneration;
      addressCountries = countries; addrComplete = false; addressDraftComplete = false; curShip = null;
      invalidatePrice();
      if (addressEl) addressEl.destroy();
      const options = { mode: "shipping", allowedCountries: countries, autocomplete: { mode: "disabled" } };
      if (defaults) options.defaultValues = defaults;
      addressEl = elements.create("address", options);
      addressEl.on("change", (e) => {
        if (!current() || generation !== addressGeneration) return;
        // Cache partial drafts too; passive country changes must not trigger
        // getValue() validation or discard the customer's unfinished fields.
        addressDraft = e.value && e.value.address ? { name: e.value.name || "", address: { ...e.value.address } } : null;
        addressDraftComplete = !!e.complete;
        acceptAddressDraft(); invalidatePrice();
        if (syncAddressCountries()) return;
        if (addrComplete) void recalc();
      });
      addressEl.mount("#address-element");
    };
    const syncAddressCountries = () => {
      const countries = checkoutAllowedCountries(), country = addressDraft && addressDraft.address.country;
      if (country && !countries.includes(country)) {
        countryBlocked = true; addrComplete = false; curShip = null; invalidatePrice();
        fail("This order ships only within the contiguous US. Choose a US shipping address or remove the assembled frame.");
        openSection("shipping");
        return true; // Keep the foreign draft intact until the customer chooses US.
      }
      if (countryBlocked) { countryBlocked = false; err.hidden = true; }
      if (countries.join() !== addressCountries.join()) {
        mountAddress(countries, addressDraft);
        return true;
      }
      return false;
    };
    const applyVoucher = async (code) => {
      if (processing || !setupReady) return;
      const version = ++voucherVersion;
      voucherCode = code; voucherDiscount = 0;
      voucherState = code ? "checking" : "none"; voucherMessage = code ? "Checking voucher…" : "";
      invalidatePrice(); updateSubmit();
      if (!code) { if (!countryBlocked) err.hidden = true; if (curShip && addrComplete) await recalc(); return; }
      const cartSnapshot = JSON.stringify(cart);
      try {
        const response = await fetch("/api/voucher", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cart: JSON.parse(cartSnapshot), voucherCode: code }) });
        const result = await response.json().catch(() => ({}));
        if (!current() || version !== voucherVersion || cartSnapshot !== JSON.stringify(cart)) return;
        if (!response.ok || !Number.isSafeInteger(result.discount) || result.discount <= 0) {
          voucherState = "invalid"; voucherMessage = result.error || "That code is not available for this order."; updateSubmit(); return;
        }
        voucherDiscount = result.discount; voucherState = "applied";
        voucherMessage = "Voucher applied: " + money2(result.discount / 100) + " off.";
        if (!countryBlocked) err.hidden = true; updateSubmit();
        if (curShip && addrComplete) await recalc();
      } catch (e) {
        if (current() && version === voucherVersion) { voucherState = "invalid"; voucherMessage = "Could not check your voucher. Try again."; updateSubmit(); }
      }
    };
    host.__checkoutBusy = () => processing;
    host.__paintVoucher = paintVoucher;
    host.__applyVoucher = applyVoucher;
    host.__editVoucher = () => {
      if (processing) return;
      voucherVersion += 1; voucherCode = (($(".co-voucher input", host) || {}).value || ""); voucherState = "editing"; voucherDiscount = 0;
      voucherMessage = "Apply this voucher or remove it to continue."; invalidatePrice(); updateSubmit();
    };
    host.__cartChanged = () => {
      if (paymentFiniteDemand !== checkoutFiniteDemand()) { void renderCheckout(captureCheckout(true)); return; }
      if (!syncAddressCountries()) acceptAddressDraft();
      if (voucherState === "editing") { invalidatePrice(); updateSubmit(); return; }
      if (voucherCode) void applyVoucher(voucherCode);
      else { invalidatePrice(); if (curShip && addrComplete) void recalc(); }
    };
    host.__recalc = recalc;
    // Keep an incompatible foreign draft visible until the customer selects an
    // allowed country, even when a finite-scope change recreated the payment.
    const draftCountry = addressDraft && addressDraft.address.country;
    mountAddress(draftCountry && !addressCountries.includes(draftCountry) ? ["US", "CA", "AU", "GB"] : addressCountries, addressDraft);
    syncAddressCountries();

    $("#co-form", host).addEventListener("submit", async (e) => {
      e.preventDefault();
      if (processing || voucherBlocked() || repricing) return;
      if (!validateGift()) return;
      if (!addrComplete) { fail("Add your shipping address to continue."); openSection("shipping"); return; }   // shipping + tax need a US address
      if (lastTotal == null) return;
      if (!paymentOpen()) { err.hidden = true; openSection("payment"); $("#co-email", host).focus(); return; }   // explicit Continue -> reveal payment, don't pay yet
      const emailInput = $("#co-email", host);
      if (!emailInput.reportValidity()) return;
      const email = emailInput.value.trim();
      processing = true; updateSubmit(); err.hidden = true;
      const paymentCart = JSON.stringify(cart), paymentVoucher = voucherCode, paymentShipping = JSON.stringify(curShip), paymentTotal = lastTotal, paymentGift = JSON.stringify(giftValue());
      const synced = await recalc(true);   // final server-authoritative total (address + email + voucher) before charging
      if (paymentCart !== JSON.stringify(cart) || paymentVoucher !== voucherCode || paymentShipping !== JSON.stringify(curShip) || paymentGift !== JSON.stringify(giftValue()) || email !== emailInput.value.trim() || !addrComplete) { processing = false; fail("Your order changed. Review it before paying."); updateSubmit(); return; }
      if (!synced) { processing = false; updateSubmit(); return; }
      if (synced.total !== paymentTotal) { processing = false; fail("Your total changed. Review it before paying."); updateSubmit(); return; }
      if ((($("#co-news", host) || {}).checked) && email) { try { fetch("/api/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, tags: ["customer"] }), keepalive: true }); } catch (e3) {} }   // server-side Buttondown signup; keepalive lets it finish across the Stripe redirect (never broadcasts)
      const { error } = await stripe.confirmPayment({ elements, confirmParams: { return_url: location.origin + "/store/confirmation/" } });
      if (error) { processing = false; fail(error.message || "Payment failed. Please try again."); updateSubmit(); }
      // on success Stripe redirects to return_url, where handleCheckoutReturn() clears the cart
    });
    setupReady = true; updateSubmit();
    if (voucherCode && voucherState === "checking") void applyVoucher(voucherCode);
    const obs = new MutationObserver(() => { try { elements.update({ appearance: checkoutAppearance() }); } catch (e) {} });
    obs.observe(document.body, { attributes: true, attributeFilter: ["data-md-color-scheme"] });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-md-color-scheme"] });
    const disposeElements = host.__disposeCheckout;
    host.__disposeCheckout = () => { obs.disconnect(); disposeElements(); };
  }

  /* Commerce navigation and filtering should expose their result immediately. */
  function reveal() {
    const els = document.querySelectorAll(".intro-section, .store-feed, .legal-section, .footer, .product-card");
    els.forEach((el) => el.classList.add("visible"));
  }

  /* keep the cart in sync if it changes in another tab */
  window.addEventListener("storage", (e) => {
    if (e.key !== CART_KEY || checkoutIsBusy()) return;
    const before = JSON.stringify(cart);
    loadCart(); renderCart();
    const host = $("#checkout");
    if (host && $(".co-summary", host) && before !== JSON.stringify(cart)) coRefreshSummary(host);
  });

  /* re-point already-rendered product images at the right light/dark variant */
  function swapProductImages() {
    $$("img.pc-img, .pe-slide img, img.cart-line-img, img.co-line-img").forEach((img) => {
      const original = img.getAttribute("data-store-image") || img.getAttribute("src"); if (!original) return;
      const want = themedUrl(original);
      const gallerySlide = img.closest(".pe-slide");
      // Opacity-hidden slides still count as in-viewport to native lazy loading.
      // Keep them source-less until selected, including after a theme change.
      if (!gallerySlide || gallerySlide.classList.contains("active")) loadProductImage(img);
      const holder = img.closest(".pe-slide, .pc-imgwrap, .cart-line-img, .co-line-img");   // cart thumbnails paint their own letterbox surface
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
  const backHome = '<div class="return2feed"><a href="https://teddywarner.com" class="co-tocart">' + storeIcon("arrow-left-long") + ' Home</a></div>';
  const backStore = '<div class="return2feed"><a href="/store" class="co-tocart">' + storeIcon("arrow-left-long") + ' Store</a></div>';
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
    const legacyLabel = l.id === "avian-visitors" ? ({ assembled: "Assembled", "assembled-batch-2": "Assembled (Batch 2)" })[l.build] : "";
    const label = legacyLabel || (v ? v.label : l.build);
    const unit = v ? (v.price || 0) : 0;
    const allocations = Array.isArray(l.productionBatches) ? l.productionBatches.filter((row) => row &&
      Number.isSafeInteger(row.ordinal) && row.ordinal > 0 && Number.isSafeInteger(row.quantity) && row.quantity > 0) : [];
    const batchNote = allocations.length && allocations.reduce((n, row) => n + row.quantity, 0) === l.qty
      ? '<p class="co-line-variant">' + allocations.map((row) => 'Batch ' + row.ordinal + ' &times; ' + row.quantity).join(' · ') + '</p>' : '';
    return '<div class="co-line">' +
      (hero ? '<img class="co-line-img"' + productImageAttrs(hero, "thumbnail") + ' alt="">' : '<span class="co-line-img"></span>') +
      '<div class="co-line-mid"><p class="co-line-title">' + escapeHtml(title) + '</p><p class="co-line-variant">' + escapeHtml(label) + " &times; " + l.qty + "</p>" + batchNote + "</div>" +
      (unit ? '<div class="co-line-right"><div class="co-line-price">' + money(unit * l.qty) + "</div></div>" : "") +
      "</div>";
  }
  function renderOrder(host, d, back) {
    if (d.status === "canceled" && d.discountUnavailable) { renderDiscountUnavailable(host); return; }
    back = back || backHome;
    const b = d.breakdown || {};
    const rows =
      (b.subtotal != null ? '<div class="co-row"><span>Subtotal</span><span>' + money2(b.subtotal / 100) + "</span></div>" : "") +
      (b.discount > 0 ? '<div class="co-row"><span>Discount</span><span>-' + money2(b.discount / 100) + "</span></div>" : "") +
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
      '</p><p class="conf-note">The dispatch estimate shown when you ordered applies to your order. You’ll get a tracking link by email when it ships.</p>' + projNote + '</div>' : "";
    const giftBlock = d.gift ? '<div class="conf-block"><p class="conf-block-h">Gift</p>' + (d.giftFrom ? '<p class="conf-row2">From: ' + escapeHtml(d.giftFrom) + '</p>' : '') + '</div>' : '';
    const pay = d.payment, brand = pay && pay.brand ? pay.brand.charAt(0).toUpperCase() + pay.brand.slice(1) : "";
    const payBlock = '<div class="conf-block"><p class="conf-block-h">Payment</p>' +
      (pay && pay.last4 ? '<p class="conf-row2">' + escapeHtml(brand) + " ending in " + escapeHtml(pay.last4) + "</p>" : "") +
      '<p class="conf-row2">Total paid ' + money2((b.total != null ? b.total : d.amount) / 100) + "</p>" +
      (d.email ? '<p class="conf-note">Receipt email: ' + escapeHtml(d.email) + "</p>" : "") + "</div>";
    host.innerHTML =
      '<div class="conf-back-top">' + back + "</div>" +
      '<div class="co-grid">' +
        '<aside class="co-summary">' +
          '<h2 class="co-h conf-title">' + (d.fulfillment === "shipped" ? "Your order" : "Order confirmed") + "</h2>" +
          '<p class="conf-order">Order #' + escapeHtml(d.orderNo || "") + "</p>" +
          '<div class="co-lines">' + (d.items || []).map(confLineHTML).join("") + '</div><hr class="co-rule">' + rows +
        "</aside>" +
        '<div class="co-detail">' + back + timelineHTML(d) + shipBlock + giftBlock + payBlock +
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
  function renderDiscountUnavailable(host) {
    renderMessage(host, "That voucher is no longer available", "Your card was not charged. Any pending hold will drop off your statement in a few days. <a href=\"/store/avian-visitors/\">Return to Avian Visitors</a> to review a new order.");
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
          '<div class="conf-block"><p class="conf-block-h">Changed your mind?</p><p class="conf-row2">You can cancel for a full refund any time before your order ships. Email <a href="mailto:returns@theodore.net">returns@theodore.net</a> with your order number.</p></div>' +
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
      if (d.discountUnavailable) renderDiscountUnavailable(host);
      else if (d.soldOut) renderMessage(host, "This batch sold out", "Every unit was claimed before your payment went through, so your card was not charged. The pending hold will drop off your statement in a few days. <a href=\"" + again + "\">Get on the list for the next batch</a>.");
      else renderMessage(host, "Your payment did not go through", "Your card was not charged. Questions? " + help);
      return;
    }
    if (settling(d)) { renderMessage(host, "Your order is still confirming", "You’ll get a receipt by email once it’s confirmed. If none arrives within the hour, email " + help + " with order #" + escapeHtml(d.orderNo || "") + "."); return; }
    if ((status && status !== "succeeded") && d.status !== "succeeded") { renderMessage(host, "Your payment did not complete"); return; }
    // GA4 purchase: transaction_id = the PaymentIntent id, so refreshes of the
    // confirmation page dedupe server-side in GA4 and never double-count revenue.
    // Fire only on a server-confirmed success: an authorized limited-batch order
    // that later loses the race for the last unit must never count.
    if (d.status === "succeeded") {
      saveGiftDraft({ gift: false });
      const purchase = {
        transaction_id: pi, currency: "USD",
        items: (d.items || []).map(function (it) {
          const item = ga4Item(it.id, it.build, it.qty);
          delete item.price;   // current catalog prices are not the order's paid prices
          return item;
        })
      };
      const b = d.breakdown, cents = (n) => Number.isSafeInteger(n) && n >= 0;
      const discount = b && b.discount === undefined ? 0 : b && b.discount;
      if (b && [b.subtotal, b.shipping, b.tax, b.total, discount, d.amount].every(cents) &&
          discount <= b.subtotal && b.total === d.amount &&
          b.subtotal - discount + b.shipping + b.tax === b.total) {
        purchase.value = (b.subtotal - discount) / 100;
        purchase.shipping = b.shipping / 100;
        purchase.tax = b.tax / 100;
      }
      ga4("purchase", purchase);
    }
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
    IMAGE_SOURCES = (window.STORE_IMAGE_SOURCES && typeof window.STORE_IMAGE_SOURCES === "object") ? window.STORE_IMAGE_SOURCES : {};
    // Inventory starts fail closed for finite variants, but it must never delay
    // ordinary product rendering or interaction. Refresh only affected surfaces
    // after the bounded authority read succeeds.
    const inventoryRefresh = loadInventoryAvailability();
    evInit(); loadCart(); importCartFromUrl(); injectHeaderCart(); ensureDrawer(); renderCart();
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
    refreshProductionBatches();
    void inventoryRefresh.then((ready) => {
      if (ready) reconcileCartToInventory();
      refreshInventorySurfaces();
      if (!ready && !INVENTORY_READY) retryInventory(1);
    });
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { resumeBatchExposure(); refreshProductionBatches(); } });
  async function checkInventoryAvailability() {
    if (INVENTORY_LOADING) return false;
    const pending = loadInventoryAvailability();
    refreshInventorySurfaces();
    const ready = await pending;
    if (ready) reconcileCartToInventory();
    refreshInventorySurfaces();
    return ready;
  }
  /* Unknown inventory stays closed to purchases without advertising a sellout or waitlist.
     Retry brief failures automatically; the product button can retry again afterward. */
  function retryInventory(attempt) {
    setTimeout(() => {
      if (INVENTORY_READY || INVENTORY_LOADING) return;
      void checkInventoryAvailability().then((ready) => {
        if (!ready && !INVENTORY_READY && attempt < 3) retryInventory(attempt + 1);
      });
    }, 3000 * attempt);
  }
  /* Store recovery is enabled by the server; localhost uses an explicit preview. Only opaque
     journey credentials survive navigation; emails, cart snapshots and codes do not. */
  function createLocalRecoveryJourney({ storage, session, anon, source, mode = "local", transport = fetch, now = Date.now, randomId = evRid }) {
    const key = "store:recovery-preview:journey:v2";
    const types = new Set(["view_item", "view_item_list", "add_to_cart", "view_cart", "begin_checkout", "cart_observed", "cart_updated"]);
    const token = (value) => typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(value) ? value : null;
    const slug = (value) => typeof value === "string" && value.length <= 128 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
    const credential = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
    const lines = (value) => (Array.isArray(value) ? value : []).slice(0, 30).flatMap((line) =>
      line && token(line.id) && token(line.build) && Number.isSafeInteger(line.qty) && line.qty > 0 && line.qty <= 99
        ? [{ id: line.id, build: line.build, qty: line.qty }] : []);
    let credentials = null, queue = Promise.resolve(), lastCart = "", stopped = false;
    const mutations = new Map();
    try {
      const saved = JSON.parse(storage.getItem(key));
      if (saved && saved.session === session && credential(saved.journeyId) && credential(saved.journeyToken) &&
          Number.isSafeInteger(saved.expiresAt) && saved.expiresAt * 1000 > now()) {
        credentials = { journeyId: saved.journeyId, journeyToken: saved.journeyToken, expiresAt: saved.expiresAt };
      }
    } catch (e) {}
    async function request(payload) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const controller = typeof AbortController === "function" ? new AbortController() : null;
          const timer = controller ? setTimeout(() => controller.abort(), ["newsletter", "cart_email"].includes(payload.action) ? 15000 : 5000) : null;
          let response, result;
          try {
            response = await transport("/api/store-recovery", { method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify(payload), keepalive: true, ...(controller ? { signal: controller.signal } : {}) });
            try { result = await response.json(); } catch (e) { result = null; }
          } finally { if (timer != null) clearTimeout(timer); }
          if (!response.ok) {
            if (response.status >= 500 && attempt === 0) continue;
            const error = new Error(result && typeof result.error === "string" ? result.error : "Unable to save this request. Please try again.");
            error.code = result && result.code; error.httpStatus = response.status; throw error;
          }
          if (!result || result.ok !== true) throw new Error("The server did not confirm this request. Please try again.");
          return result;
        } catch (error) { if (attempt || error.httpStatus) throw error; }
      }
    }
    let ready = credentials ? Promise.resolve(credentials) : request({ action: "start", anon: token(anon), session: token(session), source: token(source) }).then((result) => {
      if (!credential(result.journeyId) || !credential(result.journeyToken) || !Number.isSafeInteger(result.expiresAt) || result.expiresAt * 1000 <= now()) throw new Error("Unable to start this visit. Reload the page and try again.");
      credentials = { journeyId: result.journeyId, journeyToken: result.journeyToken, expiresAt: result.expiresAt };
      try { storage.setItem(key, JSON.stringify({ session, ...credentials })); } catch (e) {}
      return credentials;
    });
    ready.catch(() => {});
    function send(action, payload, requestId = randomId()) {
      const task = queue.then(async () => {
        if (stopped) throw new Error("This visit is closed.");
        const identity = await ready;
        return request({ action, journeyId: identity.journeyId, journeyToken: identity.journeyToken, requestId, ...payload });
      });
      queue = task.catch(() => {});
      return task;
    }
    function mutation(action, payload) {
      const fingerprint = JSON.stringify(payload);
      let pending = mutations.get(action);
      if (!pending || pending.fingerprint !== fingerprint) {
        pending = { fingerprint, requestId: randomId() }; mutations.set(action, pending);
      }
      return send(action, payload, pending.requestId).then((result) => {
        if (result.status !== (mode === "local" ? "queued_local" : action === "newsletter" ? "subscribed" : "sent")) throw new Error("The server did not confirm this request. Please try again.");
        if (mode === "local" && action === "cart_email" && (!result.preview || typeof result.preview.subject !== "string" || typeof result.preview.text !== "string" || typeof result.preview.restoreUrl !== "string")) throw new Error("The server did not confirm your cart email. Please try again.");
        if (mutations.get(action) === pending) mutations.delete(action);
        return result;
      });
    }
    async function bounded(promise, timeoutMs) {
      if (!Number.isFinite(timeoutMs)) return promise;
      let timer;
      try { await Promise.race([promise.catch(() => {}), new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); })]); }
      finally { clearTimeout(timer); }
    }
    function recordEvent(type, extra = {}) {
      if (!types.has(type)) return;
      const event = { type };
      if (token(extra.product)) event.product = extra.product;
      if (token(extra.build)) event.build = extra.build;
      if (Number.isSafeInteger(extra.qty) && extra.qty > 0 && extra.qty <= 99) event.qty = extra.qty;
      if (Array.isArray(extra.cart)) event.cart = lines(extra.cart);
      void send("event", event).catch(() => {});
    }
    function recordCart(value, type = "cart_updated") {
      const cart = lines(value), signature = JSON.stringify(cart);
      if (signature === lastCart) return;
      lastCart = signature;
      recordEvent(type === "cart_observed" ? type : "cart_updated", { cart });
    }
    return {
      mode, recordEvent, recordCart,
      newsletter(email, context) {
        if (!context || !slug(context.product) || !slug(context.build)) return Promise.reject(new Error("Newsletter signup is unavailable here."));
        return mutation("newsletter", { email, product: context.product, build: context.build, copyVersion: context.product === "avian-visitors" ? "avian-newsletter-v1" : "store-newsletter-v1" });
      },
      cartEmail: (email, cart) => mutation("cart_email", { email, cart: lines(cart) }),
      restore: (restoreToken) => request({ action: "restore", restoreToken, requestId: randomId() }),
      flush: (timeoutMs) => bounded(queue, timeoutMs),
      async checkoutContext(timeoutMs = 1000) {
        await bounded(queue.then(() => ready), timeoutMs);
        return credentials && credentials.expiresAt * 1000 > now() ? { journeyId: credentials.journeyId, journeyToken: credentials.journeyToken } : {};
      },
      snapshot: () => ({ ready: !!credentials, journeyId: credentials && credentials.journeyId }),
      stop() { stopped = true; },
    };
  }
  function takeRecoveryRestoreToken() {
    let restoreToken = window.__theodoreRestoreToken || "";
    delete window.__theodoreRestoreToken;
    const fragment = new URLSearchParams((location.hash || "").replace(/^#/, ""));
    restoreToken = restoreToken || fragment.get("restore_cart") || "";
    if (fragment.has("restore_cart")) {
      fragment.delete("restore_cart");
      const remaining = fragment.toString();
      history.replaceState(null, "", location.pathname + location.search + (remaining ? "#" + remaining : ""));
    }
    return restoreToken;
  }
  function enableLocalRecoveryPreview({ mode = "local", restoreToken: capturedToken, features = {} } = {}) {
    if (typeof location === "undefined") return false;
    const loopback = ["localhost", "127.0.0.1"].includes(location.hostname);
    if (mode === "local" ? !loopback : !["theodore.net", "www.theodore.net"].includes(location.hostname)) return false;
    const flag = "store:recovery-preview:active:v1";
    try {
      let restoreToken = capturedToken === undefined ? takeRecoveryRestoreToken() : capturedToken;
      if (mode === "local") {
        const requested = new URLSearchParams(location.search).get("recovery-preview");
        if (requested === "0") {
          sessionStorage.removeItem(flag); sessionStorage.removeItem("store:recovery-preview:journey:v1"); sessionStorage.removeItem("store:recovery-preview:journey:v2"); return false;
        }
        if (requested === "1") sessionStorage.setItem(flag, "1");
        if (sessionStorage.getItem(flag) !== "1") return false;
      }
      try { sessionStorage.removeItem("store:recovery-preview:journey:v1"); } catch (e) {}
      localRecovery = createLocalRecoveryJourney({ storage: sessionStorage, session: evSess(), anon: evAnon(), source: evSource(), mode });
      let restoreRequest = null;
      const canonicalCart = (value) => JSON.stringify(sanitizeCart(value).sort((a, b) => (a.id + "|" + a.build).localeCompare(b.id + "|" + b.build)));
      window.TheodoreRecoveryPreview = Object.freeze({ active: true, mode, newsletterEnabled: features.newsletter !== false, cartEmailEnabled: features.cartEmail !== false, hasRestore: !!restoreToken,
        subscribe(email) {
          if (!P || !exactVariant(P, build)) return Promise.reject(new Error("Newsletter signup is unavailable here."));
          localRecovery.recordCart(cart, "cart_observed");
          return localRecovery.newsletter(email, { product: P.id, build });
        },
        emailCart(email) { localRecovery.recordCart(cart, "cart_observed"); return localRecovery.cartEmail(email, cart); },
        restorePending() {
          if (!restoreRequest && restoreToken) { restoreRequest = localRecovery.restore(restoreToken); restoreToken = ""; }
          return restoreRequest || Promise.resolve(null);
        },
        compareRestore(value) {
          loadCart(); renderCart();
          return { signature: canonicalCart(cart), conflict: cart.length > 0 && canonicalCart(cart) !== canonicalCart(value) };
        },
        applyRestore(value, expected) {
          loadCart();
          if (canonicalCart(cart) !== expected) return false;
          cart = sanitizeCart(value); saveCart(); renderCart(); openCart();
          return true;
        },
        keepCart() { loadCart(); renderCart(); openCart(); },
        snapshot: () => localRecovery.snapshot(),
      });
      return true;
    } catch (e) { return false; }
  }
  function loadRecoveryInterface() {
    const style = document.createElement("link");
    style.rel = "stylesheet"; style.href = "/assets/css/store-recovery-preview.css?v=20261103-2";
    document.head.appendChild(style);
    const script = document.createElement("script");
    script.src = "/assets/js/store-recovery-preview.js?v=20261103-2";
    document.head.appendChild(script);
  }
  async function enableLiveRecovery() {
    if (typeof location === "undefined" || location.protocol !== "https:" ||
        !["theodore.net", "www.theodore.net"].includes(location.hostname) || !/^\/store(?:\/|$)/.test(location.pathname)) return;
    const restoreToken = takeRecoveryRestoreToken();
    recoveryBootstrapPending = true;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 2500) : null;
    try {
      const response = await fetch("/api/store-recovery?status=1", { cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      const features = await response.json();
      if (!response.ok || !features || !features.enabled || features.mode !== "live") return;
      if (!enableLocalRecoveryPreview({ mode: "live", restoreToken, features })) return;
      for (const event of recoveryEventBuffer) localRecovery.recordEvent(event.type, event.extra);
      loadRecoveryInterface();
    } catch (e) { /* Tracking and optional forms cannot block shopping. */ }
    finally {
      if (timer !== null) clearTimeout(timer);
      recoveryBootstrapPending = false; recoveryEventBuffer.length = 0;
    }
  }
  async function recoveryCheckoutContext() {
    const deadline = Date.now() + 1000;
    if (!localRecovery && recoveryBootstrapReady) {
      let timer;
      try { await Promise.race([recoveryBootstrapReady, new Promise((resolve) => { timer = setTimeout(resolve, 1000); })]); }
      catch (e) { /* Optional tracking cannot stop payment. */ }
      finally { clearTimeout(timer); }
    }
    if (!localRecovery) return {};
    try { return await localRecovery.checkoutContext(Math.max(0, deadline - Date.now())); } catch (e) { return {}; }
  }
  const localRecoveryPreviewActive = enableLocalRecoveryPreview();
  if (!localRecoveryPreviewActive) recoveryBootstrapReady = enableLiveRecovery();
  let booted = false;
  function boot() { if (booted) return; booted = true; void init(); }
  // Boot as soon as this deferred script runs; document$ / DOMContentLoaded
  // stay as fallbacks. The guard makes init run exactly once.
  if (typeof window.document$ !== "undefined" && window.document$.subscribe) window.document$.subscribe(boot);
  if (document.readyState !== "loading") boot();
  else document.addEventListener("DOMContentLoaded", boot);
  if (localRecoveryPreviewActive) loadRecoveryInterface();
})();
