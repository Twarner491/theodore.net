import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (path) => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

function paletteBootstrap(saved, dark, throws = false) {
  const inputs = ['default', 'slate'].map((scheme) => ({
    checked: false,
    nextElementSibling: { tagName: 'LABEL', hidden: true },
    getAttribute(name) {
      return {
        'data-md-color-scheme': scheme,
        'data-md-color-media': `(prefers-color-scheme: ${scheme === 'slate' ? 'dark' : 'light'})`,
        'data-md-color-primary': 'black',
        'data-md-color-accent': scheme === 'slate' ? 'white' : 'black',
      }[name];
    },
  }));
  const attributes = {};
  const source = read('overrides/partials/header-palette.html').match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(source, {
    document: { querySelectorAll: () => inputs, body: { setAttribute: (key, value) => { attributes[key] = value; } } },
    window: { matchMedia: (media) => ({ matches: media.includes(dark ? 'dark' : 'light') }) },
    __md_get: () => { if (throws) throw new Error('Storage blocked'); return saved; },
  });
  return { inputs, attributes };
}

test('palette is visible during parsing and honors a saved theme over the OS', () => {
  const { inputs, attributes } = paletteBootstrap({ color: { scheme: 'slate', media: '(prefers-color-scheme: dark)' } }, false);
  assert.equal(attributes['data-md-color-scheme'], 'slate');
  assert.equal(inputs[1].checked, true);
  assert.deepEqual(inputs.map((input) => input.nextElementSibling.hidden), [true, false]);
});

test('palette falls back to OS when storage is empty or blocked, including automatic mode', () => {
  for (const [saved, throws] of [[null, false], [null, true], [{ color: { scheme: 'default', media: '(prefers-color-scheme)' } }, false]]) {
    const { inputs, attributes } = paletteBootstrap(saved, true, throws);
    assert.equal(attributes['data-md-color-scheme'], 'slate');
    assert.equal(inputs.filter((input) => !input.nextElementSibling.hidden).length, 1);
  }
});

test('the initial header badge restores a saved cart before store bootstrap', () => {
  const source = read('overrides/partials/header-cart.html').match(/<script>([\s\S]*?)<\/script>/)[1];
  for (const [saved, expected] of [
    [[{ id: 'avian-mic', build: 'electronics-printed', qty: 2 }], 2],
    [[{ id: 'mic-mount', build: 'printed', qty: -1 }, null, { id: 'mic-mount', build: 'printed', qty: 'NaN' }], 0],
    ['malformed', 0],
  ]) {
    const badge = {};
    let hasItems;
    const button = { querySelector: () => badge, classList: { toggle: (name, value) => { hasItems = value; } } };
    vm.runInNewContext(source, {
      document: { currentScript: { previousElementSibling: button } },
      localStorage: { getItem: () => saved === 'malformed' ? '{' : JSON.stringify(saved) },
    });
    assert.equal(badge.textContent, String(expected));
    assert.equal(hasItems, expected > 0);
  }
});

class Element {
  constructor() {
    this.children = [];
    this.listeners = new Map();
    this.classes = new Set();
    this.classList = { add: (...items) => items.forEach((x) => this.classes.add(x)), remove: (...items) => items.forEach((x) => this.classes.delete(x)), contains: (x) => this.classes.has(x) };
    this.style = {};
    this.selectors = {};
    this.innerWrites = 0;
  }
  set innerHTML(value) { this.innerWrites++; }
  get isConnected() { return this.connectedRoot || !!this.parentNode?.isConnected; }
  addEventListener(name, listener) { const all = this.listeners.get(name) || []; all.push(listener); this.listeners.set(name, all); }
  setAttribute() {}
  removeAttribute() {}
  querySelector(selector) { return this.selectors[selector] || null; }
  appendChild(child) { if (child.parentNode) child.parentNode.removeChild(child); this.children.push(child); child.parentNode = this; return child; }
  removeChild(child) { this.children = this.children.filter((item) => item !== child); child.parentNode = null; }
}

function searchHarness() {
  const html = new Element(); html.connectedRoot = true;
  const documentListeners = new Map();
  const document = {
    readyState: 'loading', documentElement: html,
    createElement: () => new Element(),
    addEventListener(name, handler) { const all = documentListeners.get(name) || []; all.push(handler); documentListeners.set(name, all); },
    querySelector(selector) { return selector === '.tw-search[data-tw-search-static]' ? this.staticRoot : null; },
  };
  function navigate() {
    if (document.body) html.removeChild(document.body);
    document.body = html.appendChild(new Element());
    const root = document.body.appendChild(new Element());
    for (const selector of ['.tw-bar', '.tw-input', '.tw-hint', '.tw-hint-word', '.tw-clear', '.tw-icon', '.tw-close']) root.selectors[selector] = root.appendChild(new Element());
    root.selectors['.tw-icon'].disabled = true;
    document.staticRoot = root;
    return root;
  }
  navigate();
  const context = vm.createContext({
    document, window: { addEventListener() {}, requestIdleCallback: true },
    requestIdleCallback() {}, setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {},
  });
  const original = read('docs/assets/js/search.js');
  const source = original.replace(/\}\)\(\);\s*$/, 'globalThis.injectSearch = inject; })();');
  vm.runInContext(source, context);
  return { document, documentListeners, context, original, navigate };
}

test('search adopts the first-paint icon without replacing it or binding twice', () => {
  const h = searchHarness();
  const root = h.document.staticRoot;
  const icon = root.querySelector('.tw-icon');
  assert.equal(icon.disabled, false);
  assert.equal(root.innerWrites, 0, 'the static icon DOM must survive enhancement');
  assert.equal(h.document.body.children.length, 3, 'one root, one scrim, one results panel');
  const listenerCount = h.documentListeners.get('keydown').length;
  h.context.injectSearch();
  h.context.injectSearch();
  vm.runInContext(h.original, h.context);
  assert.equal(icon.listeners.get('click').length, 1);
  assert.equal(h.document.body.children.length, 3);
  assert.equal(h.documentListeners.get('keydown').length, listenerCount);
});

test('search rebuilds once after a body swap and adopts the new static icon', () => {
  const h = searchHarness();
  const oldRoot = h.document.staticRoot;
  const nextRoot = h.navigate();
  h.context.injectSearch();
  h.context.injectSearch();
  assert.equal(oldRoot.isConnected, false);
  assert.equal(nextRoot.innerWrites, 0);
  assert.equal(nextRoot.querySelector('.tw-icon').listeners.get('click').length, 1);
  assert.equal(h.document.body.children.length, 3);
});

test('header repeated initialization replaces its old scroll listener', () => {
  const listeners = new Set();
  const context = vm.createContext({
    window: { addEventListener: (name, fn) => { if (name === 'scroll') listeners.add(fn); }, removeEventListener: (name, fn) => listeners.delete(fn) },
    document: { readyState: 'complete' }, clearTimeout() {},
  });
  const source = read('docs/assets/js/header.js');
  vm.runInContext(source, context);
  vm.runInContext(source, context);
  context.initializeHeader();
  assert.equal(listeners.size, 1);
});
