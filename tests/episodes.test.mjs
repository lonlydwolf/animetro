import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rows, epState, episodeTotal, airedCount } from '../web/js/episodes.js';

const now = Date.UTC(2026, 0, 10);
const r = rows({
  total: 4, now,
  kitsu: [
    { number: 1, canonicalTitle: 'Shinsei', titles: { en_us: 'Rebirth', ja_jp: '新生' }, airdate: '2025-12-01', length: 23, thumbnail: { original: 'https://k/1.jpg' }, description: 'Light finds a notebook.' },
    { number: 2, canonicalTitle: 'Taiketsu', titles: { en_jp: 'Taiketsu' }, airdate: '2025-12-08', length: 23, thumbnail: null },
  ],
  streams: [
    { title: 'Episode 2 - Confrontation', thumbnail: 'https://c/2.jpg', url: 'http://cr/2', site: 'Crunchyroll' },
    { title: 'Episode 3 - Dealings', thumbnail: 'https://c/3.jpg', url: 'http://cr/3', site: 'Crunchyroll' },
  ],
  schedule: [{ episode: 4, airingAt: now / 1000 + 3600 }],
});

test('Kitsu titles and pictures first, AniList streaming episodes fill the gaps', () => {
  assert.deepEqual(r.map(x => [x.n, x.title, x.thumb]), [
    [1, 'Rebirth', 'https://k/1.jpg'], [2, 'Taiketsu', 'https://c/2.jpg'], [3, 'Dealings', 'https://c/3.jpg'], [4, '', null]]);
  assert.equal(r[0].native, '新生');
  assert.equal(r[2].watch.site, 'Crunchyroll');
});

test('scheduled episodes are upcoming; progress marks watched and next up', () => {
  assert.ok(r[3].upcoming && !r[2].upcoming);
  assert.deepEqual(r.map(x => epState(x, 1)), ['watched', 'next', '', 'upcoming']);
  assert.deepEqual(r.map(x => epState(x, 3)), ['watched', 'watched', 'watched', 'upcoming']);
});

test('list length: the final count when known, else what has aired or is scheduled', () => {
  assert.equal(episodeTotal({ episodes: 12 }, 30), 12);
  assert.equal(episodeTotal({ nextAiringEpisode: { episode: 8 }, airingSchedule: { nodes: [{ episode: 9 }] } }), 9);
  assert.equal(episodeTotal({ nextAiringEpisode: { episode: 8 }, airingSchedule: { nodes: [] } }, 1410), 7); // Kitsu placeholders ignored
  assert.equal(episodeTotal({ airingSchedule: { nodes: [] } }, 26), 26);
});

test('episodes that have not aired yet are upcoming, even without an air date', () => {
  assert.equal(airedCount({ status: 'NOT_YET_RELEASED', episodes: 7 }), 0);
  assert.equal(airedCount({ status: 'RELEASING', nextAiringEpisode: { episode: 5 } }), 4);
  assert.equal(airedCount({ status: 'FINISHED', episodes: 12 }), Infinity);
  const unreleased = rows({ total: 3, aired: 0, now });
  assert.ok(unreleased.every(x => x.upcoming), 'no episode of an unreleased show can be marked watched');
  assert.deepEqual(rows({ total: 6, aired: 4, now }).map(x => epState(x, 2)), ['watched', 'watched', 'next', '', 'upcoming', 'upcoming']);
});
