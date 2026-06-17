function initializeHeader() {
  let lastScrollTop = 0;
  const scrollThreshold = 100;
  const minScrollForMobile = 50;
  let scrollTimer = null;
  
  function isMobileView() {
    // Check both window.innerWidth and document.documentElement.clientWidth
    // Some markdown pages might report different widths
    return window.innerWidth <= 695 || document.documentElement.clientWidth <= 695;
  }
  
  function handleScroll() {
    const currentScroll = window.pageYOffset || document.documentElement.scrollTop;
    const isMobile = isMobileView();
    
    if (isMobile) {
      const scrollDelta = currentScroll - lastScrollTop;
      
      // Clear existing timer
      if (scrollTimer !== null) {
        clearTimeout(scrollTimer);
      }
      
      if (Math.abs(scrollDelta) > 5) {
        if (scrollDelta > 0 && currentScroll > minScrollForMobile) {
          document.body.classList.remove('scrollUp');
          document.body.classList.add('scrollDown');
        } else if (scrollDelta < 0) {
          document.body.classList.remove('scrollDown');
          document.body.classList.add('scrollUp');
          
          // Set timer to keep header visible for a moment after scrolling up
          scrollTimer = setTimeout(() => {
            if (currentScroll <= minScrollForMobile) {
              document.body.classList.remove('scrollDown');
              document.body.classList.add('scrollUp');
            }
          }, 150);
        }
      }
    } else {
      if (currentScroll > scrollThreshold) {
        document.body.classList.add('scrolled');
      } else {
        document.body.classList.remove('scrolled');
      }
    }
    
    lastScrollTop = currentScroll;
  }

  // Remove any existing scroll listeners
  window.removeEventListener('scroll', handleScroll);
  
  // Add the scroll listener
  window.addEventListener('scroll', handleScroll, { passive: true });
}

// Initialize on DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeHeader);
} else {
  initializeHeader();
}

// The nav menu overlay covers the whole header when open, hiding the header's toggle button behind
// it. So the close X is a BODY-LEVEL fixed element above the overlay (z-index 60), pinned over the
// hamburger's spot. It does NOT slide in with the menu: the hamburger is covered and the X appears
// in its place, reading as the hamburger morphing into the X (with the colour flip). Created once.
function ensureNavClose() {
  var btn = document.getElementById('nav-close');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'nav-close';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Close menu');
    // Font Awesome xmark, matching the other close icons. FA is in webfont mode here, so a
    // dynamically-created <i> picks up the glyph via CSS like the static ones do.
    btn.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
    btn.addEventListener('click', function() { window.togglemenu(); });
    document.body.appendChild(btn);
  }
  return btn;
}

// Global toggle menu function
window.togglemenu = function() {
  var element = document.body;
  var html = document.documentElement;
  const currentScroll = window.pageYOffset || document.documentElement.scrollTop;

  // Opening locks the page scroll (html:has(body.toggle){overflow:hidden}), which removes the
  // scrollbar and would widen the page, jittering the right-aligned header icons sideways.
  // Reserve the removed scrollbar's width with padding so nothing moves. Measured before the
  // toggle (while the scrollbar is still there); 0 on overlay-scrollbar systems, so a no-op there.
  var opening = !element.classList.contains('toggle');
  var pad = opening ? (window.innerWidth - html.clientWidth) + 'px' : '';

  if (currentScroll > 100) {
    element.classList.add('scrolled');
  }

  // Pin the close X over the hamburger's spot and reveal it while open (hide on close). It's a
  // body-level fixed element, so it stays put (no slide) and just appears where the hamburger was.
  // Read #parent AFTER .scrolled (correct vertical position) but BEFORE .toggle (whose menu->X
  // icon-swap shifts the button a few px).
  var nav = ensureNavClose();
  if (nav && opening) {
    var r = document.getElementById('parent').getBoundingClientRect();
    nav.style.top = r.top + 'px';
    nav.style.left = r.left + 'px';
    nav.style.width = r.width + 'px';
    nav.style.height = r.height + 'px';
    nav.classList.add('show');
  } else if (nav) {
    nav.classList.remove('show');
  }

  element.classList.toggle("toggle");
  element.classList.add("scrollUp");
  html.style.paddingRight = pad;
}