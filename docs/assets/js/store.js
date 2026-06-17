/* store.js for theodore.net/store
   The store index shows a grid of cards that link to per-product pages. Each
   product page renders an image carousel and the buy options into
   #product-detail. The cart lives behind a header bag icon and a right drawer,
   in localStorage. No payments yet; checkout is stubbed for the Stripe +
   Cloudflare backend. Set DEV_SHOW_UNPUBLISHED false before publishing. */
(function () {
  "use strict";

  const DEV_SHOW_UNPUBLISHED = true; // false before publishing
  const CART_KEY = "store:cart:v3";

  const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 6 18 18M18 6 6 18"/></svg>';
  const ICON_BAG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6h-2c0-2.8-2.2-5-5-5S7 3.2 7 6H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2m-7-3c1.7 0 3 1.3 3 3H9c0-1.7 1.3-3 3-3m7 17H5V8h14zm-7-8c-1.7 0-3-1.3-3-3H7c0 2.8 2.2 5 5 5s5-2.2 5-5h-2c0 1.7-1.3 3-3 3"/></svg>';

  const PRODUCTS = [
    {
      id: "avian-visitors", published: true, title: "Avian Visitors",
      teaser: "A framed e-ink that displays the birds heard nearby.",
      sub: "A wood-framed colorful e-ink display that collages the birds heard nearby.",
      imageBase: "/assets/images/AvianVisitors/",
      images: ["heard-today.png", "framedeink.JPG", "raweink.JPG"],
      defaultBuild: "electronics",
      variants: [
        { id: "assembled", label: "Assembled", price: null, comingSoon: true,
          desc: "Finished, framed, ready to hang. In redesign around a smaller colour panel.",
          contents: ["Framed colour e-ink display", "Pre-configured Pi", "Ready to hang"] },
        { id: "electronics", label: "Electronics Kit", price: 189,
          desc: "Pi, colour e-ink panel, and driver. Bring your own frame and mat.",
          contents: ["Raspberry Pi Zero 2 W", "Colour e-ink panel", "microSD card", "Power and cabling"] },
        { id: "electronics-printed", label: "+ Frame & Parts", price: 249,
          desc: "Electronics plus the printed backplate and a finished wood frame with mat.",
          contents: ["Everything in the Electronics Kit", "Printed backplate", "Wood frame and mat"] }
      ],
      softwareNote: "Hardware only. You install the open-source software on your own device at first setup.",
      sections: [
        { label: "Technical specs", items: ["Raspberry Pi Zero 2 W", "Colour e-ink panel", "USB-C power", "Wi-Fi, set up from your phone"] },
        { label: "Dimensions", items: ["Frame and shipping sizes listed here"] }
      ],
      colophon: 'Sold as hardware. The open-source BirdNET software and Cornell’s model install onto your own device on first setup, for personal use; they are not pre-loaded or resold. Bird ID by <a href="https://birdnet.cornell.edu/" target="_blank" rel="noopener">BirdNET</a>, Cornell Lab of Ornithology (CC BY-NC-SA 4.0).'
    },

    {
      id: "avian-mic", published: false, title: "Bird Mic",
      teaser: "A tiny microphone that feeds your own bird screen.",
      sub: "A small microphone setup that listens at your window and feeds your Avian Visitors screen with the birds you hear.",
      imageBase: "/assets/images/AvianVisitors/",
      images: ["bird-mic.png", "mountedpi.JPG", "collage.png"],
      defaultBuild: "electronics",
      variants: [
        { id: "electronics", label: "Electronics Kit", price: 149,
          desc: "Raspberry Pi, a curated USB microphone, and a pre-flashed card.",
          contents: ["Raspberry Pi", "Curated USB microphone", "microSD card", "Power and cabling"] },
        { id: "electronics-printed", label: "+ 3D Printed", price: 179,
          desc: "The electronics kit plus a printed mount.",
          contents: ["Everything in the Electronics Kit", "3D-printed mount"] }
      ],
      softwareNote: "Hardware only. You install the open-source software on your own device at first setup.",
      sections: [
        { label: "Technical specs", items: ["Raspberry Pi", "Curated USB microphone", "USB-C power"] },
        { label: "Dimensions", items: ["Mount and shipping sizes listed here"] }
      ],
      colophon: 'Sold as hardware. BirdNET software and Cornell’s model install on your own device for personal use. Bird ID by <a href="https://birdnet.cornell.edu/" target="_blank" rel="noopener">BirdNET</a>, Cornell Lab of Ornithology (CC BY-NC-SA 4.0).'
    },

    {
      id: "polargraph", published: false, title: "Polargraph Plotter",
      teaser: "A wall-hung machine that draws generative art in ink.",
      sub: "A wall-mounted drawing machine that plots generative art straight onto paper.",
      imageBase: "/assets/images/Polargraph/",
      images: ["kit.png", "mountedPoalrgraph.JPG", "wall.jpg", "firstPlotResult.JPG"],
      defaultBuild: "electronics",
      variants: [
        { id: "electronics", label: "Electronics Kit", price: 329,
          desc: "The motors, drivers, controller, and gondola. The hard-to-source mechatronics.",
          contents: ["2× NEMA-17 motors + drivers", "Controller board", "Gondola + servo pen-lift", "Belts, pulleys, hardware"] },
        { id: "electronics-printed", label: "+ 3D Printed Parts", price: 399,
          desc: "Add every printed part. You source the lumber locally.",
          contents: ["Everything in the Electronics Kit", "All printed parts", "Pen holders + counterweights"] }
      ],
      sections: [
        { label: "Technical specs", items: ["2× NEMA-17 motors and drivers", "Controller board", "Servo pen-lift gondola"] },
        { label: "Dimensions", items: ["Plot area and shipping sizes listed here"] }
      ],
      colophon: ""
    }
  ];

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const money = (n) => "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
  const getProduct = (id) => PRODUCTS.find((p) => p.id === id);
  const visibleProducts = () => PRODUCTS.filter((p) => p.published || DEV_SHOW_UNPUBLISHED);
  const buyable = (v) => v && !v.comingSoon && v.price != null;
  const variantById = (p, id) => p.variants.find((v) => v.id === id) || p.variants[0];
  const carouselUrls = (p) => (p.images || []).map((f) => p.imageBase + f);
  const minPrice = (p) => { const ps = p.variants.filter(buyable).map((v) => v.price); return ps.length ? Math.min.apply(null, ps) : null; };
  const defaultBuyBuild = (p) => { const d = p.variants.find((v) => v.id === p.defaultBuild); if (buyable(d)) return d.id; const b = p.variants.find(buyable); return b ? b.id : null; };

  /* cart: line = { id, build, qty } */
  let cart = [];
  const loadCart = () => { try { cart = JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch (e) { cart = []; } };
  const saveCart = () => { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {} };
  const cartCount = () => cart.reduce((n, l) => n + l.qty, 0);
  const cartSubtotal = () => cart.reduce((s, l) => { const p = getProduct(l.id); if (!p) return s; const v = variantById(p, l.build); return s + (v.price ? v.price * l.qty : 0); }, 0);
  function addToCart(id, build, qty) {
    const ex = cart.find((l) => l.id === id && l.build === build);
    if (ex) ex.qty += qty; else cart.push({ id, build, qty });
    saveCart(); renderCart(); updateBadge(true); openCart();
  }
  function setLineQty(i, qty) { if (qty <= 0) cart.splice(i, 1); else cart[i].qty = qty; saveCart(); renderCart(); }

  /* ---- store index grid: cards link to /store/<id>/ ---- */
  function renderGrid() {
    const grid = $("#store-grid");
    if (!grid) return;
    grid.innerHTML = "";
    visibleProducts().forEach((p) => {
      const hero = carouselUrls(p)[0];
      const mp = minPrice(p);
      const buyBuild = defaultBuyBuild(p);
      const card = document.createElement("div");
      card.className = "product-card";
      card.innerHTML =
        '<a class="pc-stretch" href="/store/' + p.id + '/" aria-label="' + p.title + '"></a>' +
        '<div class="pc-imgwrap">' + (hero ? '<img class="pc-img" src="' + hero + '" alt="' + p.title + '" loading="lazy">' : '<span class="pc-img"></span>') + "</div>" +
        '<div class="pc-body">' + (buyBuild ? '<button class="pc-add" type="button" aria-label="Add to cart"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>' : "") +
          '<p class="pc-title">' + p.title + '</p><p class="pc-desc">' + p.teaser + '</p>' +
          '<p class="pc-price">' + (mp != null ? '<span class="from">from</span>' + money(mp) : "Coming soon") + "</p></div>";
      const add = card.querySelector(".pc-add");
      if (add) add.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); addToCart(p.id, buyBuild, 1); });
      grid.appendChild(card);
    });
    reveal();
  }

  /* ---- product detail page ---- */
  let root, P, build, qty = 1, slide = 0;

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
  function detailHTML(p) {
    const builds = p.variants.map((v) => '<button type="button" data-opt="' + v.id + '">' + v.label + "</button>").join("");
    return (
      '<div class="return2feed"><a href="/store"><i class="fa-solid fa-arrow-left-long" aria-hidden="true"></i> Store</a></div>' +
      '<div class="pd-media"><div class="pe-carousel">' +
        '<button class="pe-arrow prev" type="button" aria-label="Previous"><i class="fa-solid fa-chevron-left"></i></button>' +
        '<div class="pe-frame"><div class="pe-slides"></div></div>' +
        '<button class="pe-arrow next" type="button" aria-label="Next"><i class="fa-solid fa-chevron-right"></i></button>' +
      '</div><div class="pe-dots"></div></div>' +
      '<div class="pd-info"><h2 class="pe-title">' + p.title + "</h2><p class=\"pe-sub\">" + (p.sub || "") + "</p>" +
        '<div class="opt-seg" data-group="build"><i class="opt-pill" aria-hidden="true"></i>' + builds + "</div>" +
        '<p class="pe-variant-desc"></p>' +
        '<div class="pe-buyrow"><div class="pe-price"></div><div class="pe-qty"><button type="button" data-q="-1" aria-label="less">−</button><span>1</span><button type="button" data-q="1" aria-label="more">+</button></div></div>' +
        '<button class="pe-buy" type="button"></button><div class="pe-waitlist" hidden></div>' +
        (p.softwareNote ? '<p class="pe-softnote">' + p.softwareNote + "</p>" : "") +
        detailSections(p) +
      "</div>"
    );
  }

  function renderDetail(p) {
    root = $("#product-detail");
    if (!root) return;
    P = p; build = p.defaultBuild || p.variants[0].id; qty = 1;
    root.innerHTML = detailHTML(p);
    renderCarousel(); wireDetail(); updateVariant();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncPill);
  }

  function renderCarousel() {
    const urls = carouselUrls(P);
    slide = 0;
    $(".pe-slides", root).innerHTML = urls.map((u, i) => '<div class="pe-slide' + (i ? "" : " active") + '"><img src="' + u + '" alt=""></div>').join("");
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
  window.addEventListener("resize", () => { if (document.getElementById("product-detail")) syncPill(); });
  function updateVariant() {
    const v = variantById(P, build);
    $$(".opt-seg button", root).forEach((b) => b.setAttribute("aria-current", b.dataset.opt === build ? "true" : "false"));
    syncPill();
    $(".pe-variant-desc", root).textContent = v.desc || "";
    $(".pe-box-contents", root).innerHTML = (v.contents || []).map((c) => "<li>" + c + "</li>").join("");
    $(".pe-qty span", root).textContent = String(qty);
    $(".pe-price", root).innerHTML = buyable(v) ? money(v.price) : '<span style="opacity:.7">Coming soon</span>';
    $(".pe-qty", root).style.display = buyable(v) ? "inline-flex" : "none";
    const buy = $(".pe-buy", root);
    const wl = $(".pe-waitlist", root);
    if (wl) { wl.hidden = true; wl.innerHTML = ""; }
    buy.style.display = ""; buy.disabled = false;
    if (buyable(v)) { buy.classList.remove("is-waitlist"); buy.innerHTML = "<span>Add to cart</span><span>" + money(v.price * qty) + "</span>"; }
    else { buy.classList.add("is-waitlist"); buy.textContent = "Join the waitlist"; }
  }
  function wireDetail() {
    $$(".opt-seg button", root).forEach((b) => b.addEventListener("click", () => { build = b.dataset.opt; qty = 1; updateVariant(); }));
    wireSlider();
    $(".pe-arrow.prev", root).addEventListener("click", () => goto(slide - 1));
    $(".pe-arrow.next", root).addEventListener("click", () => goto(slide + 1));
    $$(".pe-qty button", root).forEach((b) => b.addEventListener("click", () => {
      qty = Math.max(1, qty + (+b.dataset.q));
      const v = variantById(P, build);
      $(".pe-qty span", root).textContent = String(qty);
      if (buyable(v)) $(".pe-buy", root).innerHTML = "<span>Add to cart</span><span>" + money(v.price * qty) + "</span>";
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
    $(".pe-buy", root).style.display = "none";
    wl.hidden = false;
    wl.innerHTML = '<form class="pe-wl-form"><input type="email" required placeholder="you@email.com" aria-label="Email for the waitlist"><button type="submit" aria-label="Join the waitlist"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></form>';
    $("input", wl).focus();
    $(".pe-wl-form", wl).addEventListener("submit", (e) => {
      e.preventDefault();
      // TODO(waitlist): POST $("input", wl).value to the Cloudflare waitlist endpoint (alongside the Stripe backend)
      wl.innerHTML = '<p class="pe-wl-done">Thanks, you’re on the list.</p>';
    });
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
    btn.addEventListener("click", openCart);
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
      '<button class="cart-checkout" type="button" disabled>Checkout</button></div>';
    document.body.appendChild(scrim); document.body.appendChild(drawer);
    $(".cart-close", drawer).addEventListener("click", closeCart);
    $(".cart-checkout", drawer).addEventListener("click", checkout);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCart(); });
  }
  function openCart() { ensureDrawer(); renderCart(); drawer.classList.add("is-open"); scrim.classList.add("is-open"); }
  function closeCart() { if (drawer) { drawer.classList.remove("is-open"); scrim.classList.remove("is-open"); } }
  function renderCart() {
    ensureDrawer(); updateBadge();
    const items = $(".cart-items", drawer);
    if (!cart.length) { items.innerHTML = '<p class="cart-empty">Your cart is empty.</p><a class="cart-shop-link" href="/store">Go to store</a>'; }
    else {
      items.innerHTML = cart.map((l, i) => {
        const p = getProduct(l.id), v = variantById(p, l.build), hero = carouselUrls(p)[0];
        return '<div class="cart-line">' + (hero ? '<img class="cart-line-img" src="' + hero + '" alt="">' : '<span class="cart-line-img"></span>') +
          '<div class="cart-line-meta"><div class="cart-line-info"><p class="cart-line-title">' + p.title + '</p><p class="cart-line-variant">' + v.label + "</p></div>" +
          '<div class="cart-line-qty"><button type="button" data-i="' + i + '" data-q="-1">−</button><span>' + l.qty + '</span><button type="button" data-i="' + i + '" data-q="1">+</button></div></div>' +
          '<div class="cart-line-side"><div class="cart-line-price">' + money((v.price || 0) * l.qty) + '</div><button class="cart-line-remove" type="button" data-rm="' + i + '">remove</button></div></div>';
      }).join("") + '<button class="cart-shop-link" type="button">Continue shopping</button>';
      $$(".cart-line-qty button", items).forEach((b) => b.addEventListener("click", () => setLineQty(+b.dataset.i, cart[+b.dataset.i].qty + (+b.dataset.q))));
      $$("[data-rm]", items).forEach((b) => b.addEventListener("click", () => setLineQty(+b.dataset.rm, 0)));
    }
    $$(".cart-shop-link", items).forEach((el) => el.addEventListener("click", closeCart));
    $(".cart-sub-val", drawer).textContent = money(cartSubtotal());
    $(".cart-checkout", drawer).disabled = !cart.length;
  }
  function checkout() {
    // Stripe Payment Element via a Cloudflare Function goes here.
    const b = $(".cart-checkout", drawer);
    b.textContent = "Stripe checkout wires in next";
    b.disabled = true;
    setTimeout(() => { b.textContent = "Checkout"; b.disabled = !cart.length; }, 2200);
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
  function init() {
    injectHeaderCart(); loadCart(); ensureDrawer(); renderCart();
    if ($("#store-grid")) renderGrid();
    else if ($("#product-detail")) { const p = getProduct($("#product-detail").dataset.product); if (p) renderDetail(p); reveal(); }
    else reveal();
  }
  if (typeof window.document$ !== "undefined" && window.document$.subscribe) window.document$.subscribe(init);
  else if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
