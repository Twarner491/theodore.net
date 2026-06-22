document.addEventListener("DOMContentLoaded", function() {
  let ticking = false;

  // Batch all DOM measurements together to avoid forced reflows
  var contentSections = document.querySelectorAll('.content-container > section');
  var heights = [];
  
  // Read all heights first (batched reads)
  contentSections.forEach(function(section) {
    heights.push(section.offsetHeight);
  });
  
  // Then apply all position changes (batched writes)
  var previousHeight = 0;
  contentSections.forEach(function(section, index) {
    section.style.top = previousHeight + 'px';
    previousHeight += heights[index];
  });

  // Add staggered animations for experience items
  const experienceItems = document.querySelectorAll('.content3 .company, .content3 .role, .content3 .year');
  experienceItems.forEach((item, index) => {
    item.style.animationDelay = `${index * 0.06}s`;
  });

  // Add staggered animations for project grid items
  const projectItems = document.querySelectorAll('.content5 .grid-item');
  projectItems.forEach((item, index) => {
    item.style.animationDelay = `${index * 0.1}s`;
  });

  // Add staggered animations for writing items
  const writingItems = document.querySelectorAll('.content6 .writparent');
  writingItems.forEach((item, index) => {
    item.style.animationDelay = `${index * 0.15}s`;
  });

  // Add intersection observer for scroll animations
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.animationPlayState = 'running';
      }
    });
  }, {
    threshold: 0.05,
    rootMargin: '50px'
  });

  // Observe elements
  document.querySelectorAll('.introabt, .featured-projects, .content3 hr, .company, .role, .year, .grid-item, .writparent').forEach(el => {
    el.style.animationPlayState = 'paused';
    observer.observe(el);
  });

  // Blur overlay opacity on scroll
  document.addEventListener('scroll', function() {
    if (!ticking) {
      window.requestAnimationFrame(function() {
        const scrollPosition = window.scrollY;
        const blurOverlay = document.querySelector('.blur-overlay');
        
        if (blurOverlay) {
          const opacity = Math.min(scrollPosition / 100, 1);
          blurOverlay.style.opacity = opacity;
        }
        ticking = false;
      });
      
      ticking = true;
    }
  });
});

var supportsCssVars = function() {
  var e, t = document.createElement("style");
  return t.innerHTML = "root: { --tmp-var: bold; }", document.head.appendChild(t), e = !!(window.CSS && window.CSS.supports && window.CSS.supports("font-weight", "var(--tmp-var)")), t.parentNode.removeChild(t), e
};
supportsCssVars() || alert("Please view this page in a modern browser that supports CSS Variables :).");

// togglemenu() intentionally lives in header.js (the full version: scroll-position compensation +
// the injected nav close button). index.js loads globally via extra_javascript, so defining
// togglemenu here would OVERRIDE header.js's on any page where header.js isn't deferred — which is
// what dropped the close X and the jitter fix on the projects / writings / article pages.

// Circle text rotation - smooth reverse on hover
(function() {
  var circleGroup = document.querySelector('.circleGroup');
  if (!circleGroup) return;

  var currentAngle = 0;
  var animationSpeed = 360 / 7; // degrees per second (matches 7s full rotation)
  var direction = 1; // 1 = normal, -1 = reverse
  var lastTime = null;
  var animationId = null;

  function animate(timestamp) {
    if (lastTime === null) lastTime = timestamp;
    var delta = (timestamp - lastTime) / 1000; // seconds
    lastTime = timestamp;

    currentAngle += animationSpeed * delta * direction;
    // Keep angle within 0-360 for cleanliness
    currentAngle = ((currentAngle % 360) + 360) % 360;

    circleGroup.style.transform = 'rotate(' + currentAngle + 'deg)';
    animationId = requestAnimationFrame(animate);
  }

  // Start animation
  animationId = requestAnimationFrame(animate);

  window.leftrevoff = function() {
    direction = -1;
  };

  window.leftrevon = function() {
    direction = 1;
  };
})();

// Reading card book animation - smooth reverse on hover with interruption handling
(function() {
  var readingCard = document.getElementById('reading-card');
  if (!readingCard) return;
  
  var bookImage = readingCard.querySelector('image');
  if (!bookImage) return;

  // Animation state
  var progress = 0; // 0 = start (rotated), 1 = end (flat/translated)
  var targetProgress = 0; // 0 = not hovered, 1 = hovered
  var animationId = null;
  var lastTime = null;
  var animationDuration = 300; // ms - matches the original CSS transition

  // Transform values
  // Start: rotate(10deg) around point (930.473, 713) - original SVG transform
  // End: rotate(0deg) translate(-5.9%, -6.4%) relative to element
  var startRotation = 10;
  var endRotation = 0;
  var startTranslateX = 0;
  var startTranslateY = 0;
  var endTranslateX = -5.9; // percentage
  var endTranslateY = -6.4; // percentage

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function lerp(start, end, t) {
    return start + (end - start) * t;
  }

  function updateTransform() {
    var easedProgress = easeInOutCubic(progress);
    var rotation = lerp(startRotation, endRotation, easedProgress);
    var translateX = lerp(startTranslateX, endTranslateX, easedProgress);
    var translateY = lerp(startTranslateY, endTranslateY, easedProgress);
    
    // Apply transform: translate first (in percentages), then rotate around the pivot
    // The original SVG has transform="rotate(10 930.473 713)" which rotates around that point
    // We need to replicate this behavior with CSS transforms
    bookImage.style.transform = 
      'translate(' + translateX + '%, ' + translateY + '%) ' +
      'rotate(' + rotation + 'deg)';
    bookImage.style.transformOrigin = '930.473px 713px';
  }

  function animate(timestamp) {
    if (lastTime === null) lastTime = timestamp;
    var delta = timestamp - lastTime;
    lastTime = timestamp;

    // Calculate progress change based on time
    var progressDelta = delta / animationDuration;
    
    if (progress < targetProgress) {
      progress = Math.min(progress + progressDelta, targetProgress);
    } else if (progress > targetProgress) {
      progress = Math.max(progress - progressDelta, targetProgress);
    }

    updateTransform();

    // Continue animation if not at target
    if (progress !== targetProgress) {
      animationId = requestAnimationFrame(animate);
    } else {
      animationId = null;
      lastTime = null;
    }
  }

  function startAnimation() {
    if (animationId === null) {
      lastTime = null;
      animationId = requestAnimationFrame(animate);
    }
  }

  // Remove the inline SVG transform attribute since we're handling it with JS
  bookImage.removeAttribute('transform');
  
  // Set initial state
  updateTransform();

  readingCard.addEventListener('mouseenter', function() {
    targetProgress = 1;
    startAnimation();
  });

  readingCard.addEventListener('mouseleave', function() {
    targetProgress = 0;
    startAnimation();
  });
})();

// On load (and on Material navigation) honor a deep link to a heading permalink (#hash) by jumping to
// it; otherwise reset to the top (the original behavior for plain navigation). Without the hash check,
// scrollToTop() defeated the browser's native #anchor jump, so a permalinked heading opened directly in
// a new tab never scrolled into view.
(function() {
  function scrollToTop() {
    window.scrollTo(0, 0);
  }

  function jumpToHash() {
    var h = window.location.hash;
    if (!h || h.length < 2) return false;
    var id; try { id = decodeURIComponent(h.slice(1)); } catch (e) { id = h.slice(1); }
    var el = document.getElementById(id);
    if (!el) return false;
    el.scrollIntoView();
    return true;
  }

  function onDocument() {
    if (jumpToHash()) {
      // Re-assert after late layout settles: images/fonts above the target can shift it after the
      // first jump, leaving the heading off-screen. rAF catches the immediate reflow; load covers images.
      requestAnimationFrame(jumpToHash);
      window.addEventListener('load', jumpToHash, { once: true });
    } else {
      scrollToTop();
    }
  }

  // Wait for document$ to be available (MkDocs Material instant navigation)
  function setupScrollReset() {
    if (typeof document$ !== 'undefined' && document$.subscribe) {
      document$.subscribe(onDocument);
      return true;
    }
    return false;
  }

  // Poll for document$ availability
  function waitForDocumentObservable() {
    if (!setupScrollReset()) {
      setTimeout(waitForDocumentObservable, 100);
    }
  }

  // Start polling after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForDocumentObservable);
  } else {
    waitForDocumentObservable();
  }
})();

/* index store-section product images follow the Material theme (swap to "<name>DARK.<ext>" in dark mode) */
(function () {
  function swap() {
    var dark = (document.body.getAttribute("data-md-color-scheme") || document.documentElement.getAttribute("data-md-color-scheme")) === "slate";
    var imgs = document.querySelectorAll(".store-mini-img img");
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i], cur = img.getAttribute("src");
      if (!cur) continue;
      var light = cur.replace(/DARK(\.[A-Za-z0-9]+)$/, "$1");
      var want = dark ? light.replace(/(\.[A-Za-z0-9]+)$/, "DARK$1") : light;
      if (cur === want) continue;
      img.onerror = dark ? function () { this.onerror = null; this.src = this.src.replace(/DARK(\.[A-Za-z0-9]+)$/, "$1"); } : null;
      img.setAttribute("src", want);
    }
  }
  function start() {
    // TEMP: the dark-mode store-mini images do not exist yet, so keep the light images under the
    // slate scheme rather than swapping to missing "<name>DARK" files. Delete this early return
    // (and ship the *DARK.png variants) to re-enable the theme swap.
    return;
    if (!document.querySelector(".store-mini-img img")) return;
    swap();
    var obs = new MutationObserver(swap);
    obs.observe(document.body, { attributes: true, attributeFilter: ["data-md-color-scheme"] });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-md-color-scheme"] });
  }
  if (document.readyState !== "loading") start();
  else document.addEventListener("DOMContentLoaded", start);
})();
