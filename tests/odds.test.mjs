import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finishOdds, outcome } from '../web/js/odds.js';

const h = (status, episodes, genres, format = 'TV') => ({ status, media: { episodes, genres, format } });
const history = [
  ...Array.from({ length: 20 }, () => h('COMPLETED', 12, ['Comedy'])), // finishes short comedies
  ...Array.from({ length: 6 }, () => h('DROPPED', 100, ['Action'])),   // drops long action shows
  ...Array.from({ length: 2 }, () => h('COMPLETED', 100, ['Action'])),
];

test('finish chance rises for what you usually finish and falls for what you drop', () => {
  const short = finishOdds(history, { episodes: 12, genres: ['Comedy'], format: 'TV' });
  const long = finishOdds(history, { episodes: 120, genres: ['Action'], format: 'TV' });
  assert.ok(short.pct > short.base && long.pct < long.base);
  assert.ok(long.reasons.some(r => /You leave 75% of shows over 52 episodes unfinished/.test(r)), long.reasons.join(' | '));
});

test('quiet drops: a finished show left on Watching for months counts as given up', () => {
  const NOW = 2e9, old = NOW - 200 * 86400, recent = NOW - 86400;
  assert.equal(outcome({ status: 'CURRENT', updatedAt: old, media: { status: 'FINISHED' } }, NOW), 0);
  assert.equal(outcome({ status: 'CURRENT', updatedAt: recent, media: { status: 'FINISHED' } }, NOW), null);
  assert.equal(outcome({ status: 'CURRENT', updatedAt: old, media: { status: 'RELEASING' } }, NOW), null, 'waiting on new episodes');
  assert.equal(outcome({ status: 'PAUSED', updatedAt: old, media: {} }, NOW), 0);
  assert.equal(outcome({ status: 'PAUSED', updatedAt: recent, media: {} }, NOW), 0.5);
});

test('no estimate with too little history; unknown genres are left out', () => {
  assert.equal(finishOdds(history.slice(0, 5), { episodes: 12 }), null);
  const mid = finishOdds(history, { episodes: 12, genres: ['Mecha'], format: 'TV' });
  assert.ok(mid.pct >= 0 && mid.pct <= 100);
});
