import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const corners = readFileSync('docs/assets/js/corners.js', 'utf8');

test('squircle geometry is measured in layout space so hover transforms are not applied twice', () => {
  assert.match(corners, /var size = L\.getLayoutSize\(el\)/);
  assert.doesNotMatch(corners, /var rect = el\.getBoundingClientRect\(\)/);
});
