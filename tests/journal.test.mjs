import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { episodesIn, describe, streak } from '../web/js/journal.js';

test('episode ranges from AniList progress strings', () => {
  assert.equal(episodesIn('1 - 10'), 10);
  assert.equal(episodesIn('4'), 1);
  assert.equal(episodesIn(null), 0);
});

test('activities become readable timeline rows', () => {
  assert.deepEqual(describe({ status: 'watched episode', progress: '1 - 10', media: { duration: 24 } }), { kind: 'watched', verb: 'Watched episodes 1–10 of', eps: 10, minutes: 240 });
  assert.equal(describe({ status: 'completed', media: {} }).kind, 'completed');
  assert.equal(describe({ status: 'plans to watch', media: {} }).verb, 'Planned to watch');
  assert.equal(describe({ status: 'rewatched episode', progress: '3', media: { format: 'MOVIE' } }).minutes, 100);
});

test('the daily streak survives until you watch today', () => {
  assert.equal(streak(['2026-11-04', '2026-11-05', '2026-11-06'], '2026-11-06'), 3);
  assert.equal(streak(['2026-11-04', '2026-11-05'], '2026-11-06'), 2);
  assert.equal(streak(['2026-11-01', '2026-11-05'], '2026-11-06'), 1);
  assert.equal(streak([], '2026-11-06'), 0);
});
