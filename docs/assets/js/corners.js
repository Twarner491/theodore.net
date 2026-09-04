// Continuous-curve (squircle) corner smoothing, powered by @lisse/core
// (https://corne.rs). The vendored ESM core generates the Figma-smoothing
// paths; for each rounded surface we clip it to a squircle and, where it has a
// visible border, draw that border as a squircle *ring* (outer minus inner
// squircle) so the outline follows the smooth corner instead of being cut.
// Image/iframe leaves (which can't host the ring child) are clipped and have
// their border stripped — their framing comes from the parent card.
(function () {
  var SMOOTHING = 0.6;
  var SELECTOR = [
    '.imgparent', '.imgparent img', '.grid-item',
    '.product-card', '.pe-frame', '.cart-line-img', '.store-mini-img',
    '.md-typeset .kit-card', '.md-typeset .kit-card__imgwrap', '.md-typeset .kit-card__imgwrap img', '.cart-drawer',   // embeddable product card (outer card + thumb frame + image, squircled) + the cart drawer's rounded left edge
    '.md-typeset .embed-frame',
    '.md-typeset .embed-frame iframe',
    '.md-typeset .embed-frame .embed-inner',
    '.md-typeset .bom-table', '.md-typeset .admonition:not(details)',   // materials table + (static) admonition boxes; <details> hides child nodes when collapsed, so it can't host a ring
    '.md-typeset .twitter-tweet', '.md-typeset .twitter-tweet iframe',  // tweet frame (ring on the wrapper, iframe clipped as a leaf)
    '.tw-card', '.tw-card-thumb', '.tw-card-thumb img'
  ].join(',');   /* .tw-panel uses a plain border-radius so its gray line sits crisply on the edge (the squircle ring renders inset on a contrasting backdrop) */

  var L = null;                 // @lisse/core module
  var mgmt = new WeakMap();     // el -> { ring, posSet }
  var seen = new WeakSet();     // observed for resize

  function isLeaf(el) { var t = el.tagName; return t === 'IMG' || t === 'IFRAME' || t === 'VIDEO' || t === 'CANVAS'; }
  function invisible(color) { return !color || color === 'transparent' || color.indexOf('rgba(0, 0, 0, 0)') === 0; }

  // Shift the absolute (M/L) coordinates of a lisse path by d; relative c/a
  // segments are untouched. Used to inset the ring's inner squircle.
  function offsetPath(p, d) {
    return p.replace(/([ML]) (-?[\d.]+) (-?[\d.]+)/g, function (_, c, x, y) {
      return c + ' ' + (parseFloat(x) + d).toFixed(4) + ' ' + (parseFloat(y) + d).toFixed(4);
    });
  }

  function apply(el) {
    // Measure the untransformed BORDER box. getBoundingClientRect() includes transforms applied to
    // the element or any ancestor; when ResizeObserver re-fits a child during a card's scale hover,
    // using that visual size bakes the scale into the path/ring and the browser then scales it again.
    // The result is a double-scaled right/bottom edge that visibly catches up after pointer-out.
    // Lisse's layout-space helper preserves sub-pixels and adds padding/borders for content-box nodes.
    var size = L.getLayoutSize(el);
    var w = size.width, h = size.height;
    if (!w || !h) return;
    var radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    if (radius <= 1 || radius >= Math.min(w, h) / 2) { release(el); return; }

    el.style.clipPath = L.generateClipPath(w, h, { radius: radius, smoothing: SMOOTHING });

    // Read the true (themed) border by clearing any inline override first.
    el.style.removeProperty('border-color');
    var cs = getComputedStyle(el);
    var bw = parseFloat(cs.borderTopWidth) || 0;
    var bc = cs.borderTopColor;
    var hasBorder = bw > 0 && !invisible(bc);

    if (isLeaf(el)) {                       // can't host the ring child
      if (hasBorder) el.style.setProperty('border-color', 'transparent', 'important');
      return;
    }
    if (!hasBorder) { dropRing(el); return; }

    el.style.setProperty('border-color', 'transparent', 'important');
    // The ring sits in the border region (just outside the padding box), so a host with
    // overflow:hidden (e.g. .grid-item, .product-card) clips it away. The clip-path we set on
    // the host already clips its content to the squircle, so overflow:hidden is redundant —
    // force it visible so the ring shows. (Restored in release().)
    el.style.setProperty('overflow', 'visible', 'important');
    // Promote the ringed host to its own compositing layer so the clip-path's bottom band paints at
    // rest. Without this, Chrome can drop the outline's bottom edge on large cards until a hover
    // transform forces a repaint. will-change (not an inline transform) keeps the host's own :hover
    // scale working. Cleared in release().
    el.style.willChange = 'transform';
    var rec = mgmt.get(el);
    if (!rec) {
      rec = {};
      if (getComputedStyle(el).position === 'static') { el.style.position = 'relative'; rec.posSet = true; }
      rec.ring = document.createElement('div');
      rec.ring.className = 'sr-corner-ring';
      rec.ring.setAttribute('aria-hidden', 'true');
      el.appendChild(rec.ring);
      mgmt.set(el, rec);
    }
    var outer = L.generatePath(w, h, { radius: radius, smoothing: SMOOTHING });
    var inner = offsetPath(L.generatePath(Math.max(1, w - 2 * bw), Math.max(1, h - 2 * bw),
      { radius: Math.max(0, radius - bw), smoothing: SMOOTHING }), bw);
    // Size the ring EXPLICITLY to the measured border box (w,h) and offset it out by the border
    // width, rather than deriving its size from inset:0/-bw. inset auto-derives the height from the
    // containing block's padding box, which for some boxes (e.g. admonitions) is shorter than
    // border-box − 2·border, leaving the ring's bottom band unrendered. Explicit w/h matches the
    // clip-path (also built at w,h) exactly, on every box.
    rec.ring.style.cssText = 'position:absolute;top:' + (-bw) + 'px;left:' + (-bw) + 'px;width:' + w + 'px;height:' + h + 'px;pointer-events:none;z-index:1;' +
      'background:' + bc + ';clip-path:path(evenodd,"' + outer + ' ' + inner + '");';
  }

  function dropRing(el) {
    var rec = mgmt.get(el);
    if (rec) { if (rec.ring) rec.ring.remove(); if (rec.posSet) el.style.position = ''; mgmt.delete(el); }
  }
  function release(el) {
    el.style.clipPath = '';
    el.style.removeProperty('border-color');
    el.style.removeProperty('overflow');   // restore the host's own overflow (we forced it visible for the ring)
    el.style.removeProperty('will-change');
    dropRing(el);
  }

  function scan() {
    if (!L) return;
    document.querySelectorAll(SELECTOR).forEach(function (el) {
      apply(el);
      if (!seen.has(el)) { seen.add(el); L.observeResize(el, function () { apply(el); }); }
    });
  }

  function ready(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }

  import('/assets/js/vendor/lisse/index.js').then(function (mod) {
    L = mod;
    ready(scan);
    window.addEventListener('load', scan);
    // Re-fit on viewport resize. The per-element resize observer can miss viewport-driven reflows
    // (e.g. moving the window from a laptop to a large monitor), leaving the ring + clip-path sized
    // for the old dimensions — which cut off the card's bottom edge until a repaint. Debounced.
    var resizeT;
    window.addEventListener('resize', function () { clearTimeout(resizeT); resizeT = setTimeout(scan, 150); });
    // re-fit once web fonts finish loading: text-driven boxes (admonitions, etc.) reflow
    // taller after fonts swap in, and the initial ring would otherwise stay at the short size.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(scan);

    var sub = setInterval(function () {
      if (typeof document$ !== 'undefined') { clearInterval(sub); document$.subscribe(function () { scan(); }); }
    }, 100);

    if (window.MutationObserver) {
      var pending = false;
      var mo = new MutationObserver(function () {
        if (pending) return;
        pending = true;
        requestAnimationFrame(function () { pending = false; scan(); });
      });
      ready(function () { mo.observe(document.body, { childList: true, subtree: true }); });

      // Re-colour rings when the colour scheme toggles.
      var themeObs = new MutationObserver(function () { scan(); });
      ready(function () {
        themeObs.observe(document.body, { attributes: true, attributeFilter: ['data-md-color-scheme'] });
        themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-md-color-scheme'] });
      });
    }
  }).catch(function (e) { if (window.console) console.warn('corners: lisse load failed', e); });
})();
