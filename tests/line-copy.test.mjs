import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL(`../web/${f}`, import.meta.url), 'utf8');

test("the line page's empty state names a stops toggle that exists", () => {
  const labels = [...read('line.html').matchAll(/data-view="stops" data-value="\w+">([^<]+)</g)].map(m => m[1]);
  assert.deepEqual(labels, ['Express', 'Rapid', 'Local']);
  const named = [...read('js/line.js').matchAll(/Switch to (\w+)/g)].map(m => m[1]);
  assert.ok(named.length, 'the empty state suggests a toggle');
  for (const n of named) assert.ok(labels.includes(n), `"Switch to ${n}" matches a toggle label`);
});
