// Days follow the rider's clock, so pin one: New York, which has daylight saving time (and the tests say which zone
// they mean when it matters). Set before any date is made.
process.env.TZ = 'America/New_York';
import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { review, longestStreak, yearBounds, yearLoader, studioOf } from '../web/js/year.js';
import { franchises, PALETTE } from '../web/js/map.js';

// an activity at a UTC time ('2026-03-01T12:00')
let nextId = 1;
const at = iso => Date.parse(iso + 'Z') / 1000;
const show = (id, extra = {}) => ({ id, title: { romaji: 'Show ' + id }, format: 'TV', duration: 24, coverImage: { color: '#123456' }, isAdult: false, ...extra });
const act = (iso, media, status = 'watched episode', progress = '1') => ({ id: nextId++, createdAt: at(iso), status, progress, media });
const ep = (iso, media, progress = '1') => act(iso, media, 'watched episode', progress);
const UTC = { tz: 'UTC' };

test('the year runs from local midnight to local midnight', () => {
  const { from, to } = yearBounds(2026);
  assert.equal(new Date(from * 1000).toISOString(), '2026-01-01T05:00:00.000Z'); // New York is UTC-5 in January
  assert.equal(new Date(to * 1000).toISOString(), '2027-01-01T05:00:00.000Z');
});

test('distance ridden counts episodes and time the way the timeline does', () => {
  const tv = show(1), movie = show(2, { format: 'MOVIE', duration: null }), short = show(3, { duration: 5 });
  const r = review([
    ep('2026-03-01T12:00', tv, '1 - 10'),              // 10 × 24
    ep('2026-03-02T12:00', tv, '11'),                  // 24
    act('2026-03-03T12:00', movie, 'watched episode'), // a movie without a length counts 100 minutes
    act('2026-03-04T12:00', short, 'rewatched episode', '3 - 4'), // 2 × 5
    act('2026-03-05T12:00', tv, 'completed', null),    // completing adds no episodes, as on the timeline
    act('2026-03-06T12:00', show(4), 'plans to watch', null),
  ], 2026, UTC);
  assert.equal(r.eps, 14);
  assert.equal(r.minutes, 264 + 100 + 10);
  assert.equal(r.logs, 6);
  assert.equal(r.shows, 3);
  assert.equal(r.days, 5, 'planning a show is not a ride day');
  assert.equal(r.months[2].eps, 14);
  assert.equal(r.busiestMonth, 2);
});

test('only the chosen year counts', () => {
  const r = review([ep('2025-12-31T12:00', show(1)), ep('2026-06-01T12:00', show(1)), ep('2027-01-01T12:00', show(1))], 2026, UTC);
  assert.equal(r.eps, 1);
  assert.equal(r.first.day, '2026-06-01');
});

test('the busiest line adds up every show of a franchise, in the color My map gives it', () => {
  const md = (id, rel = {}) => ({ ...show(id), type: 'ANIME', popularity: 100 - id, startDate: { year: 2000 + id },
    relations: { edges: Object.entries(rel).flatMap(([t, ids]) => ids.map(n => ({ relationType: t, node: { id: n, type: 'ANIME', format: 'TV', title: { romaji: 'Show ' + n } } }))) } });
  const entries = [
    { status: 'COMPLETED', media: md(1, { SEQUEL: [2] }) },
    { status: 'CURRENT', media: md(2, { PREQUEL: [1] }) },
    { status: 'COMPLETED', media: md(3) },
  ];
  const lines = franchises(entries);
  lines.forEach((l, i) => (l.color = PALETTE[i % PALETTE.length]));
  const r = review([
    ep('2026-02-01T12:00', show(1), '1 - 6'),
    ep('2026-02-02T12:00', show(2), '1 - 6'),
    ep('2026-02-03T12:00', show(3), '1 - 10'),  // more than either season alone, fewer than both
    ep('2026-02-04T12:00', show(9), '1 - 2'),   // not on the list (any more): a line of its own
  ], 2026, { ...UTC, lines, entries });
  assert.equal(r.busiest.name, 'Show 1');
  assert.equal(r.busiest.eps, 12);
  assert.equal(r.busiest.shows, 2);
  assert.equal(r.busiest.color, lines.find(l => l.anchor.id === 1).color);
  assert.deepEqual(r.lines.map(l => [l.name, l.eps]), [['Show 1', 12], ['Show 3', 10], ['Show 9', 2]]);
  assert.equal(r.lines[2].color, '#123456', 'a show off the list keeps its cover color');
});

test('without the list every show is its own line', () => {
  const r = review([ep('2026-02-01T12:00', show(1), '1 - 3'), ep('2026-02-01T13:00', show(2), '1 - 5')], 2026, UTC);
  assert.equal(r.busiest.name, 'Show 2');
  assert.deepEqual(r.districts, []);
});

test('the longest streak runs across months and leap days', () => {
  assert.deepEqual(longestStreak(['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02', '2026-02-04']), { days: 4, from: '2026-01-30', to: '2026-02-02' });
  assert.deepEqual(longestStreak(['2024-02-28', '2024-02-29', '2024-03-01']), { days: 3, from: '2024-02-28', to: '2024-03-01' });
  assert.equal(longestStreak(['2026-02-28', '2026-03-01']).days, 2, 'no 29 February in 2026');
  assert.equal(longestStreak(['2026-03-07', '2026-03-08', '2026-03-09']).days, 3, 'the night the clocks go forward is still a day');
  assert.deepEqual(longestStreak(['2026-05-02', '2026-05-01', '2026-05-01']), { days: 2, from: '2026-05-01', to: '2026-05-02' }, 'order and repeats do not matter');
  assert.equal(longestStreak([]), null);
});

test('a streak over New Year counts only the days inside the chosen year', () => {
  const s = show(1);
  const acts = ['2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02'].map(d => ep(`${d}T12:00`, s));
  assert.deepEqual(review(acts, 2026, UTC).streak, { days: 2, from: '2026-01-01', to: '2026-01-02' });
  assert.deepEqual(review(acts, 2025, UTC).streak, { days: 3, from: '2025-12-29', to: '2025-12-31' });
});

test('days and years follow the rider\'s time zone', () => {
  const s = show(1);
  // 23:30 UTC on 1 March is already 2 March in Tokyo, and still 1 March in New York
  const acts = [ep('2026-03-01T03:00', s), ep('2026-03-01T23:30', s)];
  assert.equal(review(acts, 2026, UTC).streak.days, 1);
  assert.equal(review(acts, 2026, { tz: 'Asia/Tokyo' }).streak.days, 2);
  assert.equal(review(acts, 2026).streak.days, 2, 'the default is the local zone (New York here): 28 Feb 22:00 and 1 Mar 18:30');
  assert.equal(review(acts, 2026).streak.from, '2026-02-28');
  // New Year's Eve evening in New York is already the new year in Tokyo
  const eve = [ep('2026-12-31T20:00', s)];
  assert.equal(review(eve, 2026).eps, 1);
  assert.equal(review(eve, 2026, { tz: 'Asia/Tokyo' }).eps, 0);
  assert.equal(review(eve, 2027, { tz: 'Asia/Tokyo' }).eps, 1);
});

test('new districts: studios ridden for the first time this year', () => {
  const studio = name => ({ studios: { nodes: [{ name: 'Aniplex', isAnimationStudio: false }, { name, isAnimationStudio: true }] } });
  const e = (id, name, status, dates = {}) => ({ status, startedAt: dates.start ? { year: dates.start } : {}, completedAt: dates.done ? { year: dates.done } : {}, media: { ...show(id), ...studio(name) } });
  const entries = [
    e(1, 'Old Dated', 'COMPLETED', { start: 2024 }),       // ridden before
    e(2, 'Old Dated', 'CURRENT', { start: 2026 }),
    e(3, 'Imported', 'COMPLETED'),                         // no dates, not ridden this year: counts as earlier
    e(4, 'Imported', 'CURRENT'),
    e(5, 'Fresh', 'CURRENT', { start: 2026 }),             // a new district
    e(6, 'Fresh', 'COMPLETED'),
    e(7, 'Planned Only', 'PLANNING', { start: 2020 }),     // planning isn't riding
    e(8, 'Planned Only', 'CURRENT'),
    e(9, 'Undated Rider', 'COMPLETED'),                    // no dates, but ridden this year: new
    e(10, 'Finished Earlier', 'COMPLETED', { done: 2025 }),
    e(11, 'Finished Earlier', 'CURRENT'),
    e(12, 'Later', 'COMPLETED', { start: 2027 }),          // ridden after the year: doesn't make it old
    e(13, 'Later', 'CURRENT', { start: 2026 }),
  ];
  const ride = (iso, id) => ep(iso, entries.find(x => x.media.id === id).media);
  const r = review([ride('2026-04-02T12:00', 2), ride('2026-04-03T12:00', 4), ride('2026-04-05T12:00', 6), ride('2026-04-04T12:00', 5),
    ride('2026-04-06T12:00', 8), ride('2026-04-07T12:00', 9), ride('2026-04-08T12:00', 11), ride('2026-04-09T12:00', 13)], 2026, { ...UTC, entries });
  assert.deepEqual(r.districts.map(d => [d.name, d.media.id, d.day]), [
    ['Fresh', 5, '2026-04-04'], ['Planned Only', 8, '2026-04-06'], ['Undated Rider', 9, '2026-04-07'], ['Later', 13, '2026-04-09'],
  ]);
  assert.equal(studioOf(entries[0].media), 'Old Dated', 'the animation studio, not the producer');
});

test('shows completed this year, each once, in the order they were finished', () => {
  const a = show(1), b = show(2);
  const r = review([act('2026-05-02T12:00', b, 'completed', null), act('2026-05-01T12:00', a, 'completed', null), act('2026-05-03T12:00', a, 'completed', null),
    act('2025-05-03T12:00', show(3), 'completed', null)], 2026, UTC);
  assert.deepEqual(r.completed.map(c => [c.media.id, c.day]), [[1, '2026-05-01'], [2, '2026-05-02']]);
});

test('completions logged in one go are pointed out, and still counted', () => {
  const t = i => new Date(Date.UTC(2026, 4, 3, 19) + i * 60_000).toISOString().slice(0, 16);
  const burst = Array.from({ length: 25 }, (_, i) => act(t(i), show(100 + i), 'completed', null)); // a minute apart
  const spread = Array.from({ length: 25 }, (_, i) => act(`2026-06-${String(i + 1).padStart(2, '0')}T12:00`, show(200 + i), 'completed', null));
  const r = review([...burst, ...spread], 2026, UTC);
  assert.equal(r.completed.length, 50);
  assert.deepEqual(r.bulk, { shows: 25, day: '2026-05-03' });
  assert.equal(review(spread, 2026, UTC).bulk, null, 'a show a day is just riding');
  assert.equal(review(burst.slice(0, 19), 2026, UTC).bulk, null, 'a short binge of finales is not a batch');
});

test('first and last ride of the year', () => {
  const r = review([ep('2026-08-01T12:00', show(2), '5'), act('2026-01-01T09:00', show(9), 'plans to watch', null), ep('2026-01-03T12:00', show(1), '1 - 2')], 2026, UTC);
  assert.equal(r.first.media.id, 1);
  assert.equal(r.first.verb, 'Watched episodes 1–2 of');
  assert.equal(r.last.media.id, 2);
});

test('an empty year', () => {
  const r = review([], 2025);
  assert.deepEqual({ ...r, months: undefined }, {
    year: 2025, logs: 0, eps: 0, minutes: 0, days: 0, shows: 0, streak: null, months: undefined, busiestMonth: null,
    lines: [], busiest: null, completed: [], bulk: null, districts: [], first: null, last: null,
  });
  assert.equal(r.months.length, 12);
});

test('a nearly empty year: only plans, then a single episode', () => {
  const plans = review([act('2026-07-01T12:00', show(1), 'plans to watch', null)], 2026, UTC);
  assert.equal(plans.logs, 1);
  assert.equal(plans.days, 0);
  assert.equal(plans.streak, null);
  assert.equal(plans.busiest, null);
  assert.equal(plans.first, null);
  const one = review([ep('2026-07-01T12:00', show(1))], 2026, UTC);
  assert.deepEqual(one.streak, { days: 1, from: '2026-07-01', to: '2026-07-01' });
  assert.equal(one.busiest.eps, 1);
  assert.equal(one.busiestMonth, 6);
  assert.equal(one.first.at, one.last.at);
});

// ---- loading ------------------------------------------------------------------
const deferred = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };
const tick = () => new Promise(r => setTimeout(r, 0));

test('the loader reads a year page by page until there are no more', async () => {
  const asked = [];
  const loader = yearLoader(async (y, p) => { asked.push([y, p]); return { acts: [{ id: y * 10 + p }], more: p < 3 }; });
  const s = await loader.load(2026);
  assert.deepEqual(asked, [[2026, 1], [2026, 2], [2026, 3]]);
  assert.deepEqual(s.acts.map(a => a.id), [20261, 20262, 20263]);
  assert.equal(s.more, false);
  await loader.load(2026);
  assert.equal(asked.length, 3, 'a loaded year is kept, not asked for again');
});

test('switching years mid-load never mixes them, and the first year carries on where it stopped', async () => {
  const pending = [];
  const seen = [];
  const loader = yearLoader((y, p) => { const d = deferred(); pending.push({ y, p, d }); return d.p; }, (y, s) => seen.push([y, s.pages, loader.active]));
  const first = loader.load(2026);
  await tick();
  pending.shift().d.resolve({ acts: [{ id: 1 }], more: true }); // 2026 page 1
  await tick();
  const second = loader.load(2025);                              // the rider switches while 2026 page 2 is in flight
  await tick();
  assert.deepEqual(pending.map(x => [x.y, x.p]), [[2026, 2], [2025, 1]]);
  pending.shift().d.resolve({ acts: [{ id: 2 }], more: true });  // 2026 page 2 lands late
  pending.shift().d.resolve({ acts: [{ id: 50 }], more: false });
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a.acts.map(x => x.id), [1, 2], '2026 keeps its own pages');
  assert.equal(a.more, true, '2026 stopped after the page in flight');
  assert.deepEqual(b.acts.map(x => x.id), [50]);
  assert.equal(pending.length, 0, 'no more 2026 pages were asked for while 2025 was showing');
  assert.deepEqual(seen.filter(([y, , active]) => y !== active), [[2026, 2, 2025]], 'the late page told the page it no longer belongs to the active year');

  const back = loader.load(2026);
  await tick();
  assert.deepEqual(pending.map(x => [x.y, x.p]), [[2026, 3]], 'back on 2026 it picks up at page 3');
  pending.shift().d.resolve({ acts: [{ id: 3 }, { id: 2 }], more: false }); // a repeat from a shifted page
  assert.deepEqual((await back).acts.map(x => x.id), [1, 2, 3], 'each activity once');
});

test('switching back before the old page lands does not start a second load', async () => {
  const pending = [];
  const loader = yearLoader((y, p) => { const d = deferred(); pending.push({ y, p, d }); return d.p; });
  const one = loader.load(2026);
  await tick();
  loader.load(2025);
  const two = loader.load(2026);
  await tick();
  assert.deepEqual(pending.map(x => [x.y, x.p]), [[2026, 1], [2025, 1]]);
  pending.shift().d.resolve({ acts: [{ id: 1 }], more: true });
  await tick();
  assert.deepEqual(pending.map(x => [x.y, x.p]), [[2025, 1], [2026, 2]], '2026 carries on, once');
  pending.pop().d.resolve({ acts: [{ id: 2 }], more: false });
  assert.equal(await one, await two);
});

test('a failed page is asked for again', async () => {
  let fail = true;
  const asked = [];
  const loader = yearLoader(async (y, p) => {
    asked.push(p);
    if (p === 2 && fail) { fail = false; throw new Error("Couldn't reach AniList."); }
    return { acts: [{ id: p }], more: p < 3 };
  });
  await assert.rejects(loader.load(2026), /reach AniList/);
  assert.equal(loader.get(2026).pages, 1);
  assert.match(loader.get(2026).error.message, /reach AniList/);
  const s = await loader.load(2026);
  assert.deepEqual(asked, [1, 2, 2, 3]);
  assert.deepEqual(s.acts.map(a => a.id), [1, 2, 3]);
  assert.equal(s.error, null);
});
