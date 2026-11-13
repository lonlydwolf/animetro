import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lock } from '../web/js/lock.js';

const later = (v, ms = 10) => new Promise(r => setTimeout(() => r(v), ms));

test('a second call for a busy key is dropped (Audit N3)', async () => {
  const once = lock(), runs = [];
  const [a, b] = await Promise.all([once(1, () => (runs.push('a'), later('a'))), once(1, () => (runs.push('b'), later('b')))]);
  assert.deepEqual(runs, ['a']);
  assert.equal(a, 'a');
  assert.equal(b, undefined);
});

test('different keys run side by side', async () => {
  const once = lock();
  assert.deepEqual(await Promise.all([once(1, () => later(1)), once(2, () => later(2))]), [1, 2]);
});

test('the key frees up after the job, even when it fails', async () => {
  const once = lock();
  await assert.rejects(once(1, async () => { throw new Error('nope'); }), /nope/);
  assert.equal(await once(1, () => later('again')), 'again');
});

test('locks are independent', async () => {
  const one = lock(), two = lock();
  assert.deepEqual(await Promise.all([one(1, () => later('x')), two(1, () => later('y'))]), ['x', 'y']);
});
