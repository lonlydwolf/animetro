import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memo } from '../web/js/memo.js';

test('one call per key, however often it is asked', async () => {
  let calls = 0;
  const f = memo(async m => (calls++, `kitsu-${m.id}`), m => m.id);
  assert.equal(await f({ id: 1 }), 'kitsu-1');
  assert.equal(await f({ id: 1, title: 'same show' }), 'kitsu-1');
  assert.equal(await f({ id: 2 }), 'kitsu-2');
  assert.equal(calls, 2);
});

test('calls made while the first is running share it', async () => {
  let calls = 0;
  const f = memo(() => new Promise(r => setTimeout(() => r(++calls), 10)));
  assert.deepEqual(await Promise.all([f(1), f(1), f(1)]), [1, 1, 1]);
  assert.equal(calls, 1);
});

test('null is a real answer and is remembered', async () => {
  let calls = 0;
  const f = memo(async () => (calls++, null));
  assert.equal(await f(1), null);
  assert.equal(await f(1), null);
  assert.equal(calls, 1);
});

test('a failure is not remembered, so the next call retries', async () => {
  let calls = 0;
  const f = memo(async () => { if (++calls === 1) throw new Error('Kitsu 503'); return 'ok'; });
  await assert.rejects(f(1), /Kitsu 503/);
  assert.equal(await f(1), 'ok');
  assert.equal(calls, 2);
});

test('a function that throws straight away still rejects instead of throwing', async () => {
  const f = memo(() => { throw new Error('sync'); });
  await assert.rejects(f(1), /sync/);
});
