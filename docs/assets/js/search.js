// Self-contained site search. Our icon replaces Material's (hidden); on open the
// bar lifts out of the header into <html> (above one page-wide scrim, so the whole
// page incl. the header dims uniformly), expands in place, then the panel drops.
// Browse = Projects / Writings / Store rows of typed cards (click a heading to
// scope to that type); typing = a writings-index-style list. Projects, writings
// and store products are baked into /search-data.json at build time, so search
// works everywhere. UI opens immediately; Fuse.js loads in the background.
(function () {
  var DATA_URL = '/search-data.json';
  var HINTS = ['bird projects', 'cnc milling', 'generative art', 'aquaponics', 'on turning twenty', 'a pizza machine'];
  // Shuffle (Fisher-Yates) so the rotating "try '…'" suggestions go in a different order each load.
  for (var _h = HINTS.length - 1; _h > 0; _h--) { var _r = Math.floor(Math.random() * (_h + 1)), _t = HINTS[_h]; HINTS[_h] = HINTS[_r]; HINTS[_r] = _t; }
  var Fuse = null, fuse = null, items = null, loaded = false;
  var root, bar, input, hint, hintWord, clearBtn, panel, panelScroll, scrim, placeholder;
  var scope = null, activeIdx = -1, openState = false, openGen = 0;
  var debounce, openT, closeT, closeT2, hintT, hintFade, heightT, hintI = 0;

  function isMobile() { return window.matchMedia('(max-width: 600px)').matches; }
  function isFullPage() { return window.matchMedia('(max-width: 1024px), (pointer: coarse) and (max-width: 1366px)').matches; }   // matches the full-page CSS
  function esc(s) { return (s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function isActive() { return openState; }
  // only ever navigate to same-origin paths from the (build-time) index
  function safeHref(u) { return (typeof u === 'string' && /^\/(?!\/)/.test(u)) ? u : '#'; }
  function price(p) { return typeof p === 'number' && isFinite(p) ? 'from $' + p : ''; }

  // ---------- data ----------
  function load() {
    if (fuse) return Promise.resolve();
    var fp = Fuse ? Promise.resolve() : import('/assets/js/vendor/fuse/fuse.js').then(function (m) { Fuse = m.default || m; });
    var dp = loaded ? Promise.resolve() : fetch(DATA_URL).then(function (r) { return r.json(); })
      .then(function (j) { items = (j && j.items) || []; loaded = true; }).catch(function () { items = []; loaded = true; });
    return Promise.all([fp, dp]).then(function () {
      fuse = new Fuse(items || [], { ignoreLocation: true, threshold: 0.25, minMatchCharLength: 2, includeScore: true,
        keys: [{ name: 'title', weight: 0.5 }, { name: 'keywords', weight: 0.38 }, { name: 'description', weight: 0.12 }] });
    });
  }
  function byType(t) { return (items || []).filter(function (it) { return it.type === t; }); }
  function search(q) {
    if (!fuse) return [];
    q = q.trim(); if (!q) return [];
    var run = function (term) { return fuse.search(term, { limit: 30 }); };
    var tokens = q.toLowerCase().split(/\s+/).filter(function (t) { return t.length >= 2; });
    var list;
    if (tokens.length <= 1) { list = run(q).map(function (r) { return r.item; }); }
    else {
      var agg = {};
      tokens.forEach(function (t) { run(t).forEach(function (r) { var k = r.item.url; if (!agg[k]) agg[k] = { item: r.item, n: 0, s: 0 }; agg[k].n++; agg[k].s += (r.score || 0); }); });
      run(q).forEach(function (r) { if (agg[r.item.url]) agg[r.item.url].n += 0.5; });
      list = Object.keys(agg).map(function (k) { return agg[k]; }).sort(function (a, b) { return (b.n - a.n) || (a.s - b.s); }).map(function (x) { return x.item; });
    }
    return scope ? list.filter(function (it) { return it.type === scope; }) : list;
  }

  // ---------- browse cards ----------
  function cardEl(it) {
    var a = document.createElement('a'); a.className = 'tw-card tw-card-' + it.type; a.href = safeHref(it.url);
    var thumb = it.thumbnail ? '<span class="tw-card-thumb"><img src="' + esc(it.thumbnail) + '" alt="" loading="lazy"></span>' : '';
    if (it.type === 'writing') {
      a.innerHTML = '<span class="tw-card-body"><span class="tw-card-title">' + esc(it.title) + '</span></span>';   // title only
    } else if (it.type === 'product') {
      a.innerHTML = thumb + '<span class="tw-card-body"><span class="tw-card-title">' + esc(it.title) + '</span>' + (price(it.price) ? '<span class="tw-card-price">' + price(it.price) + '</span>' : '') + '</span>';
    } else {
      a.innerHTML = thumb + '<span class="tw-card-body"><span class="tw-card-title">' + esc(it.title) + '</span><span class="tw-card-desc">' + esc(it.description) + '</span></span>';
    }
    return a;
  }
  function updateScrollFades(scroll) {   // left fade only once scrolled, right fade off at the end (both off if it all fits)
    var wrap = scroll.parentElement; if (!wrap) return;
    var max = scroll.scrollWidth - scroll.clientWidth;
    wrap.classList.toggle('tw-scroll-start', scroll.scrollLeft <= 1);
    wrap.classList.toggle('tw-scroll-end', scroll.scrollLeft >= max - 1);
  }
  function section(label, type, list, si) {
    var sec = document.createElement('div'); sec.className = 'tw-sec' + (scope === type ? ' tw-sec-active' : '');
    var h = document.createElement('button'); h.type = 'button'; h.className = 'tw-sec-h'; h.setAttribute('data-scope', type); h.textContent = label;
    var wrap = document.createElement('div'); wrap.className = 'tw-scroll-wrap tw-scroll-start';   // left fade off until scrolled
    var scroll = document.createElement('div'); scroll.className = 'tw-scroll';
    scroll.addEventListener('scroll', function () { updateScrollFades(scroll); });
    list.forEach(function (it, ci) {
      var c = cardEl(it);
      c.style.animationDelay = ((si || 0) * 0.06 + ci * 0.04).toFixed(3) + 's';   // staggered, diagonal left→right reveal
      scroll.appendChild(c);
    });
    wrap.appendChild(scroll); sec.appendChild(h); sec.appendChild(wrap);
    return sec;
  }
  function renderBrowse() {
    panelScroll.innerHTML = ''; panel.classList.remove('tw-results'); panel.classList.remove('tw-scrollable');
    if (isFullPage()) { panelScroll.innerHTML = '<div class="tw-empty">Search projects, writings &amp; store</div>'; return; }  // cards are a desktop-only default
    var si = 0;
    [['Projects', 'project'], ['Writings', 'writing'], ['Store', 'product']].forEach(function (d) {
      if (scope && scope !== d[1]) return;
      var list = byType(d[1]); if (!list.length) return;
      panelScroll.appendChild(section(d[0], d[1], list.slice(0, scope ? 24 : 12), si++));
    });
    setTimeout(function () { panelScroll.querySelectorAll('.tw-scroll').forEach(function (s) { updateScrollFades(s); }); }, 0);   // set right-fade state once cards are laid out
  }

  // ---------- results (writings-index style) ----------
  function rowEl(it) {
    var a = document.createElement('a'); a.className = 'tw-row' + (it.type === 'product' ? ' tw-row-product' : ''); a.href = safeHref(it.url); a.setAttribute('role', 'option');
    var aside = it.type === 'product' ? price(it.price) : esc(it.date || '');
    var sub = it.type === 'writing' ? esc(it.readtime || '') : '';
    var thumb = (it.type === 'product' && it.thumbnail) ? '<span class="tw-row-thumb"><img src="' + esc(it.thumbnail) + '" alt="" loading="lazy"></span>' : '';   // products get an inline graphic; projects/writings stay text-only
    a.innerHTML = thumb +
      '<span class="tw-row-main">' +
        '<span class="tw-row-top"><span class="tw-row-title">' + esc(it.title) + '</span><span class="tw-row-aside">' + aside + '</span></span>' +
        '<span class="tw-row-sub"><span class="tw-row-desc">' + esc(it.description || '') + '</span><span class="tw-row-aside2">' + sub + '</span></span>' +
      '</span>';
    return a;
  }
  function renderResults(list, q) {
    activeIdx = -1; panel.classList.add('tw-results');
    if (!list.length) { panelScroll.innerHTML = '<div class="tw-empty">No results' + (scope ? ' in ' + scope + 's' : '') + ' for “' + esc(q) + '”</div>'; panel.classList.remove('tw-scrollable'); return; }
    panelScroll.innerHTML = '';
    var wrap = document.createElement('div'); wrap.className = 'tw-list';
    list.forEach(function (it) { wrap.appendChild(rowEl(it)); });
    panelScroll.appendChild(wrap);
    setTimeout(function () { if (panel && openState) panel.classList.toggle('tw-scrollable', panelScroll.scrollHeight > panelScroll.clientHeight + 2); }, 0);
  }
  function update() {
    if (!openState) return;
    // capture the current height BEFORE re-rendering, so we can sleekly animate to the new one
    var fromH = (panel.classList.contains('tw-shown') && !isFullPage()) ? panel.offsetHeight : -1;
    var q = input.value;
    clearBtn.style.display = q ? 'flex' : 'none';
    if (q.trim()) { stopHint(); renderResults(search(q), q); }
    else { startHint(); renderBrowse(); }
    if (fromH >= 0) animateHeight(fromH);   // e.g. applying/clearing a section filter
  }
  function animateHeight(fromH) {
    panel.style.height = '';                // back to auto to measure the target
    var toH = panel.offsetHeight;
    if (Math.abs(fromH - toH) < 2) return;
    panel.style.height = fromH + 'px';
    void panel.offsetWidth;                 // commit the start height…
    panel.style.height = toH + 'px';        // …then transition to the new height
    clearTimeout(heightT);
    heightT = setTimeout(function () { if (openState) panel.style.height = ''; }, 360);
  }

  // ---------- rotating "try '…'" hint (only the quoted word cycles) ----------
  function showHint() { hintWord.textContent = '‘' + HINTS[hintI % HINTS.length] + '’'; }   // quotes ride with the word so they cross-fade together
  function startHint() {
    if (!hint || input.value) return;
    hint.classList.add('tw-hint-on'); hintWord.classList.remove('tw-fade'); showHint();
    clearInterval(hintT);
    hintT = setInterval(function () {
      if (input.value || !openState) return;
      hintWord.classList.add('tw-fade');
      clearTimeout(hintFade);
      hintFade = setTimeout(function () { if (openState) { hintI++; showHint(); hintWord.classList.remove('tw-fade'); } }, 460);
    }, 4200);
  }
  function stopHint() { clearInterval(hintT); clearTimeout(hintFade); if (hint) hint.classList.remove('tw-hint-on'); }

  // ---------- float the bar in/out of the header ----------
  function floatOut() {
    if (root.classList.contains('tw-float') || root.parentElement === document.documentElement) return; // already floated
    var rect = root.getBoundingClientRect();
    var iconRect = (root.querySelector('.tw-icon') || root).getBoundingClientRect();   // the glass itself, not the slot box
    if (scrim) {   // full-page wipe origin = the search icon's center, so the takeover grows from / collapses to the icon (top-right)
      scrim.style.setProperty('--tw-wipe-x', ((iconRect.left + iconRect.right) / 2) + 'px');
      scrim.style.setProperty('--tw-wipe-y', ((iconRect.top + iconRect.bottom) / 2) + 'px');
    }
    // Full-page: --tw-bar-pad-r anchors the COLLAPSED floated bar so its icon starts exactly on the
    // resting nav icon (no jump as it lifts). On OPEN the icon should stay put — the bar just expands
    // leftward and keeps the icon's resting spot, with symmetric padding — EXCEPT on the store page,
    // where the cart sits to the right of search and the icon must glide right to clear it. So
    // --tw-bar-pad-r-open keeps the pad (icon stays) off the store page, and is 0 (icon glides to the
    // full-width spot) on it. (innerWidth-60 = 12px page pad + the 48px close+gap.)
    if (isFullPage()) {
      var padFull = Math.max(0, (window.innerWidth - 60) - iconRect.right);
      var onStore = !!document.querySelector('.store-cart-btn');
      root.style.setProperty('--tw-bar-pad-r', padFull + 'px');
      root.style.setProperty('--tw-bar-pad-r-open', (onStore ? 0 : padFull) + 'px');
    } else {
      root.style.removeProperty('--tw-bar-pad-r');
      root.style.removeProperty('--tw-bar-pad-r-open');
    }
    if (!placeholder) placeholder = document.createElement('span');
    placeholder.className = 'tw-search-ph';
    placeholder.style.cssText = 'display:inline-block;width:' + root.offsetWidth + 'px;height:' + root.offsetHeight + 'px;';   // holds the resting slot so position() re-anchors to the same spot (the glass is centred now, no nudge to mirror)
    if (placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
    root.parentNode.insertBefore(placeholder, root);
    root.style.top = rect.top + 'px';                          // exact sub-pixel — NOT rounded: the floated position must equal the
    root.style.right = (window.innerWidth - rect.right) + 'px'; // header slot exactly, or floatBack nudges the icon ~0.2px on collapse
    root.classList.add('tw-float');
    var scheme = document.body.getAttribute('data-md-color-scheme') || document.documentElement.getAttribute('data-md-color-scheme');
    if (scheme) root.setAttribute('data-md-color-scheme', scheme);
    document.documentElement.appendChild(root);   // <html>, not the flex <body> (which over-constrains the fixed slot's width)
  }
  function floatBack() {
    if (!root.classList.contains('tw-float')) return;
    root.classList.remove('tw-float');
    root.style.top = ''; root.style.right = ''; root.removeAttribute('data-md-color-scheme');
    if (placeholder && placeholder.parentNode) { placeholder.parentNode.insertBefore(root, placeholder); placeholder.parentNode.removeChild(placeholder); }
  }

  // ---------- position / open / close ----------
  function position() {
    if (!openState) return;
    if (placeholder && placeholder.isConnected) {   // re-anchor the floated slot to its header home (handles resize/rotate)
      var pr = placeholder.getBoundingClientRect();
      root.style.top = pr.top + 'px';                          // exact sub-pixel (see floatOut) so re-anchoring never nudges the icon
      root.style.right = (window.innerWidth - pr.right) + 'px';
    }
    var r = bar.getBoundingClientRect();
    panel.style.top = Math.round(r.bottom + 9) + 'px';
    panel.style.right = isMobile() ? '' : Math.round(window.innerWidth - r.right) + 'px';
  }
  // Keep the theme toggle a constant small gap left of the open bar at any width (the header
  // reflows/repads across breakpoints, so a fixed translate over-shoots on narrow screens).
  // Compute it ONCE from the resting layout so the toggle glides straight to its spot — no
  // overshoot-and-correct. The slot's right edge (live when closed, placeholder when floated)
  // and the palette right are read in the same content frame, so the gap is scrollbar-stable.
  function setPaletteShift() {
    if (!root || isFullPage()) return;   // desktop dropdown only
    var pal = document.querySelector('.md-header__option[data-md-component="palette"]');
    if (!pal) return;
    var ref = (placeholder && placeholder.isConnected) ? placeholder : root;
    var cur = parseFloat(getComputedStyle(document.body).getPropertyValue('--tw-pal-shift')) || 0;
    var palNaturalRight = pal.getBoundingClientRect().right - (document.body.classList.contains('tw-search-expanded') ? cur : 0);
    var barLeft = ref.getBoundingClientRect().right - Math.min(412, window.innerWidth - 32);
    var shift = Math.min(0, Math.round(barLeft - 6 - palNaturalRight));   // 6px gap; never push the toggle right
    document.body.style.setProperty('--tw-pal-shift', shift + 'px');
  }
  function open() {
    if (openState) return;
    openState = true; var gen = ++openGen;
    clearTimeout(openT); clearTimeout(closeT); clearTimeout(closeT2);
    setPaletteShift();                           // compute the final gap from the resting layout (before floating) — one move, no shake
    floatOut();
    document.body.classList.add('tw-search-open');
    scrim.classList.add('tw-shown');
    root.querySelector('.tw-icon').setAttribute('aria-expanded', 'true');
    input.value = ''; clearBtn.style.display = 'none'; scope = null;
    load().then(function () { if (openState && gen === openGen) update(); });
    void root.offsetWidth;                       // commit the collapsed width so the expand animates smoothly
    root.classList.add('tw-open');
    document.body.classList.add('tw-search-expanded');   // push the theme toggle aside, in step with the bar
    startHint();
    openT = setTimeout(function () { if (openState && gen === openGen) { position(); panel.classList.add('tw-shown'); } }, isFullPage() ? 50 : 200);   // full-page has no bar-expand to wait on — slide the panel up promptly, in step with the scrim
    setTimeout(function () { if (openState && gen === openGen) input.focus(); }, 120);
  }
  function close() {
    if (!openState) return;
    openState = false;
    stopHint();
    clearTimeout(openT); clearTimeout(closeT); clearTimeout(closeT2); clearTimeout(heightT);
    panel.style.height = '';                      // reset any in-flight resize so next open starts at auto
    panel.classList.remove('tw-shown');          // reverse of open: panel retracts first…
    var icon = root.querySelector('.tw-icon'); if (icon) icon.setAttribute('aria-expanded', 'false');
    input.blur();
    if (isFullPage()) {
      // Inverse of the open stagger: the bar collapses back toward the icon FIRST (on top of the
      // still-full white), THEN — after a beat — the white wipes out toward the icon and the bar
      // floats home behind it. Keeping the white up through the collapse means the icon is never
      // seen mid-air. (Bar collapse has no transition delay; the wipe-out is deferred here.)
      root.classList.remove('tw-open'); document.body.classList.remove('tw-search-expanded');
      input.value = ''; clearBtn.style.display = 'none';
      closeT2 = setTimeout(function () {
        if (openState) return;                   // re-opened mid-close — leave the takeover up
        scrim.classList.remove('tw-shown');      // now the white wipes out, back to the icon
        floatBack();
        document.body.classList.remove('tw-search-open');
        if (icon && icon.isConnected) icon.focus();
      }, 200);
      return;
    }
    scrim.classList.remove('tw-shown');           // desktop: scrim fades as the bar collapses + returns home
    closeT = setTimeout(function () { if (!openState) { root.classList.remove('tw-open'); document.body.classList.remove('tw-search-expanded'); input.value = ''; clearBtn.style.display = 'none'; } }, 70);   // …then the bar collapses + the theme toggle slides back, together (clearing the query + its ✕ in the same beat so neither lingers)…
    closeT2 = setTimeout(function () {            // …then it returns home + unlocks
      if (openState) return;
      floatBack();
      document.body.classList.remove('tw-search-open');
      if (icon && icon.isConnected) icon.focus();   // restore focus to the trigger for keyboard users
    }, 410);
  }

  // ---------- build / inject / teardown ----------
  function build() {
    root = document.createElement('div'); root.className = 'tw-search';
    root.innerHTML =
      '<div class="tw-bar">' +
        '<input class="tw-input" type="text" autocomplete="off" spellcheck="false" aria-label="Search the site" aria-expanded="false">' +
        '<span class="tw-hint" aria-hidden="true">try <span class="tw-hint-word"></span></span>' +
        '<button class="tw-clear" type="button" aria-label="Clear" tabindex="-1"><i class="fa-solid fa-xmark"></i></button>' +
        '<button class="tw-icon" type="button" aria-label="Search" aria-expanded="false"><i class="fa-solid fa-magnifying-glass"></i></button>' +
      '</div>' +
      '<button class="tw-close" type="button" aria-label="Close search"><i class="fa-solid fa-xmark"></i></button>';   // sibling of the bar — sits to its right on full-page; solid ✕ sized to match the magnifier's weight
    bar = root.querySelector('.tw-bar'); input = root.querySelector('.tw-input');
    hint = root.querySelector('.tw-hint'); hintWord = root.querySelector('.tw-hint-word'); clearBtn = root.querySelector('.tw-clear');

    scrim = document.createElement('div'); scrim.className = 'tw-scrim'; document.body.appendChild(scrim);

    panel = document.createElement('div'); panel.className = 'tw-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Site search');
    panelScroll = document.createElement('div'); panelScroll.className = 'tw-panel-scroll';
    panel.appendChild(panelScroll);
    var fade = document.createElement('div'); fade.className = 'tw-fade-b';
    for (var i = 0; i < 2; i++) { var L = document.createElement('div'); L.className = 'tw-blur-layer'; fade.appendChild(L); }
    panel.appendChild(fade);
    document.body.appendChild(panel);

    root.querySelector('.tw-icon').addEventListener('click', function (e) { e.preventDefault(); openState ? close() : open(); });
    root.querySelector('.tw-close').addEventListener('click', function (e) { e.preventDefault(); close(); });
    input.addEventListener('input', function () { clearTimeout(debounce); debounce = setTimeout(update, 60); });
    input.addEventListener('keydown', onKey);
    clearBtn.addEventListener('click', function () { input.value = ''; update(); input.focus(); });
    panel.addEventListener('click', function (e) {
      var h = e.target.closest('.tw-sec-h');
      if (h) { var t = h.getAttribute('data-scope'); scope = (scope === t) ? null : t; update(); input.focus(); return; }
      if (e.target.closest('a.tw-row, a.tw-card')) close();   // reset state before navigating (incl. instant-nav)
    });
    scrim.addEventListener('click', close);

    // click-and-drag to scroll the horizontal browse rows (desktop affordance; touch scrolls natively)
    var drag = null;
    panelScroll.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;                                  // primary button only
      var row = e.target.closest('.tw-scroll');
      if (!row || row.scrollWidth <= row.clientWidth + 1) return;  // nothing to scroll horizontally
      drag = { row: row, startX: e.pageX, startScroll: row.scrollLeft, moved: 0 };
      row.classList.add('tw-dragging');
      e.preventDefault();                                          // suppress text/image selection + native drag
    });
    document.addEventListener('mousemove', function (e) {
      if (!drag) return;
      var dx = e.pageX - drag.startX;
      if (Math.abs(dx) > drag.moved) drag.moved = Math.abs(dx);
      drag.row.scrollLeft = drag.startScroll - dx;
    });
    document.addEventListener('mouseup', function () {
      if (!drag) return;
      var d = drag; drag = null;
      d.row.classList.remove('tw-dragging');
      if (d.moved > 4) {                                           // a drag, not a click — swallow the click so a card doesn't navigate
        var swallow = function (ev) { ev.preventDefault(); ev.stopPropagation(); d.row.removeEventListener('click', swallow, true); };
        d.row.addEventListener('click', swallow, true);
        setTimeout(function () { d.row.removeEventListener('click', swallow, true); }, 0);
      }
    });

    if (window.requestIdleCallback) requestIdleCallback(function () { load(); }, { timeout: 2500 });
    else setTimeout(function () { load(); }, 1800);
  }
  function teardown() {   // drop a stale instance (e.g. after instant navigation swapped the <body>)
    clearTimeout(openT); clearTimeout(closeT); clearTimeout(closeT2); clearTimeout(debounce); clearTimeout(heightT); stopHint();
    openState = false;
    [placeholder, root, scrim, panel].forEach(function (el) { if (el && el.parentNode) el.parentNode.removeChild(el); });
    root = bar = input = hint = hintWord = clearBtn = panel = panelScroll = scrim = placeholder = null;
    if (document.body) document.body.classList.remove('tw-search-open', 'tw-search-expanded');
  }
  function inject() {
    if (root && (!root.isConnected || !panel || !panel.isConnected)) teardown();   // body was swapped → rebuild fresh
    if (root) return true;
    var ref = document.querySelector('label.md-header__button.md-icon[for="__search"]') || document.querySelector('.md-search');
    if (!ref || !ref.parentNode) return false;
    build();
    ref.parentNode.insertBefore(root, ref);
    document.body.classList.add('tw-has-search');
    return true;
  }

  function onKey(e) {
    if (e.key === 'Escape') { close(); return; }
    var rows = panelScroll.querySelectorAll('.tw-row');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!rows.length) return; e.preventDefault();
      if (rows[activeIdx]) { rows[activeIdx].classList.remove('tw-active'); rows[activeIdx].removeAttribute('aria-selected'); }
      activeIdx = e.key === 'ArrowDown' ? Math.min(activeIdx + 1, rows.length - 1) : Math.max(activeIdx - 1, 0);
      rows[activeIdx].classList.add('tw-active'); rows[activeIdx].setAttribute('aria-selected', 'true'); rows[activeIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      var t = (activeIdx >= 0 && rows[activeIdx]) ? rows[activeIdx] : rows[0];
      if (t) { var href = t.getAttribute('href'); if (href && href !== '#') { close(); window.location.href = href; } }
    }
  }

  // ---------- lifecycle ----------
  function ready(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  ready(inject);
  var sub = setInterval(function () { if (typeof document$ !== 'undefined') { clearInterval(sub); document$.subscribe(function () { inject(); }); } }, 100);

  document.addEventListener('mousedown', function (e) { if (openState && root && !root.contains(e.target) && !panel.contains(e.target)) close(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openState) { close(); return; }   // works even when focus is in the panel
    var inField = /^(INPUT|TEXTAREA)$/.test((document.activeElement || {}).tagName || '');
    if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !inField && !openState)) { e.preventDefault(); if (inject()) open(); }
  });
  window.addEventListener('resize', function () { position(); setPaletteShift(); });
})();
