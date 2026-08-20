(function () {
  'use strict';

  var ROOT = '/assets/avian-stamps/';
  var STYLES = [
    'stamps.css',
    'stamp-batch-root.css',
    'stamp-batch-a.css',
    'stamp-batch-b.css',
    'stamp-batch-c.css',
    'embed.css'
  ];
  var SCRIPTS = [
    'stamps.js',
    'stamp-batch-root.js',
    'stamp-batch-a.js',
    'stamp-batch-b.js',
    'stamp-batch-c.js'
  ];
  var runtimePromise = null;

  var familyBirds = [
    ['Hummingbirds', 'Trochilidae', 'Calypte anna', "Anna's Hummingbird", 7, 'calypte-anna.webp'],
    ['Crows & Jays', 'Corvidae', 'Corvus brachyrhynchos', 'American Crow', 17, 'corvus-brachyrhynchos.webp'],
    ['Herons', 'Ardeidae', 'Ardea herodias', 'Great Blue Heron', 21, 'ardea-herodias.webp'],
    ['Waterfowl', 'Anatidae', 'Anas platyrhynchos', 'Mallard', 18, 'anas-platyrhynchos.webp'],
    ['Owls', 'Strigidae', 'Bubo virginianus', 'Great Horned Owl', 23, 'bubo-virginianus.webp'],
    ['Hawks', 'Accipitridae', 'Buteo jamaicensis', 'Red-tailed Hawk', 22, 'buteo-jamaicensis.webp'],
    ['Gulls', 'Laridae', 'Larus occidentalis', 'Western Gull', 6, 'larus-occidentalis.webp'],
    ['Sparrows', 'Passerellidae', 'Zonotrichia leucophrys', 'White-crowned Sparrow', 1, 'zonotrichia-leucophrys.webp'],
    ['Finches', 'Fringillidae', 'Haemorhous mexicanus', 'House Finch', 10, 'haemorhous-mexicanus.webp'],
    ['Doves & Pigeons', 'Columbidae', 'Zenaida macroura', 'Mourning Dove', 8, 'zenaida-macroura.webp'],
    ['Thrushes', 'Turdidae', 'Turdus migratorius', 'American Robin', 12, 'turdus-migratorius.webp'],
    ['Flycatchers', 'Tyrannidae', 'Sayornis nigricans', 'Black Phoebe', 13, 'sayornis-nigricans.webp'],
    ['Mockingbirds & Thrashers', 'Mimidae', 'Mimus polyglottos', 'Northern Mockingbird', 16, 'mimus-polyglottos.webp'],
    ['Waxwings', 'Bombycillidae', 'Bombycilla cedrorum', 'Cedar Waxwing', 19, 'bombycilla-cedrorum.webp'],
    ['Blackbirds & Orioles', 'Icteridae', 'Agelaius phoeniceus', 'Red-winged Blackbird', 4, 'agelaius-phoeniceus.webp'],
    ['Chickadees & Titmice', 'Paridae', 'Baeolophus inornatus', 'Oak Titmouse', 3, 'baeolophus-inornatus.webp'],
    ['Warblers & Vireos', 'Parulidae', 'Setophaga petechia', 'Yellow Warbler', 24, 'setophaga-petechia.webp']
  ];

  var hummingbirds = [
    ['Hummingbirds', 'Trochilidae', 'Calypte anna', "Anna's Hummingbird", 7, 'calypte-anna.webp'],
    ['Hummingbirds', 'Trochilidae', 'Archilochus alexandri', 'Black-chinned Hummingbird', 14, 'archilochus-alexandri.webp'],
    ['Hummingbirds', 'Trochilidae', 'Selasphorus sasin', "Allen's Hummingbird", 31, 'selasphorus-sasin.webp']
  ];

  function loadStyle(name) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('link[data-avian-stamps-style="' + name + '"]');
      if (existing) {
        if (existing.dataset.loaded === 'true' || existing.sheet) resolve();
        else {
          existing.addEventListener('load', resolve, { once: true });
          existing.addEventListener('error', reject, { once: true });
        }
        return;
      }

      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = ROOT + name;
      link.dataset.avianStampsStyle = name;
      link.addEventListener('load', function () {
        link.dataset.loaded = 'true';
        resolve();
      }, { once: true });
      link.addEventListener('error', reject, { once: true });
      document.head.appendChild(link);
    });
  }

  function loadScript(name) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-avian-stamps-script="' + name + '"]');
      if (existing) {
        if (existing.dataset.loaded === 'true') resolve();
        else {
          existing.addEventListener('load', resolve, { once: true });
          existing.addEventListener('error', reject, { once: true });
        }
        return;
      }

      var script = document.createElement('script');
      script.src = ROOT + name;
      script.async = false;
      script.dataset.avianStampsScript = name;
      script.addEventListener('load', function () {
        script.dataset.loaded = 'true';
        resolve();
      }, { once: true });
      script.addEventListener('error', reject, { once: true });
      document.head.appendChild(script);
    });
  }

  function loadRuntime() {
    if (runtimePromise) return runtimePromise;
    runtimePromise = Promise.all(STYLES.map(loadStyle)).then(function () {
      return SCRIPTS.reduce(function (ready, name) {
        return ready.then(function () { return loadScript(name); });
      }, Promise.resolve());
    }).then(function () {
      if (!window.STAMPS || !window.FX) throw new Error('stamp runtime unavailable');
    });
    return runtimePromise;
  }

  function runtimePaths(markup) {
    return markup
      .replace(/\.\/assets\/stamp\//g, ROOT + 'assets/stamp/')
      .replace(/\.\/avian\/assets\/references\//g, ROOT + 'assets/references/')
      .replace(/paper-texture-grey\.png/g, 'paper-texture-grey.webp')
      .replace(/sparrow-blossom-(single|pair)-v2\.png/g, 'sparrow-blossom-$1-v2.webp')
      .replace('<div class="stamp-fit"', '<div class="stamp-fit" aria-hidden="true"');
  }

  function stampSize(cell) {
    var fit = cell.querySelector('.stamp-fit');
    if (!fit) return null;
    return {
      fit: fit,
      width: fit.offsetWidth || 188,
      height: fit.offsetHeight || 236
    };
  }

  /* Keep the display rhythm identical to the Atlas: the family, rather than
     the individual bird, owns a small deterministic size adjustment. */
  function familyScale(fit, mobile) {
    var family = (fit && fit.dataset && fit.dataset.family) || '';
    var hash = 2166136261;
    for (var i = 0; i < family.length; i += 1) {
      hash ^= family.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    var levels = mobile ? [.97, .99, 1.01, 1.03] : [.97, .99, 1.01, 1.03];
    return levels[(hash >>> 0) % levels.length];
  }

  function lowerBandGap(items, available, bottom) {
    var bandTop = bottom - 154;
    var intervals = items.filter(function (item) {
      return item.y + item.height > bandTop;
    }).map(function (item) {
      return [Math.max(0, item.x), Math.min(available, item.x + item.width)];
    }).sort(function (a, b) { return a[0] - b[0]; });
    if (!intervals.length) return available;
    var cursor = 0;
    var widest = 0;
    intervals.forEach(function (interval) {
      widest = Math.max(widest, interval[0] - cursor);
      cursor = Math.max(cursor, interval[1]);
    });
    return Math.max(widest, available - cursor);
  }

  /* The production Atlas closes the last shelf with a bounded second pass.
     Repack only the deepest issues against the locked upper wall and keep the
     result when it genuinely shortens the sheet (or closes a white river). */
  function compactStampTail(placements, available, gap) {
    if (placements.length < 7) return;
    var count = Math.min(14, Math.max(8, Math.ceil(placements.length * .56)));
    var tail = placements.slice().sort(function (a, b) {
      return (b.y + b.height) - (a.y + a.height);
    }).slice(0, count);
    var tailSet = new Set(tail);
    var locked = placements.filter(function (item) { return !tailSet.has(item); });
    var originalBottom = placements.reduce(function (value, item) {
      return Math.max(value, item.y + item.height);
    }, 0);
    var originalGap = lowerBandGap(placements, available, originalBottom);

    function placeOrder(order) {
      var placed = locked.map(function (item) {
        return { source: item, x: item.x, y: item.y, width: item.width, height: item.height };
      });
      order.forEach(function (item) {
        var best = null;
        for (var x = gap / 2; x <= available - item.width - gap / 2 + .01; x += 1) {
          var blockers = placed.filter(function (other) {
            return x < other.x + other.width + gap &&
              x + item.width + gap > other.x;
          }).sort(function (a, b) { return a.y - b.y; });
          var y = gap / 2;
          for (var i = 0; i < blockers.length; i += 1) {
            var blocker = blockers[i];
            if (y + item.height + gap <= blocker.y) break;
            y = Math.max(y, blocker.y + blocker.height + gap);
          }
          if (!best || y < best.y ||
              (Math.abs(y - best.y) <= 1 && Math.abs(x - item.x) < Math.abs(best.x - item.x))) {
            best = { x: x, y: y };
          }
        }
        placed.push({
          source: item,
          x: best.x,
          y: best.y,
          width: item.width,
          height: item.height
        });
      });
      var bottom = placed.reduce(function (value, item) {
        return Math.max(value, item.y + item.height);
      }, 0);
      return {
        bottom: bottom,
        lowerGap: lowerBandGap(placed, available, bottom),
        placed: placed
      };
    }

    var base = tail.slice().sort(function (a, b) { return a.order - b.order; });
    var candidates = [
      base,
      tail.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; }),
      tail.slice().sort(function (a, b) { return b.height - a.height || a.order - b.order; }),
      tail.slice().sort(function (a, b) { return b.width - a.width || a.order - b.order; }),
      tail.slice().sort(function (a, b) { return a.height - b.height || a.order - b.order; }),
      tail.slice().sort(function (a, b) { return a.width - b.width || a.order - b.order; }),
      tail.slice().sort(function (a, b) {
        return (b.width * b.height) - (a.width * a.height) || a.order - b.order;
      })
    ];
    for (var shift = 1; shift < base.length; shift += 1) {
      candidates.push(base.slice(shift).concat(base.slice(0, shift)));
    }
    for (var swap = 0; swap < base.length - 1; swap += 1) {
      var adjacent = base.slice();
      var held = adjacent[swap];
      adjacent[swap] = adjacent[swap + 1];
      adjacent[swap + 1] = held;
      candidates.push(adjacent);
    }

    var bestResult = null;
    candidates.forEach(function (candidate) {
      var result = placeOrder(candidate);
      if (!bestResult || result.bottom < bestResult.bottom - 1 ||
          (Math.abs(result.bottom - bestResult.bottom) <= 1 &&
           result.lowerGap < bestResult.lowerGap)) bestResult = result;
    });
    if (!bestResult || bestResult.bottom > originalBottom + 1 ||
        (Math.abs(bestResult.bottom - originalBottom) <= 1 &&
         bestResult.lowerGap >= originalGap - 1)) return;
    bestResult.placed.forEach(function (placed) {
      if (!tailSet.has(placed.source)) return;
      placed.source.x = placed.x;
      placed.source.y = placed.y;
    });
  }

  /* On phones, center each vertically disconnected shelf independently. This
     is the same finishing pass used by the live Atlas and avoids a narrow row
     reading as a left-pinned island beneath a full-width one. */
  function centerMobileSlabs(placements, available, snap) {
    var ordered = placements.slice().sort(function (a, b) {
      return a.y - b.y || a.x - b.x || a.order - b.order;
    });
    var slabs = [];
    var slab = null;
    ordered.forEach(function (item) {
      var bottom = item.y + item.height;
      if (!slab || item.y >= slab.bottom) {
        slab = { bottom: bottom, items: [item] };
        slabs.push(slab);
        return;
      }
      slab.items.push(item);
      slab.bottom = Math.max(slab.bottom, bottom);
    });
    slabs.forEach(function (group) {
      var minX = Math.min.apply(null, group.items.map(function (item) { return item.x; }));
      var maxX = Math.max.apply(null, group.items.map(function (item) { return item.x + item.width; }));
      var offset = (available - (maxX - minX)) / 2 - minX;
      offset = Math.round(offset / snap) * snap;
      offset = Math.max(-minX, Math.min(available - maxX, offset));
      if (Math.abs(offset) < snap / 2) return;
      group.items.forEach(function (item) { item.x += offset; });
    });
  }

  /* Faithful, article-sized adaptation of the Atlas skyline packer. Stamps
     retain their authored issue boxes and real paper seams; a four-issue
     look-ahead fills the valleys between portrait and landscape formats. */
  function packStampGrid(root) {
    var grid = root.querySelector('.avian-stamp-grid');
    if (!grid) return false;

    var available = Math.floor(grid.getBoundingClientRect().width || grid.clientWidth);
    if (available < 40) return true;
    var viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1280;
    var mobile = viewportWidth <= 700;
    var narrowWall = viewportWidth < 900;
    var baseScale = Math.max(.8, Math.min(1,
      .8 + Math.max(0, viewportWidth - 700) / 1500));
    var gap = parseFloat(getComputedStyle(grid).getPropertyValue('--pack-gap'));
    if (!isFinite(gap) || gap < 0) gap = mobile ? 5 : 5.5;
    var cells = Array.prototype.slice.call(grid.querySelectorAll('.avian-stamp-cell'));
    var items = [];

    cells.forEach(function (cell, order) {
      var natural = stampSize(cell);
      if (!natural) return;
      var scale = Math.min(
        baseScale * familyScale(natural.fit, mobile),
        (available - gap * 2) / (natural.width + 4)
      );
      items.push({
        cell: cell,
        fit: natural.fit,
        order: order,
        scale: scale,
        width: natural.width * scale,
        height: natural.height * scale
      });
    });

    var signature = [available, viewportWidth, window.devicePixelRatio || 1].concat(items.map(function (item) {
      return Math.round(item.width) + 'x' + Math.round(item.height);
    })).join(':');
    if (grid.dataset.packSignature === signature && grid.classList.contains('is-packed')) return true;
    grid.dataset.packSignature = signature;

    grid.classList.remove('is-packed');
    grid.style.removeProperty('height');
    var placed = [];
    var columns = Math.max(1, available);
    var skyline = new Array(columns).fill(0);
    var pending = items.map(function (item) {
      item.span = Math.min(columns, Math.max(1, Math.ceil(Math.min(available, item.width + gap))));
      return item;
    });
    while (pending.length) {
      var choice = null;
      pending.slice(0, 4).forEach(function (item, itemIndex) {
        for (var start = 0; start <= columns - item.span; start += 1) {
          var y = 0;
          for (var c = start; c < start + item.span; c += 1) y = Math.max(y, skyline[c]);
          var waste = 0;
          for (var w = start; w < start + item.span; w += 1) waste += y - skyline[w];
          var candidate = {
            item: item,
            itemIndex: itemIndex,
            start: start,
            y: y,
            waste: waste,
            order: item.order
          };
          var beats = !choice || candidate.y < choice.y;
          if (!beats && choice && candidate.y === choice.y) {
            if (narrowWall) {
              beats = candidate.order < choice.order ||
                (candidate.order === choice.order && candidate.start < choice.start);
            } else {
              beats = candidate.waste < choice.waste ||
                (candidate.waste === choice.waste && candidate.order < choice.order);
            }
          }
          if (beats) choice = candidate;
        }
      });
      var item = choice.item;
      pending.splice(choice.itemIndex, 1);
      var left = Math.round((choice.start + gap / 2) * 2) / 2;
      var top = Math.round((choice.y + gap / 2) * 2) / 2;
      placed.push({
        cell: item.cell,
        fit: item.fit,
        scale: item.scale,
        x: left,
        y: top,
        width: item.width,
        height: item.height,
        order: item.order
      });
      var nextY = Math.ceil(choice.y + item.height + gap);
      for (var u = choice.start; u < choice.start + item.span; u += 1) skyline[u] = nextY;
    }

    compactStampTail(placed, available, gap);

    var snap = 1 / Math.max(1, window.devicePixelRatio || 1);
    placed.forEach(function (item) {
      item.x = Math.round(item.x / snap) * snap;
      item.y = Math.round(item.y / snap) * snap;
    });
    if (mobile) {
      centerMobileSlabs(placed, available, snap);
    } else {
      var minX = Math.min.apply(null, placed.map(function (item) { return item.x; }));
      var maxX = Math.max.apply(null, placed.map(function (item) { return item.x + item.width; }));
      var offset = Math.max(0, (available - (maxX - minX)) / 2 - minX);
      offset = Math.round(offset / snap) * snap;
      if (offset) placed.forEach(function (item) { item.x += offset; });
    }

    var bottom = 0;
    placed.forEach(function (item) {
      item.cell.style.width = item.width.toFixed(2) + 'px';
      item.cell.style.height = item.height.toFixed(2) + 'px';
      item.cell.style.left = item.x.toFixed(2) + 'px';
      item.cell.style.top = item.y.toFixed(2) + 'px';
      item.fit.style.setProperty('--fit-scale', Math.max(.2, item.scale).toFixed(4));
      bottom = Math.max(bottom, item.y + item.height);
    });
    grid.classList.add('is-packed');
    grid.style.height = Math.ceil(bottom + gap / 2) + 'px';
    return true;
  }

  function fitStamps(root) {
    if (!packStampGrid(root)) {
      root.querySelectorAll('.avian-stamp-cell').forEach(function (cell) {
        var natural = stampSize(cell);
        if (!natural) return;
        var scale = Math.min(1, (cell.clientWidth - 4) / natural.width, (cell.clientHeight - 4) / natural.height);
        natural.fit.style.setProperty('--fit-scale', Math.max(.2, scale).toFixed(4));
      });
    }
    if (window.STAMPS) window.STAMPS.syncFringe(root);
  }

  function scheduleFit(root) {
    if (root._avianStampFitFrame) cancelAnimationFrame(root._avianStampFitFrame);
    root._avianStampFitFrame = requestAnimationFrame(function () {
      root._avianStampFitFrame = 0;
      fitStamps(root);
    });
  }

  function render(root, entries, gridClass) {
    if (root.dataset.mounted === 'true') return;
    root.dataset.mounted = 'true';
    root.dataset.state = 'loading';

    loadRuntime().then(function () {
      var grid = document.createElement('div');
      grid.className = gridClass;
      entries.forEach(function (entry) {
        var bird = {
          family: entry[0],
          latin: entry[1],
          sci: entry[2],
          com: entry[3],
          index: entry[4]
        };
        var cell = document.createElement('div');
        cell.className = 'avian-stamp-cell';
        cell.setAttribute('role', 'img');
        cell.setAttribute('aria-label', entry[0] + ' stamp: ' + entry[3]);
        cell.innerHTML = '<div class="stamp-stage">' + runtimePaths(
          window.STAMPS.markup(bird, ROOT + 'illustrations/' + entry[5])
        ) + '</div>';
        grid.appendChild(cell);
      });

      root.replaceChildren(grid);
      root.dataset.state = 'ready';
      root.setAttribute('aria-busy', 'false');
      requestAnimationFrame(function () {
        fitStamps(root);
        window.FX.run(root);
      });
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () {
          scheduleFit(root);
          window.FX.run(root);
        });
      }
      if ('ResizeObserver' in window) {
        var observer = new ResizeObserver(function () {
          scheduleFit(root);
        });
        observer.observe(root);
        root._avianStampObserver = observer;
      }
    }).catch(function () {
      root.dataset.state = 'error';
      root.setAttribute('aria-busy', 'false');
    });
  }

  function observe(root, entries, gridClass) {
    if (root.dataset.mounted === 'true' || root.dataset.observed === 'true') return;
    root.dataset.observed = 'true';
    if (!('IntersectionObserver' in window)) {
      render(root, entries, gridClass);
      return;
    }
    var observer = new IntersectionObserver(function (records) {
      if (!records.some(function (record) { return record.isIntersecting; })) return;
      observer.disconnect();
      render(root, entries, gridClass);
    }, { rootMargin: '600px 0px' });
    observer.observe(root);
  }

  function init() {
    if (document.querySelector('.avian-name-compare')) loadStyle('embed.css');
    document.querySelectorAll('[data-avian-stamp-grid]').forEach(function (root) {
      observe(root, familyBirds, 'avian-stamp-grid');
    });
    document.querySelectorAll('[data-avian-hummingbird-row]').forEach(function (root) {
      observe(root, hummingbirds, 'avian-hummingbird-grid');
    });
  }

  if (typeof document$ !== 'undefined') document$.subscribe(init);
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}());
