import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fit, remaining } from '../web/js/fit.js';

const show = (id, extra) => ({ id, format: 'TV', status: 'FINISHED', episodes: 12, duration: 24, averageScore: 70, ...extra });
const airing = show(2, { status: 'RELEASING', episodes: null, nextAiringEpisode: { episode: 6 } }); // 5 episodes out
const riding = [{ progress: 2, media: show(1) }, { progress: 10, media: show(3) }, { progress: 3, media: airing }];
const planning = [{ progress: 0, media: show(4, { averageScore: 90 }) }, { progress: 0, media: show(5, { format: 'MOVIE', episodes: 1, duration: 110 }) },
  { progress: 0, media: show(6, { averageScore: 80 }) }, { progress: 0, media: show(7, { averageScore: 75 }) }];

test('what is left of a show, and when it is the last episode', () => {
  assert.deepEqual(remaining({ progress: 11, media: show(1) }), { out: 12, left: 1, airing: false, last: true, minutes: 24 });
  assert.equal(remaining({ progress: 5, media: airing }).left, 0, 'caught up with an airing show');
  assert.equal(remaining({ progress: 3, media: airing }).last, false, 'airing shows have no last episode');
});

test('the show closest to finishing goes first', () => {
  const f = fit(60, riding, planning);
  assert.deepEqual(f.picks.map(x => [x.media.id, x.from, x.to]), [[3, 11, 12]]);
  assert.ok(f.picks[0].finishes);
});

test('the budget is filled episode by episode across shows', () => {
  const f = fit(120, riding, planning);
  assert.deepEqual(f.picks.map(x => [x.media.id, x.eps]), [[3, 2], [2, 2], [1, 1]]);
  assert.equal(f.used, 120);
});

test('at most two new starts, and an airing show is never "finished"', () => {
  const f = fit(2000, riding, planning);
  assert.equal(f.picks.filter(x => x.fresh).length, 2);
  assert.ok(!f.picks.some(x => x.media.id === 2 && x.finishes));
});

test('nothing fits a too-short budget; a movie fits whole or not at all', () => {
  assert.equal(fit(20, riding, planning).picks.length, 0);
  assert.deepEqual(fit(110, [], [{ progress: 0, media: show(5, { format: 'MOVIE', episodes: 1, duration: 110 }) }]).picks.map(x => x.eps), [1]);
});
