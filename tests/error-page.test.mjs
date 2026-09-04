import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const template = readFileSync('overrides/404.html', 'utf8');
const styles = readFileSync('docs/assets/css/404.css', 'utf8');

test('404 page is only a custom, theme-aware handwritten SVG', () => {
  assert.match(template, /<svg class="error-mark"/);
  assert.match(template, /Readable redraws of the shirt's individual marker gestures/);
  assert.match(template, /class="error-word error-word--error"/);
  assert.match(template, /class="error-word error-word--404"/);
  assert.match(template, /class="error-word error-word--page"/);
  assert.match(template, /class="error-word error-word--found"/);
  assert.match(template, /class="error-strokes error-strokes--not"/);
  assert.match(template, /<filter id="paper-ink"/);
  assert.doesNotMatch(template, /<text\b/);
  assert.doesNotMatch(template, /home in|error-countdown|error-easter-egg/);
  assert.match(styles, /color: var\(--md-default-fg-color\)/);
  assert.match(styles, /height: calc\(100svh - 200px\)/);
  assert.match(styles, /grid-template-rows: minmax\(0, 1fr\) auto/);
  assert.match(styles, /filter: url\("#paper-ink"\)/);
  assert.match(styles, /\.error-page-content > \.footer/);
  assert.match(styles, /margin-top: -1rem/);
});

test('404 page redirects automatically without visible redirect UI', () => {
  assert.match(template, /window\.setTimeout/);
  assert.match(template, /window\.location\.replace\("\/"\)/);
  assert.match(template, /}, 8000\)/);
});

test('404 page reuses the standard in-content footer', () => {
  assert.match(template, /href="\/assets\/css\/header\.css"/);
  assert.match(template, /class="content-container error-page-content"/);
  assert.match(template, /<section class="footer visible">/);
  assert.match(template, /Copyright © 2026 Teddy Warner/);
  assert.match(template, /href="\/privacy"/);
  assert.match(template, /href="\/press"/);
  assert.match(template, /href="\/store"/);
});

test('the old 404 photo is removed', () => {
  assert.doesNotMatch(template, /assets\/images\/index\/404\.jpg/);
  assert.equal(existsSync('docs/assets/images/index/404.jpg'), false);
});
