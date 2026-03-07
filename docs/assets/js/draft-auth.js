(function () {
  var overlay = document.getElementById('draftOverlay');
  if (!overlay) return;

  var hash = overlay.getAttribute('data-hash');
  if (!hash) return;

  var isLocalhost =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.startsWith('192.168.');

  if (isLocalhost) {
    overlay.remove();
    return;
  }

  // Check sessionStorage for previously authenticated password
  var stored = sessionStorage.getItem('draft_auth');
  if (stored === hash) {
    overlay.remove();
    return;
  }

  // Lock scrolling
  document.body.classList.add('draft-locked');

  // Focus the input
  var input = document.getElementById('draftPassword');
  if (input) input.focus();

  var form = document.getElementById('draftForm');
  var error = document.getElementById('draftError');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var pw = input.value;
    if (!pw) return;

    crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw)).then(function (buf) {
      var arr = Array.from(new Uint8Array(buf));
      var hex = arr.map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');

      if (hex === hash) {
        sessionStorage.setItem('draft_auth', hash);
        overlay.classList.add('draft-overlay--hidden');
        document.body.classList.remove('draft-locked');
        setTimeout(function () { overlay.remove(); }, 350);
      } else {
        error.textContent = 'Incorrect password';
        input.value = '';
        input.focus();
        error.classList.add('draft-error--visible');
        setTimeout(function () { error.classList.remove('draft-error--visible'); }, 2000);
      }
    });
  });
})();
