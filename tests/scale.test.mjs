import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scale } from '../web/js/scale.js';

test('ten-point formats get 1-10 with 0 as the tenth key', () => {
  for (const f of ['POINT_10', 'POINT_10_DECIMAL', undefined]) {
    const s = scale(f);
    assert.deepEqual(s.map(x => x.value), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(s.map(x => x.key).join(''), '1234567890');
  }
});

test('100-point riders score in tens', () => {
  const s = scale('POINT_100');
  assert.deepEqual(s.map(x => x.value), [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  assert.equal(s.at(-1).label, '100');
  assert.equal(s.at(-1).key, '0');
});

test('stars and faces get their own few buttons', () => {
  assert.deepEqual(scale('POINT_5').map(x => [x.value, x.key]), [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']]);
  const faces = scale('POINT_3');
  assert.deepEqual(faces.map(x => x.value), [1, 2, 3]);
  assert.equal(faces[2].label, '🙂');
});
