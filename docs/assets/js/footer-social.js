// Footer social: swap the legacy email icon for Instagram on every page,
// including pages whose source is owned by other build steps (store/legal).
// Targets only the footer social link (mailto with a paper-plane icon), never
// the inline text email links. Idempotent.
(function () {
  var IG = 'https://www.instagram.com/teddymakesstuff/';
  function swap() {
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
