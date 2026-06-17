// Click-to-copy for article code blocks: a clipboard button on hover, and a
// click anywhere in the block copies its contents (unless text is selected).
(function () {
  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta); done();
  }
  function copy(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
    } else { fallbackCopy(text, done); }
  }
  function codeText(block) {
    var code = block.querySelector('code');
    return (code ? code.innerText : block.innerText).replace(/\n+$/, '');
  }

  var copyIcon = '<svg class="cc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var checkIcon = '<svg class="cc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';

  function init() {
    var root = document.querySelector('.md-content__inner.md-typeset');
    if (!root) return;
    root.querySelectorAll('.highlight').forEach(function (block) {
      if (block.dataset.ccInit) return;
      block.dataset.ccInit = '1';

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cc-copy';
      btn.setAttribute('aria-label', 'Copy to clipboard');
      btn.innerHTML = copyIcon;
      block.appendChild(btn);

      block.addEventListener('click', function (e) {
        var onBtn = !!e.target.closest('.cc-copy');
        var sel = window.getSelection ? String(window.getSelection()) : '';
        if (!onBtn && sel.trim()) return;       // let the user select text
        copy(codeText(block), function () {
          block.classList.add('cc-copied');
          btn.innerHTML = checkIcon;
          clearTimeout(block._ccT);
          block._ccT = setTimeout(function () {
            block.classList.remove('cc-copied');
            btn.innerHTML = copyIcon;
          }, 1300);
        });
      });
    });
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  ready(init);
  var sub = setInterval(function () {
    if (typeof document$ !== 'undefined') { clearInterval(sub); document$.subscribe(init); }
  }, 100);
})();
