// Figure grid height-matching: scales images in each row to share the same
// height, with widths proportional to their aspect ratios. No cropping.
(function() {
  // Size a row of images so they all share the same height.
  // Each image gets a width proportional to its aspect ratio.
  function sizeRow(imgs, gap) {
    var ratios = imgs.map(function(img) {
      return (img.naturalWidth && img.naturalHeight)
        ? img.naturalWidth / img.naturalHeight : 1;
    });
    var totalRatio = ratios.reduce(function(a, b) { return a + b; }, 0);
    var totalGap = gap * (imgs.length - 1);

    imgs.forEach(function(img, i) {
      var pct = (ratios[i] / totalRatio) * 100;
      img.style.width = 'calc(' + pct + '% - ' + (totalGap * (1 - ratios[i] / totalRatio)) + 'px)';
      img.style.height = 'auto';
      img.style.minWidth = '0';
      img.style.flexGrow = '0';
      img.style.flexShrink = '0';
      img.style.flexBasis = 'auto';
    });
  }

  function initGrids() {
    // Get gap in px (0.5em default)
    var gapPx = 8; // ~0.5em at 16px base

    document.querySelectorAll('.figure-grid').forEach(function(grid) {
      if (grid.dataset.gridInit) return;
      grid.dataset.gridInit = '1';

      var imgs = Array.from(grid.querySelectorAll('img'));
      var loaded = 0;
      var total = imgs.length;
      if (!total) return;

      // Compute actual gap
      var cs = window.getComputedStyle(grid);
      var g = parseFloat(cs.gap || cs.gridGap || cs.columnGap || '8');
      if (!isNaN(g)) gapPx = g;

      function applyLayout() {
        if (grid.classList.contains('grid-2x2')) {
          // Process in pairs: each pair is one row
          for (var i = 0; i < imgs.length; i += 2) {
            var row = imgs.slice(i, i + 2);
            if (row.length === 2) sizeRow(row, gapPx);
            else if (row.length === 1) {
              row[0].style.width = '100%';
              row[0].style.height = 'auto';
            }
          }
        } else if (grid.classList.contains('grid-2over1')) {
          // First two images share a row, last image spans full width
          if (imgs.length >= 2) {
            sizeRow(imgs.slice(0, 2), gapPx);
          }
          if (imgs.length >= 3) {
            imgs[imgs.length - 1].style.width = '100%';
            imgs[imgs.length - 1].style.height = 'auto';
            imgs[imgs.length - 1].style.flexBasis = '100%';
          }
        } else {
          // Single-row grids (2x1, 3x1, etc): all images in one row
          sizeRow(imgs, gapPx);
        }
      }

      imgs.forEach(function(img) {
        function check() {
          loaded++;
          if (loaded >= total) applyLayout();
        }
        if (img.complete && img.naturalWidth) check();
        else {
          img.addEventListener('load', check);
          img.addEventListener('error', check);
        }
      });
    });
  }

  // Run on initial load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGrids);
  } else {
    initGrids();
  }

  // Re-run on Material instant navigation (SPA page swaps)
  var sub = setInterval(function() {
    if (typeof document$ !== 'undefined') {
      clearInterval(sub);
      document$.subscribe(function() { initGrids(); });
    }
  }, 100);
})();
