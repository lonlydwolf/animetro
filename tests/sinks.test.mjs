// cap() only changes case, so anything it returns still needs esc() before it goes into markup.
// Guards the anime page against a bare ${cap(...)} creeping back into a template (Audit: ranking context sink).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../web/js/anime.js', import.meta.url), 'utf8');

test('anime.js never puts cap() output into a template unescaped', () => {
  const bare = src.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /\$\{\s*cap\(|\|\|\s*cap\(/.test(l));
  assert.deepEqual(bare, []);
});

test('the ranking context is escaped', () => {
  assert.match(src, /esc\(cap\(r\.context\)\)/);
});
