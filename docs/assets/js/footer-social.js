// Footer social: swap the legacy email icon for Instagram on every page,
// including pages whose source is owned by other build steps (store/legal).
// Targets only the footer social link (mailto with a paper-plane icon), never
// the inline text email links. Idempotent.
(function () {
  var IG = 'https://www.instagram.com/teddymakesstuff/';
  // Update only the displayed footer year, never copyright notices in content.
  function updateCopyright() {
    var year = new Date().getFullYear();
    document.querySelectorAll('.copyright, .md-copyright__highlight a').forEach(function (node) {
      node.textContent = node.textContent.replace(
        /(Copyright\s*©\s*)\d{4}(\s+Teddy Warner)/,
        function (_, prefix, suffix) { return prefix + year + suffix; }
      );
    });
  }
  function scheduleCopyrightUpdate() {
    updateCopyright();
    var now = new Date();
    var tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    setTimeout(scheduleCopyrightUpdate, tomorrow.getTime() - now.getTime() + 1000);
  }
  scheduleCopyrightUpdate();
  window.addEventListener('pageshow', updateCopyright);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) updateCopyright();
  });
  function swap() {
    updateCopyright();
    document.querySelectorAll('a[href="mailto:teddy@warner.net"]').forEach(function (a) {
      var icon = a.querySelector('i.fa-paper-plane');
      if (!icon) return;
      a.setAttribute('href', IG);
      a.setAttribute('rel', 'noopener');
      a.setAttribute('aria-label', 'Instagram');
      icon.className = 'fa-brands fa-instagram';
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', swap);
  else swap();
  var sub = setInterval(function () {
    if (typeof document$ !== 'undefined') { clearInterval(sub); document$.subscribe(swap); }
  }, 100);
})();
