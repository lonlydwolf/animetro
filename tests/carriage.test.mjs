import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clean, overlay, apart, compatibility, rideTogether, riderMarker, MIN_SHARED, MIN_SCORED } from '../web/js/carriage.js';
import { ride } from '../web/js/map.js';

// a show with franchise links to other shows: rel = { SEQUEL: [2], ... }
const md = (id, year, rel = {}, extra = {}) => ({ id, type: 'ANIME', format: 'TV', status: 'FINISHED', popularity: 1000 - id, startDate: { year },
  studios: { nodes: [{ name: 'Studio A', isAnimationStudio: true }] }, title: { romaji: 'S' + id },
  relations: { edges: Object.entries(rel).flatMap(([t, ids]) => ids.map(n => ({ relationType: t, node: { id: n, type: 'ANIME', format: 'TV', status: 'FINISHED', startDate: { year: year + 1 }, title: { romaji: 'S' + n } } }))) }, ...extra });
const e = (id, status, extra = {}) => ({ status, progress: 0, score: 0, ...extra, media: extra.media || md(id, 2000 + id) });

// Franchise 1-2-3-4 (a chain). You rode 1 and 2, your friend 2 and 4. Franchise 10-11: only you. 20-21: only them.
const mine = [
  e(1, 'COMPLETED', { media: md(1, 2001, { SEQUEL: [2] }) }),
  e(2, 'CURRENT', { media: md(2, 2002, { PREQUEL: [1], SEQUEL: [3] }) }),
  e(10, 'COMPLETED', { media: md(10, 2010, { SEQUEL: [11] }) }),
];
const theirs = [
  e(2, 'COMPLETED', { media: md(2, 2002, { PREQUEL: [1], SEQUEL: [3] }) }),
  e(3, 'PLANNING', { media: md(3, 2003, { PREQUEL: [2], SEQUEL: [4] }) }),
  e(4, 'COMPLETED', { media: md(4, 2004, { PREQUEL: [3] }) }),
  e(20, 'COMPLETED', { media: md(20, 2020, { SEQUEL: [21] }) }),
];

test('shared lines come first, and every station says who rode it', () => {
  const { lines } = overlay(mine, theirs);
  assert.equal(lines.length, 2);
  const [shared, own] = lines;
  assert.ok(shared.shared && !own.shared);
  assert.deepEqual(shared.stations.map(s => [s.id, s.who]), [[1, 'me'], [2, 'both'], [3, null], [4, 'friend']]);
  assert.deepEqual(shared.stations.map(s => s.them), [null, 'COMPLETED', 'PLANNING', 'COMPLETED']);
  assert.equal(shared.both, 1);
  // your own states stay as My map has them: their ride at 4 is a stop you haven't been to
  assert.deepEqual(shared.stations.map(s => s.state), ['done', 'here', 'unridden', 'unridden']);
  assert.deepEqual(own.stations.map(s => s.who), ['me', null]);
});

test("a line is shared even when you never rode the same station, and their lines without you are listed apart", () => {
  const { lines, theirs: apart } = overlay([e(1, 'COMPLETED', { media: md(1, 2001, { SEQUEL: [2] }) })], theirs);
  assert.ok(lines[0].shared, 'you rode 1, they rode 2 and 4: the same franchise');
  assert.equal(lines[0].both, 0);
  assert.deepEqual(apart.map(l => l.anchor.id), [20], 'only the franchise you never reached');
  assert.deepEqual(apart[0].stations.map(s => s.state), ['done', 'unridden'], 'drawn with their states');
});

test('their lines without you include the ones they are watching, paused or dropped, not just finished ones', () => {
  const friendOnly = [
    e(30, 'COMPLETED', { media: md(30, 2001, { SEQUEL: [31] }) }),
    e(40, 'CURRENT', { media: md(40, 2002, { SEQUEL: [41] }) }),
    e(50, 'PAUSED', { media: md(50, 2003, { SEQUEL: [51] }) }),
    e(60, 'DROPPED', { media: md(60, 2004, { SEQUEL: [61] }) }),
    e(70, 'COMPLETED', { media: md(70, 2005, { SEQUEL: [71] }) }), e(71, 'CURRENT', { media: md(71, 2006, { PREQUEL: [70] }) }),
    e(80, 'PLANNING', { media: md(80, 2007) }), // planned only: not a line they ride
  ];
  const { theirs: lines } = overlay(mine, friendOnly);
  const listed = apart(lines.map(l => ride(l, 'local')));
  assert.deepEqual(listed.map(l => [l.anchor.id, l.rode, l.done]), [[70, 2, 1], [30, 1, 1], [40, 1, 0], [50, 1, 0], [60, 1, 0]]);
  // a line whose only boarded station a train service hides has nothing to show
  const hidden = lines.find(l => l.anchor.id === 40);
  assert.deepEqual(apart([{ ...hidden, stations: hidden.stations.filter(s => s.state !== 'here') }]), []);
});

test('a franchise they only plan to ride is not shared', () => {
  const { lines } = overlay(mine, [e(1, 'PLANNING', { media: md(1, 2001, { SEQUEL: [2] }) })]);
  assert.ok(!lines.some(l => l.shared));
  assert.equal(lines[0].stations[0].them, 'PLANNING');
});

// riders who saw shows 1..n, scoring each with score(id)
const rider = (ids, score = () => 0, format = 'POINT_100', status = 'COMPLETED') => ({ format, entries: ids.map(id => e(id, status, { score: score(id) })) });
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

test('the score stays within 0-100 and is the same from either side', () => {
  const cases = [
    [rider(range(1, 40), id => 50 + id), rider(range(20, 200), id => 90 - id % 30)],
    [rider(range(1, 10), () => 100), rider(range(1, 10), () => 10)],
    [rider(range(1, 10), () => 70), rider(range(1, 10), () => 70)],
    [rider(range(1, 300), id => id % 100), rider(range(295, 900), id => (id * 7) % 100, 'POINT_5')],
  ];
  for (const [a, b] of cases) {
    const ab = compatibility(a, b), ba = compatibility(b, a);
    assert.ok(ab.score >= 0 && ab.score <= 100, `score ${ab.score}`);
    assert.equal(ab.score, ba.score);
    assert.equal(ab.basis, ba.basis);
    assert.equal(ab.overlap, ba.overlap);
    assert.equal(ab.points.scores, ba.points.scores);
  }
  assert.equal(compatibility(...cases[2]).score, 100, 'same list, same scores');
  assert.equal(compatibility(...cases[1]).points.scores, 0, '90 points apart on everything');
});

test('the score is half overlap, half how closely your scores agree', () => {
  const c = compatibility(rider(range(1, 20), () => 80), rider(range(11, 30), () => 60));
  assert.equal(c.shared, 10);
  assert.equal(c.overlap, 0.5);
  assert.equal(c.basis, 'both');
  assert.equal(c.apart, 20);
  assert.equal(c.lean, 20, 'the first rider scores higher');
  assert.deepEqual(c.points, { overlap: Math.round(50 * Math.sqrt(0.5)), scores: 25 });
  assert.equal(c.score, c.points.overlap + c.points.scores);
});

test('scores in different formats compare fairly', () => {
  // 4 stars (80 on the 100-point scale) next to an 87: as close as a 5-star rider can get
  const stars = rider(range(1, 10), () => 80, 'POINT_5'), fine = rider(range(1, 10), () => 87);
  assert.equal(compatibility(stars, fine).gap, 0);
  assert.equal(compatibility(stars, fine).score, 100);
  // the same two numbers between two 100-point riders are 7 points apart
  assert.equal(compatibility(rider(range(1, 10), () => 80), fine).gap, 7);
  // a smiley :) is 85; a 10-point rider's 7/10 is 70: 15 apart, 2.5 after the faces' allowance
  const faces = rider(range(1, 10), () => 85, 'POINT_3'), tens = rider(range(1, 10), () => 70, 'POINT_10');
  assert.equal(compatibility(faces, tens).gap, 2.5);
  assert.equal(compatibility(tens, faces).gap, 2.5);
});

test('too little overlap: no number', () => {
  const c = compatibility(rider(range(1, 50)), rider(range(52 - MIN_SHARED, 90)));
  assert.equal(c.shared, MIN_SHARED - 1);
  assert.equal(c.score, null);
  assert.equal(c.basis, null);
  assert.equal(compatibility(rider([]), rider(range(1, 5))).score, null, 'an empty list');
  assert.equal(compatibility(rider(range(1, 500)), rider(range(1, MIN_SHARED - 1))).score, null, 'a tiny list inside a big one');
  // only Planning in common counts as nothing in common
  assert.equal(compatibility(rider(range(1, 9), () => 0, 'POINT_100', 'PLANNING'), rider(range(1, 9))).score, null);
});

test('enough shows in common but too few scored by both: overlap only, and it says so', () => {
  const c = compatibility(rider(range(1, 20), id => (id <= MIN_SCORED - 1 ? 90 : 0)), rider(range(1, 20), () => 20));
  assert.equal(c.basis, 'overlap');
  assert.equal(c.scored, MIN_SCORED - 1);
  assert.equal(c.agreement, null);
  assert.equal(c.score, 100, 'same list: full overlap, scores not judged');
});

test('ride-together picks come only from both Planning lists, best first', () => {
  const m = (id, averageScore, status = 'FINISHED') => md(id, 2020, {}, { averageScore, status });
  const a = [e(1, 'PLANNING', { media: m(1, 70) }), e(2, 'PLANNING', { media: m(2, 88) }), e(3, 'PLANNING', { media: m(3, 95, 'NOT_YET_RELEASED') }),
    e(4, 'COMPLETED', { media: m(4, 90) }), e(5, 'PLANNING', { media: m(5, 99) })];
  const b = [e(1, 'PLANNING', { media: m(1, 70) }), e(2, 'PLANNING', { media: m(2, 88) }), e(3, 'PLANNING', { media: m(3, 95, 'NOT_YET_RELEASED') }),
    e(4, 'PLANNING', { media: m(4, 90) }), e(5, 'CURRENT', { media: m(5, 99) })];
  assert.deepEqual(rideTogether(a, b).map(x => x.id), [2, 1, 3], 'out now by score, then the unreleased one');
  assert.deepEqual(rideTogether(b, a).map(x => x.id), [2, 1, 3], 'the same picks from either side');
  assert.deepEqual(rideTogether(a, []), []);
});

test('18+ shows stay out unless 18+ is on', () => {
  const adult = (id, rel) => md(id, 2020, rel, { isAdult: true });
  const raw = [
    e(1, 'COMPLETED', { media: md(1, 2001, { SEQUEL: [2] }) }),
    e(1, 'COMPLETED', { media: md(1, 2001, { SEQUEL: [2] }) }), // AniList lists a show once per custom list too
    e(5, 'COMPLETED', { media: adult(5) }),
    e(6, 'PLANNING', { media: adult(6) }),
  ];
  raw[0].media.relations.edges.push({ relationType: 'SIDE_STORY', node: { id: 7, type: 'ANIME', isAdult: true, format: 'OVA', startDate: { year: 2002 }, title: { romaji: 'S7' } } });
  const off = clean(raw), on = clean(raw, true);
  assert.deepEqual(off.map(x => x.media.id), [1]);
  assert.deepEqual(off[0].media.relations.edges.map(x => x.node.id), [2], 'the 18+ neighbouring stop is gone too');
  assert.deepEqual(on.map(x => x.media.id), [1, 5, 6]);
  // and nothing downstream sees them
  const friend = clean([e(5, 'COMPLETED', { media: adult(5) }), e(6, 'PLANNING', { media: adult(6) }), e(1, 'COMPLETED')]);
  assert.deepEqual(rideTogether(off, friend), []);
  assert.deepEqual(rideTogether(on, clean([e(6, 'PLANNING', { media: adult(6) })], true)).map(x => x.id), [6]);
  assert.ok(!overlay(off, friend).lines.flatMap(l => l.stations).some(s => s.isAdult));
  assert.equal(compatibility({ entries: off }, { entries: friend }).mine, 1);
});

test('markers: a ring for you, a square for your friend, a transfer pill for both', () => {
  assert.match(riderMarker({ who: 'both', state: 'done' }, 10, 10, '#f39700'), /<rect[^>]*rx="9"/);
  assert.match(riderMarker({ who: 'friend', state: 'unridden' }, 10, 10, '#f39700'), /<rect[^>]*rx="4"/);
  assert.match(riderMarker({ who: 'me', state: 'done' }, 10, 10, '#f39700'), /^<circle/);
  assert.match(riderMarker({ who: 'both', state: 'here' }, 10, 10, '#f39700', true), /class="pulse"/);
});
