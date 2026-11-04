/* Newsletter signup and explicitly requested cart email. Local mode never delivers mail. */
(function () {
  "use strict";

  if (!window.TheodoreRecoveryPreview || !window.TheodoreRecoveryPreview.active) return;
  const recovery = window.TheodoreRecoveryPreview;
  const local = recovery.mode !== "live";
  const arrow = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  const closeIcon = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="m6 6 12 12M6 18 18 6"/></svg>';

  function setupNewsletter() {
    if (recovery.newsletterEnabled === false) return;
    const info = document.querySelector('#product-detail[data-product] .pd-info');
    if (!info || info.querySelector(".newsletter-preview")) return;
    const form = document.createElement("form");
    form.className = "newsletter-preview";
    form.id = "newsletter-preview";
    form.noValidate = true;
    form.setAttribute("aria-label", "Newsletter signup");
    form.innerHTML =
      '<p id="newsletter-preview-description" class="newsletter-preview-description">Sign up for new releases, restocks and deals.</p>' +
      '<div class="newsletter-preview-fields">' +
        '<input id="newsletter-preview-email" name="newsletter-email" type="email" aria-label="Email for store updates and deals" placeholder="your@email.com" autocomplete="email" inputmode="email" required aria-describedby="newsletter-preview-description newsletter-preview-error">' +
        '<button type="submit" aria-label="Subscribe">' + arrow + '</button>' +
      '</div>' +
      '<p id="newsletter-preview-error" class="newsletter-preview-message" role="alert" hidden></p>' +
      '<p class="newsletter-preview-message newsletter-preview-status" role="status" aria-atomic="true"></p>';
    info.appendChild(form);
    const email = form.querySelector("input"), button = form.querySelector("button");
    const error = form.querySelector("#newsletter-preview-error");
    const status = form.querySelector(".newsletter-preview-status");
    let pending = false;
    function clearMessage() {
      error.hidden = true; error.textContent = ""; status.textContent = "";
      email.removeAttribute("aria-invalid");
    }
    email.addEventListener("input", clearMessage);
    form.addEventListener("submit", async function (event) {
      event.preventDefault(); event.stopPropagation();
      if (pending) return;
      clearMessage();
      if (!email.validity.valid) {
        error.textContent = "Enter an email address, like name@example.com.";
        error.hidden = false; email.setAttribute("aria-invalid", "true"); email.focus(); return;
      }
      pending = true; button.disabled = true; email.disabled = true;
      status.textContent = "Saving your signup…";
      try {
        const result = await recovery.subscribe(email.value.trim());
        if (!result || result.ok !== true || result.status !== (local ? "queued_local" : "subscribed")) throw new Error("The server did not confirm your signup. Please try again.");
        email.value = "";
        status.textContent = local ? "Signup saved locally. No email was sent." : result.confirmationRequired ? "Check your inbox to confirm your signup." : "You’re signed up.";
      } catch (failure) {
        status.textContent = ""; error.textContent = failure.message || "Unable to save your signup. Please try again."; error.hidden = false;
      } finally { pending = false; button.disabled = false; email.disabled = false; }
    });
  }

  function setup(drawer) {
    if (recovery.cartEmailEnabled === false) return;
    const checkout = drawer.querySelector(".cart-checkout"), items = drawer.querySelector(".cart-items");
    if (!checkout || !items || drawer.querySelector(".recovery-preview")) return;
    const host = document.createElement("section");
    host.className = "recovery-preview"; host.hidden = true;
    host.innerHTML =
      '<button class="recovery-preview-toggle" type="button" aria-expanded="false" aria-controls="recovery-preview-form">Email me this cart</button>' +
      '<form id="recovery-preview-form" class="recovery-preview-form" novalidate hidden>' +
        '<div class="recovery-preview-fields">' +
          '<input id="recovery-preview-email" type="email" name="cart-email" aria-label="Email for this cart" placeholder="your@email.com" inputmode="email" autocomplete="email" required aria-describedby="recovery-preview-error">' +
          '<button class="recovery-preview-action" type="button" aria-label="Close cart email">' + closeIcon + '</button>' +
        '</div>' +
        '<p id="recovery-preview-error" class="recovery-preview-error" role="alert" hidden></p>' +
        '<p class="recovery-preview-status" role="status" aria-atomic="true"></p>' +
        '<button class="recovery-preview-show" type="button" hidden>Preview email</button>' +
      '</form>';
    checkout.insertAdjacentElement("afterend", host);
    const toggle = host.querySelector(".recovery-preview-toggle"), form = host.querySelector("form"), email = host.querySelector("input");
    const action = host.querySelector(".recovery-preview-action"), error = host.querySelector(".recovery-preview-error");
    const status = host.querySelector(".recovery-preview-status"), show = host.querySelector(".recovery-preview-show");
    const dialog = document.createElement("dialog");
    dialog.className = "recovery-preview-dialog";
    dialog.setAttribute("aria-labelledby", "recovery-preview-title");
    dialog.setAttribute("aria-describedby", "recovery-preview-disclaimer");
    dialog.innerHTML =
      '<div class="recovery-preview-dialog-head"><h2 id="recovery-preview-title">Email preview</h2><button type="button" class="recovery-preview-close">Close preview</button></div>' +
      '<p id="recovery-preview-disclaimer" class="recovery-preview-disclaimer">Saved to the local outbox. No email was sent. The return link works in this local preview.</p>' +
      '<dl class="recovery-preview-envelope"><dt>To</dt><dd class="recovery-preview-recipient"></dd><dt>Subject</dt><dd class="recovery-preview-subject"></dd></dl>' +
      '<div class="recovery-preview-message"></div><p><a class="recovery-preview-return">Return to your cart</a></p>';
    document.body.appendChild(dialog);
    let pending = false, generation = 0;
    function paintAction() {
      const hasEmail = email.value.trim().length > 0;
      action.type = hasEmail ? "submit" : "button";
      action.setAttribute("aria-label", hasEmail ? "Send cart" : "Close cart email");
      action.innerHTML = hasEmail ? arrow : closeIcon;
      action.disabled = pending; email.disabled = pending;
    }
    function clearError() { error.hidden = true; error.textContent = ""; email.removeAttribute("aria-invalid"); }
    function collapse(focusToggle = false) {
      generation += 1; pending = false;
      toggle.hidden = false; toggle.setAttribute("aria-expanded", "false"); form.hidden = true;
      email.value = ""; status.textContent = ""; show.hidden = true;
      dialog.querySelector(".recovery-preview-recipient").textContent = "";
      dialog.querySelector(".recovery-preview-message").textContent = "";
      dialog.querySelector(".recovery-preview-return").removeAttribute("href");
      clearError(); paintAction();
      if (focusToggle && !host.hidden) toggle.focus();
    }
    toggle.addEventListener("click", function () {
      toggle.hidden = true; form.hidden = false; toggle.setAttribute("aria-expanded", "true"); paintAction(); email.focus();
    });
    action.addEventListener("click", function () { if (!email.value.trim() && !pending) collapse(true); });
    email.addEventListener("input", function () { clearError(); status.textContent = ""; show.hidden = true; paintAction(); });
    email.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); collapse(true); }
    });
    form.addEventListener("submit", async function (event) {
      event.preventDefault(); event.stopPropagation();
      if (pending) return;
      if (!email.value.trim()) { collapse(true); return; }
      clearError();
      if (!email.validity.valid) {
        error.textContent = "Enter an email address, like name@example.com.";
        error.hidden = false; email.setAttribute("aria-invalid", "true"); email.focus(); return;
      }
      const recipient = email.value.trim(), requestGeneration = ++generation;
      pending = true; paintAction(); status.textContent = "Saving your cart email…"; show.hidden = true;
      try {
        const result = await recovery.emailCart(recipient);
        if (requestGeneration !== generation) return;
        const preview = result && result.preview;
        if (!result || result.ok !== true || result.status !== (local ? "queued_local" : "sent")) throw new Error("The server did not confirm your cart email. Please try again.");
        if (local && (!preview || typeof preview.subject !== "string" || typeof preview.text !== "string" || typeof preview.restoreUrl !== "string")) throw new Error("The server did not confirm your cart email. Please try again.");
        if (local) {
          const returnUrl = new URL(preview.restoreUrl, location.origin);
          if (returnUrl.origin !== location.origin || returnUrl.pathname !== "/store/" || !new URLSearchParams(returnUrl.hash.slice(1)).get("restore_cart")) throw new Error("The saved return link could not be verified.");
          dialog.querySelector(".recovery-preview-recipient").textContent = recipient;
          dialog.querySelector(".recovery-preview-subject").textContent = preview.subject;
          dialog.querySelector(".recovery-preview-message").textContent = preview.text.replace("Return to your cart: " + preview.restoreUrl, "Return to your cart using the link below.").replace(preview.restoreUrl, "Return to your cart using the link below.");
          dialog.querySelector(".recovery-preview-return").href = returnUrl.href;
          show.hidden = false;
        }
        email.value = ""; status.textContent = local ? "Cart email saved locally. No email was sent." : "Check your inbox for your cart.";
      } catch (failure) {
        if (requestGeneration === generation) { status.textContent = ""; error.textContent = failure.message || "Unable to save your cart email. Please try again."; error.hidden = false; }
      } finally { if (requestGeneration === generation) { pending = false; paintAction(); } }
    });
    show.addEventListener("click", function () { dialog.showModal(); });
    dialog.querySelector(".recovery-preview-close").addEventListener("click", function () { dialog.close(); });
    dialog.addEventListener("keydown", function (event) { if (event.key === "Escape") event.stopPropagation(); });
    dialog.addEventListener("close", function () { if (!host.hidden && !show.hidden) show.focus(); });
    function refresh() {
      const visible = drawer.classList.contains("is-open") && Boolean(items.querySelector(".cart-line"));
      if (!visible) {
        const restoreFocus = host.contains(document.activeElement) || dialog.contains(document.activeElement);
        if (dialog.open) dialog.close();
        collapse();
        if (restoreFocus) {
          const target = drawer.classList.contains("is-open") ? drawer.querySelector(".cart-close") : document.querySelector(".store-cart-btn");
          if (target) target.focus();
        }
      }
      host.hidden = !visible;
    }
    new MutationObserver(refresh).observe(items, { childList: true, subtree: true });
    new MutationObserver(refresh).observe(drawer, { attributes: true, attributeFilter: ["class"] });
    refresh();
  }

  async function restoreCart() {
    if (!recovery.hasRestore) return;
    const dialog = document.createElement("dialog");
    dialog.className = "recovery-preview-dialog";
    dialog.setAttribute("aria-labelledby", "recovery-restore-title");
    dialog.innerHTML = '<h2 id="recovery-restore-title">Your emailed cart</h2><p class="recovery-restore-note" role="status"></p>' +
      '<ul class="recovery-restore-lines"></ul><div class="recovery-restore-actions"><button class="recovery-preview-show recovery-restore-use" type="button">Use emailed cart</button>' +
      '<button class="recovery-preview-close recovery-restore-keep" type="button">Keep current cart</button></div>';
    document.body.appendChild(dialog);
    const note = dialog.querySelector(".recovery-restore-note"), use = dialog.querySelector(".recovery-restore-use"), keep = dialog.querySelector(".recovery-restore-keep");
    let saved = null, expected = "";
    keep.addEventListener("click", function () { recovery.keepCart(); dialog.close(); });
    use.addEventListener("click", function () {
      if (!saved) return;
      if (recovery.applyRestore(saved, expected)) dialog.close();
      else { expected = recovery.compareRestore(saved).signature; note.textContent = "Your current cart changed. Choose again which cart to keep."; }
    });
    try {
      const result = await recovery.restorePending();
      if (!result || result.ok !== true || !Array.isArray(result.cart)) throw new Error("This cart link is no longer available.");
      saved = result.cart;
      const current = recovery.compareRestore(saved); expected = current.signature;
      const removed = Array.isArray(result.removed) && result.removed.length > 0;
      if (saved.length && !current.conflict && recovery.applyRestore(saved, expected)) {
        if (!removed) return;
        use.hidden = true; keep.textContent = "Back to cart";
        note.textContent = "Your saved cart was restored. Some items are no longer available and were left out.";
        dialog.showModal(); return;
      }
      if (!saved.length) { use.hidden = true; note.textContent = "The items in this saved cart are no longer available. Your current cart has been kept."; }
      else {
        note.textContent = "Your current cart has different items. Choose which cart to keep." + (removed ? " Some saved items are no longer available and were left out." : "");
        const list = dialog.querySelector(".recovery-restore-lines");
        saved.forEach(function (line) {
          const product = (window.STORE_PRODUCTS || []).find((item) => item.id === line.id);
          const variant = product && (product.variants || []).find((item) => item.id === line.build);
          const item = document.createElement("li");
          item.textContent = (product ? product.title : line.id) + (variant ? " (" + variant.label + ")" : "") + " × " + line.qty;
          list.appendChild(item);
        });
      }
      dialog.showModal();
    } catch (failure) { use.hidden = true; keep.textContent = "Back to cart"; note.textContent = failure.message || "This cart link could not be restored. Please try again."; dialog.showModal(); }
    dialog.addEventListener("keydown", function (event) { if (event.key === "Escape") event.stopPropagation(); });
  }

  function boot() {
    setupNewsletter();
    const drawer = document.querySelector(".cart-drawer");
    if (drawer) { setup(drawer); void restoreCart(); return; }
    const observer = new MutationObserver(function () {
      const next = document.querySelector(".cart-drawer");
      if (next) { observer.disconnect(); setup(next); void restoreCart(); }
    });
    observer.observe(document.body, { childList: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
