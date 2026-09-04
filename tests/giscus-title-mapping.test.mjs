import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const browserTitle = readFileSync('overrides/partials/browser-title.html', 'utf8');
const commentsTemplate = readFileSync('overrides/comments.html', 'utf8');

test('browser title branding stays decoupled from existing giscus discussions', () => {
  assert.match(browserTitle, /<title>THEODORE\.NET<\/title>/);
  assert.match(browserTitle, / - THEODORE\.NET<\/title>/);

  assert.match(commentsTemplate, /"data-mapping": "og:title"/);
  assert.match(
    commentsTemplate,
    /<meta property="og:title" content="\{\{ page_title \}\} - Teddy Warner">/,
  );
  assert.doesNotMatch(commentsTemplate, /"data-mapping": "title"/);
});
