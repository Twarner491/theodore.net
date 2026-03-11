// MathJax Configuration - must be set BEFORE MathJax library loads
window.MathJax = {
  tex: {
    inlineMath: [["\\(", "\\)"], ["$", "$"]],
    displayMath: [["\\[", "\\]"], ["$$", "$$"]],
    processEscapes: true,
    processEnvironments: true
  },
  options: {
    ignoreHtmlClass: ".*|",
    processHtmlClass: "arithmatex|sidenote|marginnote|marginfigure"
  }
};

// Function to typeset math content
function typesetMath() {
  if (typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
    var content = document.querySelector('.md-content');
    if (content && MathJax.typesetClear) {
      MathJax.typesetClear([content]);
    }
    MathJax.typesetPromise(content ? [content] : undefined).catch(function(err) {
      console.warn('MathJax typeset error:', err);
    });
  }
}

// Wait for document$ to become available, then subscribe
function setupInstantNavSubscription() {
  if (typeof document$ !== 'undefined' && document$.subscribe) {
    document$.subscribe(function() {
      // Delay to ensure new content is in DOM after navigation
      setTimeout(typesetMath, 100);
    });
    return true;
  }
  return false;
}

// Poll for document$ availability (Material for MkDocs may load it after our script)
function waitForDocumentObservable() {
  if (!setupInstantNavSubscription()) {
    // Not available yet, try again
    setTimeout(waitForDocumentObservable, 100);
  }
}

// Start polling for document$ after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() {
    // Initial typeset
    setTimeout(typesetMath, 100);
    // Set up instant navigation listener
    waitForDocumentObservable();
  });
} else {
  // DOM already loaded
  setTimeout(typesetMath, 100);
  waitForDocumentObservable();
}
