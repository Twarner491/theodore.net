import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../docs/assets/js/footer-social.js', import.meta.url), 'utf8');

function page() {
  let clock = new Date(2026, 11, 31, 23, 59, 59);
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.getTime()])); }
  }
  const custom = { textContent: 'Copyright © 2025 Teddy Warner' };
  const shared = { textContent: '\n  Copyright © 2025 Teddy Warner\n' };
  const legalNotice = { textContent: 'Copyright (c) 2026 Teddy Warner' };
  const events = {};
  const windowEvents = {};
  const timers = [];
  let navigation;
  const document = {
    readyState: 'loading',
    hidden: false,
    querySelectorAll(selector) {
      if (selector === '.copyright, .md-copyright__highlight a') return [custom, shared];
      if (selector === 'a[href="mailto:teddy@warner.net"]') return [];
      throw new Error('Unexpected selector: ' + selector);
    },
    addEventListener(name, callback) { events[name] = callback; },
  };
  vm.runInNewContext(source, {
    document,
    window: { addEventListener(name, callback) { windowEvents[name] = callback; } },
    Date: Clock,
    setTimeout(callback, delay) { timers.push({ callback, delay }); },
    setInterval(callback) { navigation = callback; return 1; },
    clearInterval() {},
    document$: { subscribe(callback) { events.navigation = callback; } },
  });
  navigation();
  return { custom, shared, legalNotice, document, events, windowEvents, timers,
    setClock(value) { clock = value; } };
}

test('cached footer years update on load without changing a legal notice', () => {
  const p = page();
  p.events.DOMContentLoaded();
  assert.equal(p.custom.textContent, 'Copyright © 2026 Teddy Warner');
  assert.equal(p.shared.textContent.trim(), 'Copyright © 2026 Teddy Warner');
  assert.equal(p.legalNotice.textContent, 'Copyright (c) 2026 Teddy Warner');
});

test('an open page advances from 2026 to 2027 at local New Year', () => {
  const p = page();
  assert.equal(p.timers[0].delay, 2000);
  p.setClock(new Date(2027, 0, 1, 0, 0, 1));
  p.timers[0].callback();
  assert.equal(p.custom.textContent, 'Copyright © 2027 Teddy Warner');
  assert.equal(p.shared.textContent.trim(), 'Copyright © 2027 Teddy Warner');
  assert.equal(p.legalNotice.textContent, 'Copyright (c) 2026 Teddy Warner');
});

test('restored and instant-navigation pages refresh their footer years', () => {
  const p = page();
  p.setClock(new Date(2027, 0, 2));
  p.events.visibilitychange();
  assert.equal(p.custom.textContent, 'Copyright © 2027 Teddy Warner');
  p.setClock(new Date(2028, 0, 2));
  p.windowEvents.pageshow();
  assert.equal(p.shared.textContent.trim(), 'Copyright © 2028 Teddy Warner');
  p.custom.textContent = 'Copyright © 2026 Teddy Warner';
  p.events.navigation();
  assert.equal(p.custom.textContent, 'Copyright © 2028 Teddy Warner');
});
