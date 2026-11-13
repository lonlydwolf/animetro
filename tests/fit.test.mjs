import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fit, remaining, finishes, logged } from '../web/js/fit.js';

const show = (id, extra) => ({ id, format: 'TV', status: 'FINISHED', episodes: 12, duration: 24, averageScore: 70, ...extra });
const airing = show(2, { status: 'RELEASING', episodes: null, nextAiringEpisode: { episode: 6 } }); // 5 episodes out
const riding = [{ progress: 2, media: show(1) }, { progress: 10, media: show(3) }, { progress: 3, media: airing }];
const planning = [{ progress: 0, media: show(4, { averageScore: 90 }) }, { progress: 0, media: show(5, { format: 'MOVIE', episodes: 1, duration: 110 }) },
  { progress: 0, media: show(6, { averageScore: 80 }) }, { progress: 0, media: show(7, { averageScore: 75 }) }];

test('what is left of a show, and when it is the last episode', () => {
  assert.deepEqual(remaining({ progress: 11, media: show(1) }), { out: 12, left: 1, airing: false, unknown: false, last: true, more: true, minutes: 24 });
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

test('catching up with an airing show does not complete it; reaching the known final episode does', () => {
  assert.equal(finishes(5, { episodes: null, nextAiringEpisode: { episode: 6 } }), false, 'final count unknown');
  assert.equal(finishes(5, { episodes: 12, nextAiringEpisode: { episode: 6 } }), false);
  assert.equal(finishes(12, { episodes: 12 }), true);
  assert.equal(finishes(1, { episodes: 1, format: 'MOVIE' }), true);
});

test('an airing show with no schedule on AniList: aired count unknown, never "all watched" or "all ready"', () => {
  const noSchedule = extra => show(8, { status: 'RELEASING', episodes: null, nextAiringEpisode: null, ...extra });
  const unknown = remaining({ progress: 3, media: noSchedule() });
  assert.deepEqual(unknown, { out: null, left: 0, airing: true, unknown: true, last: false, more: true, minutes: 0 });
  const counted = remaining({ progress: 3, media: noSchedule({ episodes: 12 }) });
  assert.equal(counted.left, 0, 'a known final count is not a count of episodes out');
  assert.ok(counted.airing && counted.unknown && counted.more, 'still airing, and +1 stays open');
  assert.equal(remaining({ progress: 3, media: noSchedule({ status: 'HIATUS', episodes: 12 }) }).unknown, true, 'on hiatus');
  const reached = remaining({ progress: 12, media: noSchedule({ episodes: 12 }) });
  assert.deepEqual([reached.airing, reached.left, reached.more], [false, 0, false], 'reaching the final count ends it');
  assert.equal(fit(2000, [{ progress: 3, media: noSchedule({ episodes: 12 }) }], []).picks.length, 0, 'no unknown episodes in a time budget');
});

test('a show that has not aired yet is waiting, not finished', () => {
  const r = remaining({ progress: 0, media: show(9, { status: 'NOT_YET_RELEASED', nextAiringEpisode: null }) });
  assert.deepEqual([r.out, r.left, r.airing, r.more], [0, 0, true, false]);
});

test('an airing show with a schedule: what has aired is out, capped at the final count', () => {
  assert.deepEqual(remaining({ progress: 3, media: airing }).out, 5);
  assert.equal(remaining({ progress: 3, media: { ...airing, episodes: 12 } }).left, 2);
  assert.equal(remaining({ progress: 0, media: show(10, { format: 'MOVIE', episodes: null }) }).left, 1, 'a finished movie with no count is one sitting');
});

test('what a Home action saves: +1 never passes the final count; completing clamps to it', () => {
  assert.equal(logged(11, { episodes: 12 }), 12);
  assert.equal(logged(12, { episodes: 12 }), null, 'nothing past the final episode');
  assert.equal(logged(13, { episodes: 12 }), null);
  assert.equal(logged(40, { episodes: null }), 41, 'no known end');
  assert.equal(logged(13, { episodes: 12 }, true), 12, 'an entry already past the end still completes, at the final count');
  assert.equal(logged(12, { episodes: 12 }, true), 12);
  assert.equal(logged(7, { episodes: null }, true), 7);
});
