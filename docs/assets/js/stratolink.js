/* ============================================================
   Stratolink — embedded live balloon tracker
   Pulls live telemetry from the same Supabase backend as
   https://stratolink.org/dashboard-v2 and renders a minimal
   map + slide-out telemetry panel.

   Balloons are either ACTIVE (device.status === "flying") or
   PAST FLIGHTS (launched, has telemetry, no longer flying).
   Past flights show by default when nothing is airborne, and
   are otherwise hidden behind a toggle in the panel.
   ============================================================ */
(function () {
  "use strict";

  var SUPABASE_URL = "https://iazmnyyfsobucndqncgw.supabase.co";
  /* Public "publishable" key — designed to ship client-side, exactly as the
     dashboard does. Row-level security gates what it can read. */
  var SUPABASE_KEY = "sb_publishable_uSFCLN1miu652_O9bdAvUA_aEmjBsdQ";

  var REFRESH_MS = 30000;          // live refresh cadence (matches the dashboard)
  var SPEED_UNIT = "km/h";         // unit assumed for telemetry.gps_speed
  var STALE_MS = 45 * 60 * 1000;   // no contact past this -> "stale"

  /* Rainbow palette — active balloons coloured by launch order; the first is red. */
  var RAINBOW = ["#e5484d", "#ef6c1a", "#e0a400", "#36a85a", "#3b76d6", "#8a52cf"];
  /* Past flights render in a neutral grey, regardless of launch order. */
  var INACTIVE_COLOR = "#8c9196";

  var TILES = {
    light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
  };
  var TILE_ATTR =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
    '&copy; <a href="https://carto.com/attributions">CARTO</a>';

  var BALLOON_SVG =
    '<svg viewBox="0 0 24 32" aria-hidden="true">' +
    '<ellipse cx="12" cy="11" rx="8.4" ry="9.2"/>' +
    '<path d="M8.6 18.4 Q12 22.4 15.4 18.4"/>' +
    '<path d="M12 20.6 L12 26.6"/>' +
    '<rect x="10.1" y="26.6" width="3.8" height="3" rx="0.7"/>' +
    "</svg>";

  var chartUid = 0;

  /* ---------- small helpers ---------- */
  function isDark() {
    return document.body.getAttribute("data-md-color-scheme") === "slate";
  }
  function tileURL() { return isDark() ? TILES.dark : TILES.light; }

  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    var n = +v;
    return isNaN(n) ? null : n;
  }
  function validCoord(lat, lon) {
    return (
      typeof lat === "number" && typeof lon === "number" &&
      lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 &&
      !(lat === 0 && lon === 0)
    );
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function prettyName(id) {
    return String(id)
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); })
      .join(" ");
  }
  function timeAgo(t) {
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.round(s / 60) + "m ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    return Math.round(s / 86400) + "d ago";
  }
  function downsample(arr, max) {
    if (arr.length <= max) return arr.slice();
    var out = [], step = (arr.length - 1) / (max - 1);
    for (var i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
    return out;
  }

  /* ---------- Supabase REST ---------- */
  function sb(path) {
    return fetch(SUPABASE_URL + "/rest/v1/" + path, {
      headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY }
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  /* Fetch every balloon that is flying or has flown, shaped for the widget. */
  function loadData() {
    return sb("devices?select=*&order=launched_at.asc").then(function (devices) {
      if (!Array.isArray(devices)) return [];
      var candidates = devices.filter(function (d) {
        return d && d.device_id &&
          ((d.status || "").toLowerCase() === "flying" || d.launched_at);
      });
      return Promise.all(
        candidates.map(function (d) {
          var colorIdx = devices.indexOf(d); // stable: first balloon ever = red
          var cols =
            "time,lat,lon,altitude_m,temperature,battery_voltage," +
            "gps_speed,gps_satellites,rssi";
          return sb(
            "telemetry?device_id=eq." + encodeURIComponent(d.device_id) +
            "&select=" + cols + "&order=time.asc&limit=6000"
          ).then(function (rows) {
            return buildBalloon(d, Array.isArray(rows) ? rows : [], colorIdx);
          });
        })
      ).then(function (list) {
        /* keep active balloons, plus past flights that actually have data */
        return list.filter(function (b) {
          return b.active || b.lastRowTime != null;
        });
      });
    });
  }

  function buildBalloon(device, rows, colorIdx) {
    var path = [];                        // [[lat,lon], ...] valid fixes, time order
    var series = { alt: [], temp: [], batt: [] };
    var latest = {};                      // latest non-null value per field
    var lastFix = null;
    var lastRowTime = null;

    rows.forEach(function (r) {
      var t = new Date(r.time).getTime();
      if (isNaN(t)) return;
      lastRowTime = t;

      var lat = num(r.lat), lon = num(r.lon);
      if (validCoord(lat, lon)) {
        path.push([lat, lon]);
        lastFix = { lat: lat, lon: lon, t: t };
      }

      var alt = num(r.altitude_m), temp = num(r.temperature), batt = num(r.battery_voltage);
      if (alt !== null) series.alt.push({ t: t, v: alt });
      if (temp !== null) series.temp.push({ t: t, v: temp });
      if (batt !== null) series.batt.push({ t: t, v: batt });

      ["altitude_m", "temperature", "battery_voltage", "gps_speed",
       "gps_satellites", "rssi"].forEach(function (k) {
        var val = num(r[k]);
        if (val !== null) latest[k] = { v: val, t: t };
      });
    });

    return {
      id: device.device_id,
      name: prettyName(device.device_id),
      active: (device.status || "").toLowerCase() === "flying",
      color: RAINBOW[colorIdx % RAINBOW.length],
      device: device,
      path: path,
      series: series,
      latest: latest,
      lastFix: lastFix,
      lastRowTime: lastRowTime
    };
  }

  /* ---------- hand-drawn SVG sparkline ----------
     Monochromatic: line, fill and end-point all in the theme foreground
     colour, with the fill fading toward the baseline. */
  function buildChart(pts, o) {
    o = o || {};
    var W = 256, H = o.height || 46, PX = 5, TOP = 11, BOT = 10;
    var dp = o.dp != null ? o.dp : 1;
    var bandH = H - TOP - BOT;

    if (!pts || pts.length === 0) {
      return '<svg viewBox="0 0 ' + W + " " + H + '" class="sl-spark">' +
        '<text x="' + (W / 2) + '" y="' + (H / 2 + 3) + '" text-anchor="middle" ' +
        'class="sl-spark-empty">awaiting data</text></svg>';
    }

    var p = downsample(pts, 150);
    var t0 = p[0].t, t1 = p[p.length - 1].t, tr = (t1 - t0) || 1;
    var vs = p.map(function (d) { return d.v; });
    var mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs);
    var vr = (mx - mn) || 1;

    function X(t) { return PX + ((t - t0) / tr) * (W - 2 * PX); }
    function Y(v) { return TOP + (1 - (v - mn) / vr) * bandH; }
    var baseY = H - BOT;
    var lastV = p[p.length - 1].v;

    var labels =
      '<text x="' + PX + '" y="8" class="sl-spark-ax">' + mx.toFixed(dp) + "</text>" +
      '<text x="' + PX + '" y="' + (H - 2.5) + '" class="sl-spark-ax">' +
      mn.toFixed(dp) + "</text>";

    if (p.length < 2) {
      return '<svg viewBox="0 0 ' + W + " " + H + '" class="sl-spark">' +
        '<circle cx="' + (W / 2).toFixed(1) + '" cy="' + Y(p[0].v).toFixed(1) +
        '" r="2.6" fill="currentColor"/>' + labels + "</svg>";
    }

    /* smooth line path (quadratic through midpoints) */
    var d = "M" + X(p[0].t).toFixed(1) + "," + Y(p[0].v).toFixed(1);
    for (var j = 1; j < p.length - 1; j++) {
      var cx = X(p[j].t), cy = Y(p[j].v);
      var nx = (cx + X(p[j + 1].t)) / 2, ny = (cy + Y(p[j + 1].v)) / 2;
      d += " Q" + cx.toFixed(1) + "," + cy.toFixed(1) + " " +
        nx.toFixed(1) + "," + ny.toFixed(1);
    }
    d += " T" + X(t1).toFixed(1) + "," + Y(lastV).toFixed(1);

    var uid = "sl" + chartUid++;
    var area = d + " L" + X(t1).toFixed(1) + "," + baseY +
      " L" + X(t0).toFixed(1) + "," + baseY + " Z";

    return '<svg viewBox="0 0 ' + W + " " + H + '" class="sl-spark">' +
      '<defs><linearGradient id="' + uid + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="currentColor" stop-opacity="0.26"/>' +
        '<stop offset="1" stop-color="currentColor" stop-opacity="0"/>' +
      "</linearGradient></defs>" +
      '<path d="' + area + '" fill="url(#' + uid + ')"/>' +
      '<path d="' + d + '" fill="none" stroke="currentColor" ' +
        'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + X(t1).toFixed(1) + '" cy="' + Y(lastV).toFixed(1) +
        '" r="2.4" fill="currentColor"/>' +
      labels + "</svg>";
  }

  /* ============================================================
     Widget instance
     ============================================================ */
  function initWidget() {
    /* tear down a previous instance first (handles SPA navigation) */
    if (window.__stratolink) {
      try { clearInterval(window.__stratolink.timer); } catch (e) {}
      try { window.__stratolink.observer.disconnect(); } catch (e) {}
      try { window.__stratolink.map.remove(); } catch (e) {}
      window.__stratolink = null;
    }

    var widget = document.getElementById("stratolink-widget");
    if (!widget) return;

    if (typeof L === "undefined") {
      initWidget._tries = (initWidget._tries || 0) + 1;
      if (initWidget._tries < 60) { setTimeout(initWidget, 80); return; }
      widget.innerHTML =
        '<div class="sl-overlay">' + BALLOON_SVG +
        "<p>Map library unavailable — check your connection.</p></div>";
      return;
    }

    /* ---- build DOM ---- */
    widget.innerHTML =
      '<div class="sl-map"></div>' +
      '<div class="sl-badge"><span class="sl-badge-dot"></span>' +
      '<span class="sl-badge-txt">Connecting</span></div>' +
      '<div class="sl-hint">Click a balloon for telemetry</div>' +
      '<div class="sl-card"><div class="sl-card-inner"></div></div>' +
      '<div class="sl-overlay"></div>';

    var mapEl = widget.querySelector(".sl-map");
    var badge = widget.querySelector(".sl-badge");
    var badgeTxt = widget.querySelector(".sl-badge-txt");
    var hint = widget.querySelector(".sl-hint");
    var card = widget.querySelector(".sl-card");
    var cardInner = widget.querySelector(".sl-card-inner");
    var overlay = widget.querySelector(".sl-overlay");

    var balloons = [];
    var selectedId = null;
    var cardMode = null;   // 'list' | 'detail' | null
    var fitted = false;
    var showPast = false;  // are past flights drawn on the map?
    var lastHasActive = null;

    /* ---- map ---- */
    var map = L.map(mapEl, {
      zoomControl: false,
      attributionControl: true,
      scrollWheelZoom: false,   // keep page scroll smooth inside an article
      minZoom: 2,
      maxZoom: 18,
      worldCopyJump: true
    });
    map.attributionControl.setPrefix(false);
    L.control.zoom({ position: "topright" }).addTo(map);
    map.setView([20, 0], 2);

    var tiles = L.tileLayer(tileURL(), {
      subdomains: "abcd",
      maxZoom: 19,
      attribution: TILE_ATTR
    }).addTo(map);

    var layers = L.layerGroup().addTo(map);
    map.on("click", deselect);
    setTimeout(function () { map.invalidateSize(); }, 200);

    /* keep the basemap in sync with the site's light/dark toggle */
    var observer = new MutationObserver(function () { tiles.setUrl(tileURL()); });
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-md-color-scheme"] });

    /* ---- overlay states ---- */
    function setOverlay(state) {
      if (state === "hidden") { overlay.className = "sl-overlay sl-hidden"; return; }
      overlay.className = "sl-overlay";
      if (state === "loading") {
        overlay.innerHTML = '<div class="sl-spinner"></div><p>Locating balloons…</p>';
      } else if (state === "empty") {
        overlay.innerHTML = BALLOON_SVG +
          "<p>No balloons have flown yet. This map wakes up the moment one " +
          "launches.</p>";
      } else if (state === "error") {
        overlay.innerHTML = BALLOON_SVG +
          "<p>Couldn’t reach mission control. Retrying…</p>";
      }
    }
    setOverlay("loading");

    /* ---- lookups ---- */
    function byId(id) {
      for (var i = 0; i < balloons.length; i++) {
        if (balloons[i].id === id) return balloons[i];
      }
      return null;
    }
    function visible(b) { return b.active || showPast; }
    function markerPos(b) {
      if (b.lastFix) return [b.lastFix.lat, b.lastFix.lon];
      if (b.path.length) return b.path[b.path.length - 1];
      if (validCoord(num(b.device.launch_lat), num(b.device.launch_lon))) {
        return [num(b.device.launch_lat), num(b.device.launch_lon)];
      }
      return null;
    }
    function phase(b) {
      if (!b.active) return "past flight";
      if (!b.lastRowTime) return "no data";
      if (Date.now() - b.lastRowTime > STALE_MS) return "signal lost";
      var alt = b.latest.altitude_m ? b.latest.altitude_m.v : null;
      if (alt != null && alt > 500) return "in flight";
      if (b.lastFix) return "tracking";
      return b.device.status || "flying";
    }

    /* ---- map layers ---- */
    function render() {
      layers.clearLayers();
      balloons.forEach(function (b) {
        b.segs = [];
        b.marker = null;
        if (!visible(b)) return;
        var col = b.active ? b.color : INACTIVE_COLOR;
        if (b.path.length > 1) {
          /* trail drawn as graduated segments — faint at the tail, brighter
             toward the balloon's current position */
          var tp = downsample(b.path, 90);
          for (var i = 0; i < tp.length - 1; i++) {
            var seg = L.polyline([tp[i], tp[i + 1]], {
              color: col, weight: 2.6, opacity: 0.3,
              lineCap: "round", lineJoin: "round", interactive: false
            });
            seg._frac = tp.length <= 2 ? 1 : i / (tp.length - 2);
            b.segs.push(seg);
            layers.addLayer(seg);
          }
          b.hit = L.polyline(b.path, {
            color: col, weight: 16, opacity: 0, lineCap: "round"
          });
          b.hit.on("click", function () { toggleBalloon(b); });
          layers.addLayer(b.hit);
        }
        var pos = markerPos(b);
        if (pos) {
          b.marker = L.marker(pos, {
            icon: L.divIcon({
              className: "sl-marker" + (b.active ? "" : " sl-inactive"),
              iconSize: [18, 18],
              iconAnchor: [9, 9],
              html: '<span class="sl-marker-halo"></span>' +
                    '<span class="sl-marker-dot"></span>'
            }),
            riseOnHover: true
          });
          b.marker.on("click", function () { toggleBalloon(b); });
          layers.addLayer(b.marker);
          var el = b.marker.getElement();
          if (el) el.style.setProperty("--sl-c", col);
        }
      });

      if (!fitted) {
        var pts = [];
        balloons.forEach(function (b) {
          if (!visible(b)) return;
          b.path.forEach(function (pt) { pts.push(pt); });
          var mp = markerPos(b);
          if (mp) pts.push(mp);
        });
        if (pts.length > 1) {
          map.fitBounds(L.latLngBounds(pts).pad(0.18));
        } else if (pts.length === 1) {
          map.setView(pts[0], 9);
        }
        fitted = true;
      }
      restyle();
    }

    function restyle() {
      var anyActive = balloons.some(function (b) { return b.active; });
      balloons.forEach(function (b) {
        var sel = b.id === selectedId;
        var dim = selectedId && !sel;
        (b.segs || []).forEach(function (seg) {
          var op, w;
          if (sel) { op = 0.95; w = 3.4; }            // selected: whole trail bright
          else if (dim) { op = 0.06; w = 2.6; }       // another selected: fade out
          else if (b.active) {
            op = 0.05 + 0.72 * Math.pow(seg._frac, 1.5);
            w = 2.6;
          } else {
            /* past flight: prominent when it's the only thing aloft,
               a faint backdrop when live balloons share the map */
            var ceil = anyActive ? 0.34 : 0.7;
            op = 0.05 + ceil * Math.pow(seg._frac, 1.5);
            w = anyActive ? 2.2 : 2.6;
          }
          seg.setStyle({ opacity: op, weight: w });
        });
        if (b.marker) {
          var el = b.marker.getElement();
          if (el) {
            el.classList.toggle("sl-selected", sel);
            el.style.opacity = dim ? "0.4" : "1";
          }
        }
      });
    }

    /* ---- selection + panel ---- */
    function toggleBalloon(b) {
      if (selectedId === b.id && cardMode === "detail") deselect();
      else select(b.id);
    }

    function select(id) {
      var b = byId(id);
      if (!b) return;
      selectedId = id;
      cardMode = "detail";
      restyle();
      renderDetail(b);
      card.classList.add("sl-open");
      panToBalloon(b);
      hint.classList.add("sl-gone");
    }

    function openList() {
      if (balloons.length === 0) return;
      selectedId = null;     // roster view highlights nothing
      cardMode = "list";
      restyle();
      renderList();
      card.classList.add("sl-open");
      hint.classList.add("sl-gone");
    }

    function deselect() {
      selectedId = null;
      cardMode = null;
      card.classList.remove("sl-open");
      restyle();
    }

    function setShowPast(v) {
      showPast = v;
      if (!showPast && selectedId) {
        var b = byId(selectedId);
        if (b && !b.active) deselect();
      }
      render();
      if (card.classList.contains("sl-open") && cardMode === "list") renderList();
    }

    function panToBalloon(b) {
      var ll = markerPos(b);
      if (!ll) return;
      map.setView(ll, Math.max(map.getZoom(), 6), { animate: true });
      setTimeout(function () {
        if (window.innerWidth <= 600) {
          map.panBy([0, Math.round(widget.clientHeight * 0.22)], { animate: true });
        } else {
          map.panBy([-Math.round(card.offsetWidth / 2 + 20), 0], { animate: true });
        }
      }, 70);
    }

    /* ---- panel: shared wiring ---- */
    function bindControls() {
      var close = cardInner.querySelector(".sl-close");
      if (close) close.addEventListener("click", function (e) {
        e.stopPropagation();
        deselect();
      });
      var back = cardInner.querySelector(".sl-back");
      if (back) back.addEventListener("click", function (e) {
        e.stopPropagation();
        openList();
      });
    }

    /* ---- panel: roster list ---- */
    function listItem(b) {
      var st = phase(b) + (b.lastRowTime ? " · " + timeAgo(b.lastRowTime) : "");
      var col = b.active ? b.color : INACTIVE_COLOR;
      return '<button class="sl-list-item' + (b.active ? "" : " sl-past") +
        '" data-id="' + esc(b.id) + '">' +
        '<span class="sl-list-dot" style="background:' + col + '"></span>' +
        '<span class="sl-list-meta">' +
          '<span class="sl-list-name">' + esc(b.name) + "</span>" +
          '<span class="sl-list-status">' + esc(st) + "</span>" +
        "</span>" +
        '<span class="sl-list-chev">›</span>' +
        "</button>";
    }

    function renderList() {
      var active = balloons.filter(function (b) { return b.active; });
      var past = balloons.filter(function (b) { return !b.active; });

      var html =
        '<div class="sl-card-head">' +
          '<div class="sl-card-name">Balloons</div>' +
          '<button class="sl-close" aria-label="Close">✕</button>' +
        "</div>" +
        '<div class="sl-div"></div>';

      if (active.length) {
        html += '<div class="sl-list">' + active.map(listItem).join("") + "</div>";
      } else {
        html += '<div class="sl-list-empty">No balloons currently in flight.</div>';
      }

      if (past.length) {
        html += '<div class="sl-toggle">' +
          '<span class="sl-toggle-label">Past flights</span>' +
          '<button class="sl-switch' + (showPast ? " sl-on" : "") +
          '" role="switch" aria-checked="' + showPast + '" ' +
          'aria-label="Show past flights"></button>' +
        "</div>";
        if (showPast) {
          html += '<div class="sl-list">' + past.map(listItem).join("") + "</div>";
        }
      }

      cardInner.innerHTML = html;
      bindControls();
      var sw = cardInner.querySelector(".sl-switch");
      if (sw) sw.addEventListener("click", function (e) {
        e.stopPropagation();
        setShowPast(!showPast);
      });
      cardInner.querySelectorAll(".sl-list-item").forEach(function (it) {
        it.addEventListener("click", function () { select(it.dataset.id); });
      });
    }

    /* ---- panel: telemetry detail ---- */
    function stat(label, val, unit) {
      return '<div class="sl-stat"><div class="sl-stat-label">' + esc(label) +
        '</div><div class="sl-stat-value">' + esc(String(val)) +
        (unit ? '<span class="sl-stat-unit">' + esc(unit) + "</span>" : "") +
        "</div></div>";
    }

    function chart(label, series, opts) {
      opts = opts || {};
      var scale = opts.scale || 1, dp = opts.dp != null ? opts.dp : 1;
      var unit = opts.unit || "";
      var pts = (series || []).map(function (pt) {
        return { t: pt.t, v: pt.v * scale };
      });
      var lastV = pts.length ? pts[pts.length - 1].v : null;
      var cur = lastV != null ? lastV.toFixed(dp) : "—";
      return '<div class="sl-chart"><div class="sl-chart-head">' +
        '<span class="sl-chart-label">' + esc(label) + "</span>" +
        '<span class="sl-chart-cur">' + cur +
        (unit ? '<span class="sl-stat-unit">' + esc(unit) + "</span>" : "") +
        "</span></div>" +
        buildChart(pts, { height: opts.hero ? 66 : 46, dp: dp }) +
        "</div>";
    }

    function renderDetail(b) {
      card.style.setProperty("--sl-c", b.active ? b.color : INACTIVE_COLOR);
      var lt = b.latest;
      var altM = lt.altitude_m ? lt.altitude_m.v : null;
      var spd = lt.gps_speed ? lt.gps_speed.v : null;
      var sats = lt.gps_satellites ? lt.gps_satellites.v : null;
      var rssi = lt.rssi ? lt.rssi.v : null;

      cardInner.innerHTML =
        '<button class="sl-back">‹ All balloons</button>' +
        '<div class="sl-card-head">' +
          '<div class="sl-card-name">' + esc(b.name) + "</div>" +
          '<button class="sl-close" aria-label="Close">✕</button>' +
        "</div>" +
        '<div class="sl-card-sub">' +
          '<span class="sl-pill">' + esc(phase(b)) + "</span>" +
          '<span class="sl-updated">' +
            (b.lastRowTime
              ? (b.active ? "updated " : "last seen ") + timeAgo(b.lastRowTime)
              : "no contact") +
          "</span>" +
        "</div>" +
        '<div class="sl-div"></div>' +
        '<div class="sl-stats">' +
          stat("Altitude", altM != null ? (altM / 1000).toFixed(2) : "—", "km") +
          stat("Speed", spd != null ? Math.round(spd) : "—", SPEED_UNIT) +
          stat("Satellites", sats != null ? Math.round(sats) : "—", "") +
          stat("Signal", rssi != null ? Math.round(rssi) : "—", "dBm") +
        "</div>" +
        '<div class="sl-div"></div>' +
        chart("Altitude", b.series.alt, { scale: 0.001, unit: "km", dp: 2, hero: true }) +
        chart("Temperature", b.series.temp, { unit: "°C", dp: 1 }) +
        chart("Battery", b.series.batt, { unit: "V", dp: 2 }) +
        '<div class="sl-card-foot">data from ' +
          '<a href="https://stratolink.org/dashboard-v2" target="_blank" ' +
          'rel="noopener">stratolink.org</a></div>';

      bindControls();
    }

    /* ---- badge ---- */
    function updateBadge() {
      var active = balloons.filter(function (b) { return b.active; });
      var past = balloons.filter(function (b) { return !b.active; });
      if (active.length) {
        var anyLive = active.some(function (b) {
          return b.lastRowTime && Date.now() - b.lastRowTime < STALE_MS;
        });
        badge.classList.toggle("sl-stale", !anyLive);
        badgeTxt.textContent = (anyLive ? "Live · " : "") + active.length +
          (active.length === 1 ? " balloon in flight" : " balloons in flight");
      } else if (past.length) {
        badge.classList.add("sl-stale");
        badgeTxt.textContent = past.length +
          (past.length === 1 ? " past flight" : " past flights");
      } else {
        badge.classList.add("sl-stale");
        badgeTxt.textContent = "Awaiting launch";
      }
      badge.classList.toggle("sl-clickable", balloons.length > 0);
    }
    badge.addEventListener("click", function () {
      if (balloons.length === 0) return;
      if (card.classList.contains("sl-open") && cardMode === "list") deselect();
      else openList();
    });

    /* ---- data cycle ---- */
    function loadAndRender(first) {
      loadData()
        .then(function (list) {
          balloons = list;
          var hasActive = balloons.some(function (b) { return b.active; });
          /* default: show past flights only when nothing is airborne.
             Re-applied whenever that state flips; the user's manual toggle
             sticks in between. */
          if (hasActive !== lastHasActive) {
            showPast = !hasActive;
            lastHasActive = hasActive;
          }
          /* drop a selection that is no longer visible */
          if (selectedId) {
            var selB = byId(selectedId);
            if (!selB || (!selB.active && !showPast)) deselect();
          }
          render();
          updateBadge();
          setOverlay(balloons.length === 0 ? "empty" : "hidden");
          if (balloons.length === 0) {
            hint.classList.add("sl-gone");
            deselect();
            return;
          }
          /* refresh whatever the panel is currently showing */
          if (cardMode === "list" && card.classList.contains("sl-open")) {
            renderList();
          } else if (cardMode === "detail" && selectedId) {
            var b = byId(selectedId);
            if (b) renderDetail(b);
            else deselect();
          }
        })
        .catch(function (err) {
          console.warn("[stratolink] data load failed:", err);
          if (first) setOverlay("error");
        });
    }

    loadAndRender(true);
    var timer = setInterval(function () { loadAndRender(false); }, REFRESH_MS);
    setTimeout(function () { hint.classList.add("sl-gone"); }, 9000);
    window.addEventListener("resize", function () { map.invalidateSize(); });

    window.__stratolink = { map: map, timer: timer, observer: observer };
  }

  /* ---------- boot (once; survives MkDocs instant navigation) ---------- */
  if (!window.__stratolinkBound) {
    window.__stratolinkBound = true;
    if (typeof document$ !== "undefined" && document$ && document$.subscribe) {
      document$.subscribe(function () {
        initWidget._tries = 0;
        initWidget();
      });
    } else if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { initWidget(); });
    } else {
      initWidget();
    }
  }
})();
