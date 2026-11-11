import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../docs/assets/js/store.js', import.meta.url), 'utf8');
const light = '/assets/images/example/photo.png';
const dark = '/assets/images/example/photoDARK.png';
const metadata = {
  [light]: { width: 1200, height: 800, sources: [{ url: '/assets/images/store/light-480.webp', width: 480, height: 320 }, { url: '/assets/images/store/light-1200.webp', width: 1200, height: 800 }] },
  [dark]: { width: 1200, height: 800, sources: [{ url: '/assets/images/store/dark-480.webp', width: 480, height: 320 }, { url: '/assets/images/store/dark-1200.webp', width: 1200, height: 800 }] },
};
function harness() {
  let scheme = 'default';
  const document = { readyState: 'loading', addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, body: { getAttribute() { return scheme; } }, documentElement: { getAttribute() { return null; } } };
  const context = vm.createContext({ document, window: { addEventListener() {} }, URLSearchParams, localStorage: { getItem() { return null; }, setItem() {} } });
  const instrumented = source.replace(/\}\)\(\);\s*$/, `
    globalThis.images = { productImageAttrs, carouselImageHTML, loadProductImage, goto, renderCarousel, swapProductImages,
      setup(data, darkImages) { IMAGE_SOURCES=data; DARK_IMAGES=darkImages; },
      setRoot(node, product) { root=node; P=product; slide=0; },
      setBackgrounds(data) { IMAGE_BG=data; }
    };
  })();`);
  vm.runInContext(instrumented, context);
  context.images.setup(metadata, { [light]: true });
  return { images: context.images, dark() { scheme = 'slate'; }, document };
}

function imageNode(url, active = false) {
  const attrs = new Map([['data-store-image', url], ['data-store-image-pending', 'true']]);
  const holder = { style: {}, classList: { contains(name) { return name === 'active' && active; } } };
  return { attrs, holder, getAttribute: (name) => attrs.get(name) || null, setAttribute: (name, value) => attrs.set(name, value), removeAttribute: (name) => attrs.delete(name), closest(selector) { return selector.includes('.pe-slide') ? holder : null; } };
}

test('responsive images retain the original identity, dimensions and conservative fallback', () => {
  const { images } = harness();
  const attrs = images.productImageAttrs(light, 'thumbnail');
  assert.match(attrs, /src="\/assets\/images\/store\/light-480.webp"/);
  assert.match(attrs, /light-480.webp 480w, .*light-1200.webp 1200w/);
  assert.match(attrs, /sizes="64px"/);
  assert.match(attrs, /width="1200" height="800"/);
  assert.match(attrs, /data-store-image="\/assets\/images\/example\/photo.png"/);
  assert.match(images.productImageAttrs('/other.png', 'thumbnail'), /src="\/other.png"/);
});

test('hidden carousel slides have no fetchable src or srcset until selected', () => {
  const { images } = harness();
  const hidden = images.carouselImageHTML(light, 1, false, 'Frame');
  assert.doesNotMatch(hidden, /\ssrc(?:set)?=/);
  assert.match(hidden, /data-store-image-pending/);
  const active = images.carouselImageHTML(light, 0, true, 'Frame');
  assert.match(active, /\ssrc=/);
  assert.match(active, /fetchpriority="high"/);
  const nodes = [imageNode(light), imageNode(light)];
  const slides = nodes.map((node) => ({ querySelector() { return node; }, classList: { add() {}, remove() {} } }));
  images.setRoot({ querySelectorAll(selector) { return selector === '.pe-slide' ? slides : []; } });
  images.goto(1);
  assert.equal(nodes[0].getAttribute('src'), null);
  assert.equal(nodes[1].getAttribute('src'), '/assets/images/store/light-480.webp');
  assert.equal(nodes[1].getAttribute('data-store-image-pending'), null);
});

test('optimized photo backgrounds follow encoded colors while retaining original lookup keys', () => {
  const { images } = harness();
  images.setup({ ...metadata, [light]: { ...metadata[light], background: '#f3f3f3' } }, { [light]: true });
  images.setBackgrounds({ [light]: '#f3f2f2' });
  assert.match(images.carouselImageHTML(light, 0, true, 'Frame'), /style="background:#f3f3f3"/);
});

test('a variant deep link starts on only its requested image instead of downloading photo one', () => {
  const { images } = harness();
  const slots = { '.pe-slides': {}, '.pe-dots': {}, '.pe-carousel': { classList: { toggle() {} } }, '.pe-frame': { addEventListener() {} } };
  images.setRoot({ querySelector: (selector) => slots[selector], querySelectorAll: () => [] }, { title: 'Frame', imageBase: '/assets/images/example/', images: ['first.png', 'photo.png'] });
  images.renderCarousel('photo.png');
  const markup = slots['.pe-slides'].innerHTML;
  assert.equal((markup.match(/\ssrc=/g) || []).length, 1);
  assert.doesNotMatch(markup, /src="\/assets\/images\/example\/first.png"/);
  assert.match(markup, /src="\/assets\/images\/store\/light-480.webp"/);
});

test('theme swaps preserve original background identity and do not load hidden gallery photos', () => {
  const h = harness();
  const active = imageNode(light, true), hidden = imageNode(light);
  h.images.setBackgrounds({ [dark]: '#222222' });
  h.document.querySelectorAll = () => [active, hidden];
  h.dark();
  h.images.swapProductImages();
  assert.equal(active.getAttribute('src'), '/assets/images/store/dark-480.webp');
  assert.equal(hidden.getAttribute('src'), null);
  assert.equal(active.holder.style.background, '#222222');
  assert.equal(hidden.holder.style.background, '#222222');
  h.images.loadProductImage(hidden);
  assert.equal(hidden.getAttribute('src'), '/assets/images/store/dark-480.webp');
});
