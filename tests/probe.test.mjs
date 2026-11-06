import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countPages } from '../web/js/probe.js';

// A fake API with exactly n matches; counts how many requests the search makes.
const fake = n => {
  const api = { calls: 0, probe: async positions => { api.calls++; assert.ok(positions.length <= 30 || api.calls === 1); return positions.filter(p => p <= n); } };
  return api;
};

test('the count is exact for every small total, including non-powers of two', async () => {
  for (let n = 0; n <= 70; n++) assert.equal(await countPages(fake(n).probe), n, `total ${n}`);
});

test('the count is exact for large totals within a few requests', async () => {
  for (const n of [1000, 2047, 2049, 3333, 4999]) {
    const api = fake(n);
    assert.equal(await countPages(api.probe), n, `total ${n}`);
    assert.ok(api.calls <= 5, `${api.calls} requests for ${n}`);
  }
});

test('AniList stops paging at 5000', async () => {
  assert.equal(await countPages(fake(12000).probe), 5000);
});
