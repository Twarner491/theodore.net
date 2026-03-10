// Marginfigure lightbox: click to expand margin images on desktop.
// Skipped on mobile (< 1100px) where marginfigures are inline.
(function() {
  var overlay = null;
  var isClosing = false;

  function isDesktop() {
    return window.innerWidth > 1100;
  }

  function close() {
    if (!overlay || isClosing) return;
    isClosing = true;
    overlay.classList.remove('active');
    setTimeout(function() {
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      overlay = null;
      isClosing = false;
    }, 300);
  }

  function open(src, alt, captionHTML) {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'marginfigure-lightbox';

    var wrap = document.createElement('div');
    wrap.className = 'marginfigure-lightbox-inner';

    var img = document.createElement('img');
    img.src = src;
    img.alt = alt || '';
    wrap.appendChild(img);

    if (captionHTML) {
      var cap = document.createElement('p');
      cap.className = 'marginfigure-lightbox-caption';
      cap.innerHTML = captionHTML;
      wrap.appendChild(cap);
    }

    overlay.appendChild(wrap);
    document.body.appendChild(overlay);

    // Trigger reflow then activate
    overlay.offsetHeight;
    overlay.classList.add('active');

    overlay.addEventListener('click', close);
    // Prevent clicks on the inner content from closing (except the image itself)
    wrap.addEventListener('click', function(e) { e.stopPropagation(); });
    img.addEventListener('click', close);
  }

  function getCaption(imgEl) {
    // Caption is the text/HTML content inside .marginfigure after the <img>
    var parent = imgEl.closest('.marginfigure');
    if (!parent) return '';
    // Clone the marginfigure, remove the img, return remaining innerHTML
    var clone = parent.cloneNode(true);
    var imgs = clone.querySelectorAll('img');
    imgs.forEach(function(i) { i.remove(); });
    var html = clone.innerHTML.trim();
    return html || '';
  }

  function init() {
    document.querySelectorAll('.marginfigure img').forEach(function(img) {
      if (img.dataset.lightbox) return;
      img.dataset.lightbox = '1';
      img.addEventListener('click', function(e) {
        if (!isDesktop()) return;
        e.preventDefault();
        e.stopPropagation();
        open(img.src, img.alt, getCaption(img));
      });
    });
  }

  // Escape key to close
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') close();
  });

  // Init on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Re-init on Material instant navigation
  var sub = setInterval(function() {
    if (typeof document$ !== 'undefined') {
      clearInterval(sub);
      document$.subscribe(function() { init(); });
    }
  }, 100);
})();
