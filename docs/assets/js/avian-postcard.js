(function () {
  'use strict';

  if (window.__avianPostcardLoaded) {
    if (window.initAvianPostcard) window.initAvianPostcard();
    return;
  }
  window.__avianPostcardLoaded = true;

  var ROOT = '/assets/avian-postcard/';
  var STAMP_ROOT = '/assets/avian-stamps/';
  var STYLE = ROOT + 'postcard.css?v=20260820-2';
  var PLAY_ICON = '<svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M3 2 L10 6 L3 10 Z"></path></svg>';
  var PAUSE_ICON = '<svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><rect x="3" y="2" width="2.5" height="8"></rect><rect x="6.5" y="2" width="2.5" height="8"></rect></svg>';
  var LOOP_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.2 5.4h7.6l-1.7-1.7M12.8 10.6H5.2l1.7 1.7"></path><path d="M12.8 5.4v2M3.2 10.6v-2"></path></svg>';
  var PERCHED_ICON = '<svg viewBox="0 0 640 512" fill="currentColor" aria-hidden="true"><path d="M456 0c-48.6 0-88 39.4-88 88l0 29.2L12.5 390.6c-14 10.8-16.6 30.9-5.9 44.9s30.9 16.6 44.9 5.9L126.1 384l133.1 0 46.6 113.1c5 12.3 19.1 18.1 31.3 13.1s18.1-19.1 13.1-31.3L311.1 384l40.9 0c1.1 0 2.1 0 3.2 0l46.6 113.2c5 12.3 19.1 18.1 31.3 13.1s18.1-19.1 13.1-31.3l-42-102C484.9 354.1 544 280 544 192l0-64 0-8 80.5-20.1c8.6-2.1 13.8-10.8 11.6-19.4C629 52 603.4 32 574 32l-50.1 0C507.7 12.5 483.3 0 456 0zm0 64a24 24 0 1 1 0 48 24 24 0 1 1 0-48z"></path></svg>';
  var FLIGHT_ICON = '<svg viewBox="0 0 512 512" fill="currentColor" aria-hidden="true"><path d="M160.8 96.5c14 17 31 30.9 49.5 42.2c25.9 15.8 53.7 25.9 77.7 31.6l0-31.5C265.8 108.5 250 71.5 248.6 28c-.4-11.3-7.5-21.5-18.4-24.4c-7.6-2-15.8-.2-21 5.8c-13.3 15.4-32.7 44.6-48.4 87.2zM320 144l0 64c-60.8-5.1-185-43.8-219.3-157.2C97.4 40 87.9 32 76.6 32c-7.9 0-15.3 3.9-18.8 11C46.8 65.9 32 112.1 32 176c0 116.9 80.1 180.5 118.4 202.8L11.8 416.6C6.7 418 2.6 421.8 .9 426.8s-.8 10.6 2.3 14.8C21.7 466.2 77.3 512 160 512c3.6 0 7.2-1.2 10-3.5L245.6 448l74.4 0c88.4 0 160-71.6 160-160l0-160 29.9-44.9c1.3-2 2.1-4.4 2.1-6.8c0-6.8-5.5-12.3-12.3-12.3L400 64c-44.2 0-80 35.8-80 80zm80-16a16 16 0 1 1 0 32 16 16 0 1 1 0-32z"></path></svg>';

  var POSES = {
    '1': { src: ROOT + 'anna-perched.webp', alt: "Anna's Hummingbird perched", width: 552, height: 563 },
    '2': { src: ROOT + 'anna-flight.webp', alt: "Anna's Hummingbird in flight", width: 666, height: 421 }
  };
  var RECORDINGS = [
    { id: '2026-08-18-173214', date: '2026-08-18', time: '17:32:14', confidence: '99%', duration: 4.536, audio: ROOT + 'recording-2026-08-18-173214.mp3', spectrogram: ROOT + 'spectrogram-9935-0818-173214.webp' },
    { id: '2026-08-17-185729', date: '2026-08-17', time: '18:57:29', confidence: '99%', duration: 6.024, audio: ROOT + 'recording-2026-08-17-185729.mp3', spectrogram: ROOT + 'spectrogram-9933-0817-185729.webp' },
    { id: '2026-08-17-185618', date: '2026-08-17', time: '18:56:18', confidence: '99%', duration: 4.536, audio: ROOT + 'recording-2026-08-17-185618.mp3', spectrogram: ROOT + 'spectrogram-9932-0817-185618.webp' }
  ];
  var imagePromise = null;
  var stampPromise = null;
  var activePlayer = null;
  var themeObserver = null;

  function siteTheme() {
    var scheme = (document.body && document.body.getAttribute('data-md-color-scheme'))
      || document.documentElement.getAttribute('data-md-color-scheme')
      || '';
    if (/^(?:dark|slate)$/i.test(scheme)) return 'dark';
    if (!scheme && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    return 'light';
  }
  function syncTheme() {
    var theme = siteTheme();
    document.querySelectorAll('[data-avian-postcard]').forEach(function (host) {
      host.dataset.theme = theme;
    });
  }
  function watchTheme() {
    if (themeObserver || !window.MutationObserver) return;
    themeObserver = new MutationObserver(syncTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-md-color-scheme'],
      subtree: true
    });
  }

  function preloadImage(src) {
    return new Promise(function (resolve) {
      var image = new Image();
      image.onload = function () {
        if (image.decode) image.decode().catch(function () {}).then(resolve);
        else resolve();
      };
      image.onerror = resolve;
      image.src = src;
    });
  }
  function preloadImages() {
    if (imagePromise) return imagePromise;
    var sources = [POSES['1'].src, POSES['2'].src, ROOT + 'anna-stamp.webp'];
    RECORDINGS.forEach(function (recording) { sources.push(recording.spectrogram); });
    imagePromise = Promise.all(sources.map(preloadImage));
    return imagePromise;
  }
  function ensureStampRuntime() {
    if (window.STAMPS && window.FX) return Promise.resolve();
    if (stampPromise) return stampPromise;
    stampPromise = new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-avian-stamps-script="stamps.js"]');
      if (existing) {
        if (window.STAMPS && window.FX) resolve();
        else {
          existing.addEventListener('load', resolve, { once: true });
          existing.addEventListener('error', reject, { once: true });
        }
        return;
      }
      var script = document.createElement('script');
      script.src = STAMP_ROOT + 'stamps.js';
      script.async = false;
      script.dataset.avianStampsScript = 'stamps.js';
      script.addEventListener('load', function () {
        script.dataset.loaded = 'true';
        if (window.STAMPS && window.FX) resolve();
        else reject(new Error('stamp runtime unavailable'));
      }, { once: true });
      script.addEventListener('error', reject, { once: true });
      document.head.appendChild(script);
    });
    return stampPromise;
  }
  function styleShadow(shadow) {
    return new Promise(function (resolve) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = STYLE;
      link.addEventListener('load', resolve, { once: true });
      link.addEventListener('error', resolve, { once: true });
      shadow.appendChild(link);
    });
  }
  function fmtClock(seconds) {
    var value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    var minutes = Math.floor(value / 60);
    var rest = Math.floor(value % 60);
    return minutes + ':' + (rest < 10 ? '0' : '') + rest;
  }
  function relativeDate(date, time) {
    var parsed = new Date(date + 'T' + (time || '00:00:00'));
    if (isNaN(parsed.getTime())) return date;
    var ago = Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 1000));
    if (ago < 60) return ago + 's ago';
    if (ago < 3600) return Math.floor(ago / 60) + 'm ago';
    if (ago < 86400) return Math.floor(ago / 3600) + 'h ago';
    return Math.floor(ago / 86400) + 'd ago';
  }
  function dateLine(recording) {
    var parsed = new Date(recording.date + 'T' + recording.time);
    var label = isNaN(parsed.getTime()) ? recording.date : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return label + ' - ' + recording.time.slice(0, 5);
  }
  function recordingMarkup(recording, componentId) {
    var panelId = componentId + '-recording-' + recording.id;
    var dateTime = recording.date + 'T' + recording.time;
    var spoken = dateLine(recording) + ', ' + recording.confidence + ' confidence';
    return ''
      + '<li class="rec-row" data-recording data-duration="' + recording.duration + '">'
      + '<button class="rec-row-toggle" type="button" aria-expanded="false" aria-controls="' + panelId + '">'
      + '<span class="when"><b>' + relativeDate(recording.date, recording.time) + '</b></span>'
      + '<span class="conf"><b>' + recording.confidence + '</b></span>'
      + '<span class="date-time"><b><time datetime="' + dateTime + '">' + dateLine(recording) + '</time></b></span>'
      + '</button>'
      + '<div class="rec-spectro" id="' + panelId + '" aria-hidden="true" inert>'
      + '<img class="rec-spectro-image" src="' + recording.spectrogram + '" width="960" height="280" alt="Spectrogram for ' + spoken + '">'
      + '<div class="rec-spectro-played" aria-hidden="true"></div><div class="rec-loop-region" aria-hidden="true"></div><div class="rec-spectro-cursor" aria-hidden="true"></div>'
      + '<input class="rec-spectro-scrub" type="range" min="0" max="' + recording.duration + '" step="0.01" value="0" aria-label="Scrub recording from ' + spoken + '">'
      + '<button class="rec-loop-handle" data-edge="start" type="button" role="slider" aria-label="Repeat section start" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="-1"></button>'
      + '<button class="rec-loop-handle" data-edge="end" type="button" role="slider" aria-label="Repeat section end" aria-valuemin="0" aria-valuemax="100" aria-valuenow="25" tabindex="-1"></button>'
      + '<div class="rec-player-controls"><button class="rec-player-toggle" type="button" aria-label="Play recording from ' + spoken + '">' + PLAY_ICON + '</button>'
      + '<span class="rec-player-time" aria-live="off">0:00 / ' + fmtClock(recording.duration) + '</span>'
      + '<button class="rec-loop-toggle" type="button" aria-label="Repeat a selected section" aria-pressed="false">' + LOOP_ICON + '<span>loop</span></button></div>'
      + '<audio preload="metadata" src="' + recording.audio + '"></audio></div></li>';
  }
  function postcardMarkup(componentId) {
    var rows = RECORDINGS.map(function (recording) { return recordingMarkup(recording, componentId); }).join('');
    var group = componentId + '-info';
    return ''
      + '<article class="postcard-sheet" aria-labelledby="' + componentId + '-title">'
      + '<section class="postcard-visual" aria-label="Bird illustration"><div class="postcard-bird-frame">'
      + '<div class="postcard-artwork" id="' + componentId + '-artwork" role="tabpanel" aria-labelledby="' + componentId + '-pose-2" data-art-state="ready">'
      + '<img class="modal-img" src="' + POSES['2'].src + '" width="666" height="421" alt="' + POSES['2'].alt + '" loading="eager" decoding="sync"></div>'
      + '<div class="atlas-sort postcard-pose-toggle" role="tablist" aria-label="Pose"><i class="seg-pill" aria-hidden="true"></i>'
      + '<button id="' + componentId + '-pose-1" type="button" role="tab" data-pose="1" aria-label="perched" aria-selected="false" aria-controls="' + componentId + '-artwork" tabindex="-1">' + PERCHED_ICON + '<span class="tip">perched</span></button>'
      + '<button id="' + componentId + '-pose-2" type="button" role="tab" data-pose="2" aria-label="in flight" aria-selected="true" aria-controls="' + componentId + '-artwork" tabindex="0">' + FLIGHT_ICON + '<span class="tip">in flight</span></button></div>'
      + '<nav class="postcard-links" aria-label="External bird references"><a href="https://en.wikipedia.org/wiki/Anna%27s_hummingbird" target="_blank" rel="noopener">Wikipedia <span aria-hidden="true">↗</span></a><a href="https://ebird.org/species/annhum" target="_blank" rel="noopener">eBird <span aria-hidden="true">↗</span></a></nav>'
      + '</div></section><section class="postcard-content"><header class="postcard-identity"><div class="postcard-heading">'
      + '<h2 id="' + componentId + '-title">Anna\'s Hummingbird</h2><div class="postcard-stats" aria-label="Bird history"><span><b>12.6k</b> heard</span><span><b>' + relativeDate('2026-05-21') + '</b> first heard</span></div></div>'
      + '<div class="postcard-stamp-slot" aria-label="Hummingbirds issue number 7"><img class="postcard-stamp-fallback" src="' + ROOT + 'anna-stamp.webp" width="632" height="797" alt=""></div></header>'
      + '<details class="postcard-section postcard-about" name="' + group + '" open><summary><span>About</span></summary><div class="postcard-section-body">'
      + '<div class="desc"><p>Anna\'s hummingbird (Calypte anna) is a North American species of hummingbird named after Anna Masséna, Duchess of Rivoli.</p><p>It is native to western coastal regions of North America. Until the late 20th century, Anna\'s hummingbirds migrated from locations as far north as Alaska and coastal British Columbia, returning south to breed in Baja California and Southern California.</p></div>'
      + '<div class="modal-meta"><span class="meta-item"><span class="k">Family</span><span class="v">Trochilidae</span></span><span class="meta-item"><span class="k">Genus</span><span class="v">Calypte</span></span><span class="meta-item"><span class="k">Species</span><span class="v">anna</span></span><span class="meta-item"><span class="k">Rarity</span><span class="v">common</span></span></div>'
      + '<p class="desc about-distinctive">The adult male has an iridescent crimson-red, derived from magenta, to a reddish-pink crown and gorget, which can look dull brown or gray without direct sunlight, and a dark, slightly forked tail. Females and juvenile males have a dull green crown, a grey throat with or without some red iridescence, a grey chest and belly, and a dark, rounded tail with white tips on the outer feathers.</p>'
      + '</div></details><details class="postcard-section postcard-recordings" name="' + group + '"><summary><span>Recordings</span><small>3 recordings</small></summary><div class="postcard-section-body">'
      + '<div class="rec-table-head" aria-hidden="true"><span>Last heard</span><span>Confidence</span><span>Date &amp; time</span></div><ol>' + rows + '</ol>'
      + '</div></details></section></article><span class="sr-only" data-postcard-status aria-live="polite"></span>';
  }
  function runtimePaths(markup) {
    return markup.replace(/\.\/assets\/stamp\//g, STAMP_ROOT + 'assets/stamp/').replace(/\.\/avian\/assets\/references\//g, STAMP_ROOT + 'assets/references/').replace(/paper-texture-grey\.png/g, 'paper-texture-grey.webp').replace(/sparrow-blossom-(single|pair)-v2\.png/g, 'sparrow-blossom-$1-v2.webp');
  }
  function fitStamp(slot) {
    var fit = slot.querySelector('.stamp-fit');
    if (!fit) return;
    var naturalWidth = fit.offsetWidth || parseFloat(fit.style.width) || 168;
    var naturalHeight = fit.offsetHeight || parseFloat(fit.style.height) || 215;
    var scale = Math.min((slot.clientWidth - 8) / naturalWidth, (slot.clientHeight - 8) / naturalHeight, 1);
    fit.style.setProperty('--postcard-scale', Math.max(.01, scale).toFixed(4));
  }
  function renderStamp(shadow) {
    var slot = shadow.querySelector('.postcard-stamp-slot');
    if (!slot) return;
    ensureStampRuntime().then(function () {
      var bird = { family: 'Hummingbirds', latin: 'Trochilidae', sci: 'Calypte anna', com: "Anna's Hummingbird", index: 7 };
      slot.innerHTML = runtimePaths(window.STAMPS.markup(bird, STAMP_ROOT + 'illustrations/calypte-anna.webp'));
      window.STAMPS.syncFringe(shadow);
      requestAnimationFrame(function () { fitStamp(slot); window.FX.run(shadow); });
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { fitStamp(slot); });
      if ('ResizeObserver' in window) {
        var observer = new ResizeObserver(function () { fitStamp(slot); });
        observer.observe(slot);
        slot._postcardStampObserver = observer;
      }
    }).catch(function () { slot.dataset.fallback = 'true'; });
  }
  function setProgress(row, audio, recording) {
    var duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : recording.duration;
    var current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    var ratio = duration ? Math.max(0, Math.min(1, current / duration)) : 0;
    var seek = row.querySelector('.rec-spectro-scrub');
    seek.max = duration || recording.duration;
    seek.value = current;
    seek.setAttribute('aria-valuetext', fmtClock(current) + ' of ' + fmtClock(duration));
    row.querySelector('.rec-spectro-played').style.width = (ratio * 100).toFixed(3) + '%';
    row.querySelector('.rec-spectro-cursor').style.left = (ratio * 100).toFixed(3) + '%';
    row.querySelector('.rec-player-time').textContent = fmtClock(current) + ' / ' + fmtClock(duration);
    row.querySelector('.rec-spectro').classList.toggle('armed', ratio > 0 || !audio.paused);
  }
  function pauseActive(except) {
    if (activePlayer && activePlayer.audio !== except) activePlayer.audio.pause();
  }
  function bindRecording(shadow, row, recording) {
    var toggle = row.querySelector('.rec-row-toggle');
    var panel = row.querySelector('.rec-spectro');
    var audio = row.querySelector('audio');
    var play = row.querySelector('.rec-player-toggle');
    var seek = row.querySelector('.rec-spectro-scrub');
    var loop = row.querySelector('.rec-loop-toggle');
    var loopHandles = Array.prototype.slice.call(row.querySelectorAll('.rec-loop-handle'));
    var loopStart = 0;
    var loopEnd = .25;
    var loopEnabled = false;
    var loopInitialized = false;
    var frame = 0;
    function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
    function audioDuration() {
      return Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : recording.duration;
    }
    function syncLoopRegion() {
      var duration = audioDuration();
      panel.toggleAttribute('data-loop', loopEnabled);
      panel.querySelector('.rec-loop-region').style.left = (loopStart * 100).toFixed(2) + '%';
      panel.querySelector('.rec-loop-region').style.width = ((loopEnd - loopStart) * 100).toFixed(2) + '%';
      loopHandles.forEach(function (handle) {
        var value = handle.dataset.edge === 'end' ? loopEnd : loopStart;
        handle.style.left = (value * 100).toFixed(2) + '%';
        handle.setAttribute('aria-valuenow', String(Math.round(value * 100)));
        handle.setAttribute('aria-valuetext', fmtClock(value * duration));
        handle.tabIndex = loopEnabled ? 0 : -1;
      });
      loop.setAttribute('aria-pressed', loopEnabled ? 'true' : 'false');
      loop.setAttribute('aria-label', loopEnabled ? 'Stop repeating selected section' : 'Repeat a selected section');
    }
    function moveLoopEdge(edge, value) {
      var position = clamp01(value);
      if (edge === 'start') loopStart = Math.min(position, loopEnd - .04);
      else loopEnd = Math.max(position, loopStart + .04);
      loopStart = clamp01(loopStart);
      loopEnd = clamp01(loopEnd);
      loopInitialized = true;
      syncLoopRegion();
    }
    function pointerPosition(clientX) {
      var rect = panel.getBoundingClientRect();
      return rect.width ? clamp01((clientX - rect.left) / rect.width) : 0;
    }
    function setLoopEnabled(enabled) {
      loopEnabled = enabled;
      if (enabled && !loopInitialized) {
        var duration = audioDuration();
        loopStart = duration ? clamp01(audio.currentTime / duration) : 0;
        loopEnd = Math.min(1, loopStart + .25);
        if (loopEnd - loopStart < .08) loopStart = Math.max(0, loopEnd - .25);
        loopInitialized = true;
      }
      syncLoopRegion();
    }
    loopHandles.forEach(function (handle) {
      var dragging = false;
      handle.addEventListener('pointerdown', function (event) {
        if (!loopEnabled) return;
        dragging = true;
        moveLoopEdge(handle.dataset.edge, pointerPosition(event.clientX));
        try { handle.setPointerCapture(event.pointerId); } catch (error) {}
        event.preventDefault();
      });
      handle.addEventListener('pointermove', function (event) {
        if (dragging) moveLoopEdge(handle.dataset.edge, pointerPosition(event.clientX));
      });
      function finishDrag() { dragging = false; }
      handle.addEventListener('pointerup', finishDrag);
      handle.addEventListener('pointercancel', finishDrag);
      handle.addEventListener('lostpointercapture', finishDrag);
      handle.addEventListener('keydown', function (event) {
        var value = Number(handle.getAttribute('aria-valuenow') || 0) / 100;
        var step = event.shiftKey ? .1 : .02;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') value -= step;
        else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') value += step;
        else if (event.key === 'PageDown') value -= .1;
        else if (event.key === 'PageUp') value += .1;
        else if (event.key === 'Home') value = 0;
        else if (event.key === 'End') value = 1;
        else return;
        moveLoopEdge(handle.dataset.edge, value);
        event.preventDefault();
      });
    });
    toggle.addEventListener('click', function () {
      var opening = !row.classList.contains('expanded');
      shadow.querySelectorAll('[data-recording]').forEach(function (other) {
        if (other === row) return;
        other.classList.remove('expanded');
        other.querySelector('.rec-row-toggle').setAttribute('aria-expanded', 'false');
        other.querySelector('.rec-spectro').setAttribute('aria-hidden', 'true');
        other.querySelector('.rec-spectro').setAttribute('inert', '');
        other.querySelector('audio').pause();
      });
      row.classList.toggle('expanded', opening);
      toggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
      panel.setAttribute('aria-hidden', opening ? 'false' : 'true');
      panel.toggleAttribute('inert', !opening);
      if (!opening) audio.pause();
    });
    play.addEventListener('click', function () {
      if (!audio.paused) { audio.pause(); return; }
      pauseActive(audio);
      audio.play().catch(function () { play.disabled = true; play.dataset.error = 'true'; play.setAttribute('aria-label', 'Audio unavailable'); });
    });
    seek.addEventListener('input', function () {
      var duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : recording.duration;
      audio.currentTime = Math.max(0, Math.min(duration, parseFloat(seek.value) || 0));
      setProgress(row, audio, recording);
    });
    loop.addEventListener('click', function () {
      setLoopEnabled(!loopEnabled);
    });
    function tick() {
      setProgress(row, audio, recording);
      if (!audio.paused && !audio.ended) frame = requestAnimationFrame(tick);
    }
    audio.addEventListener('loadedmetadata', function () { setProgress(row, audio, recording); });
    audio.addEventListener('durationchange', function () { setProgress(row, audio, recording); });
    audio.addEventListener('timeupdate', function () {
      var duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : recording.duration;
      if (loop.getAttribute('aria-pressed') === 'true' && duration && audio.currentTime >= duration * loopEnd) audio.currentTime = duration * loopStart;
      setProgress(row, audio, recording);
    });
    audio.addEventListener('play', function () {
      pauseActive(audio);
      activePlayer = { audio: audio, button: play };
      play.innerHTML = PAUSE_ICON;
      play.dataset.active = 'true';
      play.setAttribute('aria-label', 'Pause recording');
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    });
    audio.addEventListener('pause', function () {
      play.innerHTML = PLAY_ICON;
      play.dataset.active = 'false';
      play.setAttribute('aria-label', 'Play recording');
      if (activePlayer && activePlayer.audio === audio) activePlayer = null;
      cancelAnimationFrame(frame);
      setProgress(row, audio, recording);
    });
    audio.addEventListener('ended', function () { audio.currentTime = 0; setProgress(row, audio, recording); });
    audio.addEventListener('error', function () { play.disabled = true; play.dataset.error = 'true'; seek.disabled = true; });
    syncLoopRegion();
    setProgress(row, audio, recording);
  }
  function bindPostcard(shadow) {
    var artwork = shadow.querySelector('.postcard-artwork');
    var bird = shadow.querySelector('.modal-img');
    var status = shadow.querySelector('[data-postcard-status]');
    var poseButtons = Array.prototype.slice.call(shadow.querySelectorAll('[data-pose]'));
    poseButtons.forEach(function (button, index) {
      button.addEventListener('click', function () {
        var pose = POSES[button.dataset.pose];
        if (!pose) return;
        poseButtons.forEach(function (candidate) {
          var selected = candidate === button;
          candidate.setAttribute('aria-selected', selected ? 'true' : 'false');
          candidate.tabIndex = selected ? 0 : -1;
        });
        artwork.setAttribute('aria-labelledby', button.id);
        bird.classList.add('is-loading');
        bird.src = pose.src;
        bird.alt = pose.alt;
        bird.width = pose.width;
        bird.height = pose.height;
        if (bird.decode) bird.decode().catch(function () {}).then(function () { bird.classList.remove('is-loading'); });
        else bird.classList.remove('is-loading');
        status.textContent = button.dataset.pose === '2' ? 'Showing the in-flight illustration.' : 'Showing the perched illustration.';
      });
      button.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        var direction = event.key === 'ArrowRight' ? 1 : -1;
        var next = (index + direction + poseButtons.length) % poseButtons.length;
        poseButtons[next].focus();
        poseButtons[next].click();
      });
    });
    var sections = Array.prototype.slice.call(shadow.querySelectorAll('.postcard-section'));
    sections.forEach(function (section) {
      section.addEventListener('toggle', function () {
        if (section.open) sections.forEach(function (other) { if (other !== section) other.open = false; });
        if (!section.open && section.classList.contains('postcard-recordings')) section.querySelectorAll('audio').forEach(function (audio) { audio.pause(); });
      });
    });
    shadow.querySelectorAll('[data-recording]').forEach(function (row, index) { bindRecording(shadow, row, RECORDINGS[index]); });
    renderStamp(shadow);
  }
  function mount(host, index) {
    if (host.dataset.mounted === 'true') return;
    host.dataset.state = 'loading';
    host.setAttribute('aria-busy', 'true');
    host.setAttribute('aria-label', "Interactive Anna's Hummingbird field postcard");
    [
      ['display', 'block'],
      ['width', '100%'],
      ['max-width', 'none'],
      ['min-width', '0'],
      ['margin', '2rem auto 2.4rem'],
      ['padding', '0'],
      ['border', '0'],
      ['background', 'transparent'],
      ['position', 'relative']
    ].forEach(function (rule) { host.style.setProperty(rule[0], rule[1], 'important'); });
    var shadow;
    try {
      shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
      var frame = document.createElement('div');
      frame.className = 'postcard-embed';
      frame.innerHTML = postcardMarkup('avian-postcard-' + (index + 1));
      shadow.replaceChildren(frame);
      bindPostcard(shadow);
      host.dataset.mounted = 'true';
      Promise.all([styleShadow(shadow), preloadImages()]).then(function () {
        host.dataset.state = 'ready';
        host.setAttribute('aria-busy', 'false');
      });
    } catch (error) {
      if (shadow) shadow.replaceChildren();
      delete host.dataset.mounted;
      host.dataset.state = 'error';
      host.setAttribute('aria-busy', 'false');
      var status = host.querySelector('[data-avian-postcard-status]');
      if (status) status.textContent = "Anna's Hummingbird postcard is temporarily unavailable.";
      console.error('Unable to mount the Avian Atlas postcard.', error);
    }
  }
  function init() {
    if (activePlayer && !activePlayer.audio.isConnected) activePlayer.audio.pause();
    syncTheme();
    watchTheme();
    Array.prototype.slice.call(document.querySelectorAll('[data-avian-postcard]')).forEach(mount);
  }
  window.initAvianPostcard = init;
  if (typeof document$ !== 'undefined') document$.subscribe(init);
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}());
