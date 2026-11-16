import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyDate, journeyDays, route, rideTime, scoreText, guessFormat, stubs, album, serial } from '../web/js/stubs.js';

const media = (id, more = {}) => ({ id, format: 'TV', episodes: 12, duration: 24, isAdult: false, ...more });
const entry = (id, completedAt, more = {}) => ({
  status: 'COMPLETED', score: 0, repeat: 0, progress: 12, updatedAt: id, startedAt: {}, completedAt: completedAt || {}, media: media(id), ...more,
});

test('fuzzy dates print what AniList knows and nothing more', () => {
  assert.deepEqual(fuzzyDate({ year: 2024, month: 3, day: 12 }), { y: 2024, m: 3, d: 12, text: '12 Mar 2024' });
  assert.equal(fuzzyDate({ year: 2024, month: 3, day: null }).text, 'Mar 2024');
  assert.equal(fuzzyDate({ year: 2024, month: null, day: 5 }).text, '2024'); // a day without its month means nothing
  assert.equal(fuzzyDate({ year: 2024, month: 13, day: 1 }).text, '2024');
  assert.equal(fuzzyDate({ year: null, month: 3, day: 12 }), null);
  assert.equal(fuzzyDate({}), null);
  assert.equal(fuzzyDate(null), null);
});

test('journey length needs two exact dates', () => {
  const day = (y, m, d) => fuzzyDate({ year: y, month: m, day: d });
  assert.equal(journeyDays(day(2024, 3, 12), day(2024, 3, 12)), 1);
  assert.equal(journeyDays(day(2024, 2, 28), day(2024, 3, 1)), 3); // leap year
  assert.equal(journeyDays(day(2023, 12, 30), day(2024, 1, 2)), 4);
  assert.equal(journeyDays(fuzzyDate({ year: 2024, month: 3 }), day(2024, 3, 20)), null);
  assert.equal(journeyDays(null, day(2024, 3, 20)), null);
  assert.equal(journeyDays(day(2024, 3, 20), day(2024, 3, 1)), null); // arrived before boarding: AniList typo
});

test('origin and terminus: episodes, movies and one-shots', () => {
  assert.deepEqual(route(media(1, { episodes: 24 })), { origin: 'Ep 1', terminus: 'Ep 24', stops: 24, single: false });
  assert.deepEqual(route(media(1, { format: 'MOVIE', episodes: 1 })), { origin: 'Opening', terminus: 'End credits', stops: 1, single: true });
  assert.equal(route(media(1, { format: 'MOVIE', episodes: null })).terminus, 'End credits');
  assert.equal(route(media(1, { format: 'OVA', episodes: 1 })).single, true);
  assert.deepEqual(route(media(1, { format: 'MOVIE', episodes: 3 })), { origin: 'Part 1', terminus: 'Part 3', stops: 3, single: false });
  assert.equal(route(media(1, { episodes: null }), 13).terminus, 'Ep 13'); // no count on AniList: your progress
  assert.equal(route(media(1, { episodes: null })).terminus, 'Last stop');
});

test('ride time is episodes times episode length', () => {
  assert.deepEqual(rideTime(media(1, { episodes: 12, duration: 24 })), { minutes: 288, estimated: false });
  assert.deepEqual(rideTime(media(1, { format: 'MOVIE', episodes: 1, duration: 106 })), { minutes: 106, estimated: false });
  assert.deepEqual(rideTime(media(1, { episodes: 10, duration: null })), { minutes: 240, estimated: true });
  assert.deepEqual(rideTime(media(1, { format: 'MOVIE', episodes: null, duration: null })), { minutes: 100, estimated: true });
  assert.deepEqual(rideTime(media(1, { episodes: null }), 5), { minutes: 120, estimated: false });
  assert.equal(rideTime(media(1, { episodes: null })).minutes, null);
});

test('the score prints in your own AniList format', () => {
  assert.deepEqual(scoreText(8, 'POINT_10'), { text: '8', out: '/10', label: '8 out of 10' });
  assert.equal(scoreText(8.5, 'POINT_10_DECIMAL').text, '8.5');
  assert.equal(scoreText(8, 'POINT_10_DECIMAL').text, '8');
  assert.deepEqual(scoreText(85, 'POINT_100'), { text: '85', out: '/100', label: '85 out of 100' });
  assert.deepEqual(scoreText(4, 'POINT_5'), { text: '★★★★☆', out: '', label: '4 out of 5 stars' });
  assert.equal(scoreText(5, 'POINT_5').text, '★★★★★');
  assert.deepEqual(scoreText(3, 'POINT_3'), { text: '🙂', out: '', label: 'Liked it' });
  assert.equal(scoreText(1, 'POINT_3').text, '🙁');
  assert.equal(scoreText(0, 'POINT_10'), null);
  assert.equal(scoreText(null, 'POINT_100'), null);
});

test('a missing score format is read off the scores', () => {
  assert.equal(guessFormat([0, 85, 70]), 'POINT_100');
  assert.equal(guessFormat([7.5, 8]), 'POINT_10_DECIMAL');
  assert.equal(guessFormat([0, 7, 9]), 'POINT_10');
  assert.equal(stubs([entry(1, null, { score: 72 })])[0].score.out, '/100');
});

test('a stub carries every field of the ride', () => {
  const [s] = stubs([entry(7, { year: 2024, month: 6, day: 30 }, {
    score: 9, startedAt: { year: 2024, month: 6, day: 1 }, media: media(7, { episodes: 24, duration: 23 }),
  })], { format: 'POINT_10' });
  assert.equal(s.id, 7);
  assert.equal(s.no, 1);
  assert.equal(s.boarded.text, '1 Jun 2024');
  assert.equal(s.arrived.text, '30 Jun 2024');
  assert.equal(s.days, 30);
  assert.equal(s.route.terminus, 'Ep 24');
  assert.equal(s.ride.minutes, 552);
  assert.equal(s.score.text, '9');
  assert.deepEqual(s.rewatch, { count: 0, now: false });
});

test('stubs are numbered in the order you finished, undated ones first', () => {
  const list = stubs([
    entry(1, { year: 2024, month: 5, day: 2 }),
    entry(2, { year: 2023, month: 1, day: 9 }),
    entry(3, null, { updatedAt: 50 }),
    entry(4, { year: 2024 }), // year only: start of 2024
    entry(5, { year: 2024, month: 5 }), // month only: start of May
    entry(6, null, { updatedAt: 10 }),
  ]);
  const no = Object.fromEntries(list.map(s => [s.id, s.no]));
  assert.deepEqual(no, { 6: 1, 3: 2, 2: 3, 4: 4, 5: 5, 1: 6 });
});

test('the same day keeps the order you logged them in', () => {
  const day = { year: 2024, month: 1, day: 1 };
  const list = stubs([entry(9, day, { updatedAt: 300 }), entry(8, day, { updatedAt: 100 }), entry(7, day, { updatedAt: 100 })]);
  assert.deepEqual(list.map(s => s.id), [7, 8, 9]);
});

test('a show on several custom lists is one stub', () => {
  const e = entry(1, { year: 2024, month: 1, day: 1 });
  assert.equal(stubs([e, { ...e }, entry(2, null)]).length, 2);
  assert.equal(stubs([]).length, 0);
  assert.equal(stubs(null).length, 0);
});

test('rewatches are marked', () => {
  const list = stubs([
    entry(1, { year: 2022, month: 3, day: 1 }, { repeat: 2 }),
    entry(2, null, { status: 'REPEATING', repeat: 0 }),
    entry(3, { year: 2022, month: 4, day: 1 }),
  ]);
  const by = Object.fromEntries(list.map(s => [s.id, s.rewatch]));
  assert.deepEqual(by[1], { count: 2, now: false });
  assert.deepEqual(by[2], { count: 0, now: true });
  assert.deepEqual(by[3], { count: 0, now: false });
});

test('18+ stubs stay hidden unless 18+ is on, without changing anyone\'s number', () => {
  const entries = [
    entry(1, { year: 2024, month: 1, day: 1 }),
    entry(2, { year: 2024, month: 2, day: 1 }, { media: media(2, { isAdult: true }) }),
    entry(3, { year: 2024, month: 3, day: 1 }),
  ];
  const off = stubs(entries), on = stubs(entries, { adult: true });
  assert.deepEqual(off.map(s => [s.id, s.no]), [[1, 1], [3, 3]]);
  assert.deepEqual(on.map(s => [s.id, s.no]), [[1, 1], [2, 2], [3, 3]]);
  assert.ok(album(off).every(g => g.stubs.every(s => !s.media.isAdult)));
});

test('the album groups by arrival year, newest first, undated at the end', () => {
  const groups = album(stubs([
    entry(1, { year: 2022, month: 3, day: 1 }),
    entry(2, null),
    entry(3, { year: 2024, month: 2, day: 1 }),
    entry(4, { year: 2024, month: 11, day: 20 }),
    entry(5, { year: 2023 }),
    entry(6, null),
  ]));
  assert.deepEqual(groups.map(g => g.year), [2024, 2023, 2022, null]);
  assert.deepEqual(groups.map(g => g.label), ['2024', '2023', '2022', 'Arrival date not logged']);
  assert.deepEqual(groups[0].stubs.map(s => s.id), [4, 3]); // newest first inside a year
  assert.deepEqual(groups[3].stubs.map(s => s.id), [6, 2]);
  assert.equal(groups[0].minutes, 2 * 288);
  assert.deepEqual(album([]), []);
});

test('stub numbers print like a ticket serial', () => {
  assert.equal(serial(7), '0007');
  assert.equal(serial(214), '0214');
  assert.equal(serial(12345), '12345');
});
