import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recapMode, lastStops, ago } from '../web/js/recap.js';

test('paused shows always get a recap; watched ones only when asked or opted in', () => {
  assert.equal(recapMode({ status: 'PAUSED', progress: 7 }, false), 'open');
  assert.equal(recapMode({ status: 'CURRENT', progress: 7 }, false), 'offer');
  assert.equal(recapMode({ status: 'CURRENT', progress: 7 }, true), 'open');
  assert.equal(recapMode({ status: 'REPEATING', progress: 2 }, true), 'open');
  assert.equal(recapMode({ status: 'PAUSED', progress: 0 }, true), null, 'nothing watched, nothing to recap');
  assert.equal(recapMode({ status: 'COMPLETED', progress: 12 }, true), null);
  assert.equal(recapMode(undefined), null);
});

test('the last two stops, oldest first, never before episode 1', () => {
  assert.deepEqual(lastStops(7), [6, 7]);
  assert.deepEqual(lastStops(1), [1]);
  assert.deepEqual(lastStops(0), []);
});

test('how long ago, in words', () => {
  const now = Date.UTC(2026, 10, 7), s = d => now / 1000 - d * 86400;
  assert.equal(ago(s(0.2), now), 'today');
  assert.equal(ago(s(1.5), now), 'yesterday');
  assert.equal(ago(s(5), now), '5 days ago');
  assert.equal(ago(s(21), now), '3 weeks ago');
  assert.equal(ago(s(95), now), '3 months ago');
  assert.equal(ago(s(800), now), '2 years ago');
  assert.equal(ago(0, now), '');
});
