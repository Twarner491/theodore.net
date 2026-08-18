// Load interactive embeds near the viewport without allowing their startup
// focus to move the parent page. The wrapper keeps its authored dimensions
// while the iframe finishes its hidden startup, then the iframe is revealed.
(function () {
  var observed = new WeakSet();
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;

      var frame = entry.target;
      var src = frame.dataset.src;
      observer.unobserve(frame);
      if (!src || frame.hasAttribute("src")) return;

      var authoredStyle = frame.getAttribute("style");
      frame.style.setProperty("display", "none", "important");
      frame.addEventListener("load", function () {
        setTimeout(function () {
          if (authoredStyle === null) frame.removeAttribute("style");
          else frame.setAttribute("style", authoredStyle);
        }, 1000); // Let post-load startup scripts finish before the frame is focusable.
      }, { once: true });
      frame.src = src;
    });
  }, { rootMargin: "300px" });

  function observeEmbeds() {
    document.querySelectorAll("iframe[data-src]").forEach(function (frame) {
      if (observed.has(frame)) return;
      observed.add(frame);
      observer.observe(frame);
    });
  }

  if (typeof document$ !== "undefined") {
    document$.subscribe(observeEmbeds);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observeEmbeds);
  } else {
    observeEmbeds();
  }
})();
