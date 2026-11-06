import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ride, taste, match, TIERS } from '../web/js/score.js';

test('a brand-new rider starts on the first tier with no stamps', () => {
  const r = ride({ count: 0, episodesWatched: 0, minutesWatched: 0, meanScore: 0, statuses: [], genres: [] });
  assert.equal(r.points, 0);
  assert.equal(r.tier.name, TIERS[0].name);
  assert.equal(r.stamps.filter(x => x.got).length, 0);
});

test('ride points, tier and stamps for a seasoned rider', () => {
  const r = ride({
    count: 294, episodesWatched: 3502, minutesWatched: 87511, meanScore: 78.7,
    statuses: [{ status: 'COMPLETED', count: 260 }, { status: 'PLANNING', count: 244 }, { status: 'DROPPED', count: 11 }],
    genres: Array.from({ length: 14 }, (_, i) => ({ genre: 'g' + i, count: 10 })),
    formats: [{ format: 'MOVIE', count: 39 }], releaseYears: [{ releaseYear: 1988, count: 1 }], lengths: [{ length: '101+', count: 1 }],
    countries: [{ country: 'JP' }, { country: 'CN' }, { country: 'KR' }], studios: [{ count: 23 }],
  });
  const got = new Set(r.stamps.filter(x => x.got).map(x => x.name));
  for (const name of ['First ride', 'Century', 'Thousand episodes', 'Week pass', 'Month pass', 'Cinema car', 'Time traveler', 'Long haul', 'Genre hopper', 'International transfer', 'Studio regular', 'Dreamer']) assert.ok(got.has(name), name);
  for (const name of ['Year pass', 'Tough crowd', 'Emergency exit']) assert.ok(!got.has(name), name);
  assert.equal(r.points, 4375 + 5200 + 350 + 1800, 'time + completions + genres + 12 stamps');
  assert.equal(r.tier.name, 'Limited Express');
  assert.equal(r.next.name, 'Shinkansen');
  assert.ok(r.pct > 0 && r.pct < 1);
});

test('the top tier has no next stop', () => {
  assert.equal(ride({ minutesWatched: 1e7, statuses: [], genres: [] }).next, undefined);
});

test('taste ignores cast tags and weighs higher-rated genres more', () => {
  const t = taste({ meanScore: 75, genres: [{ genre: 'Drama', count: 50, meanScore: 85 }, { genre: 'Action', count: 50, meanScore: 60 }],
    tags: [{ count: 40, meanScore: 85, tag: { name: 'Tragedy', category: 'Theme-Drama' } }, { count: 90, meanScore: 75, tag: { name: 'Male Protagonist', category: 'Cast-Main Cast' } }] });
  assert.ok(!t.tags.has('Male Protagonist'));
  assert.ok(t.genres.get('Drama') > t.genres.get('Action'));
  const sad = match({ genres: ['Drama'], tags: [{ name: 'Tragedy', rank: 90 }], averageScore: 80 }, t);
  const loud = match({ genres: ['Action'], tags: [{ name: 'Mecha', rank: 90 }], averageScore: 80 }, t);
  assert.ok(sad.pct > loud.pct);
  assert.deepEqual(sad.why, ['Tragedy']);
  assert.ok(sad.pct <= 100 && loud.pct >= 0);
});
