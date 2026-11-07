import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crawl, classify, storyOrder, byDate, service } from '../web/js/order.js';

const m = (id, format, year, rel = {}, popularity = 100) => ({
  id, format, popularity, isAdult: false, startDate: { year, month: 1, day: 1 },
  relations: { edges: Object.entries(rel).flatMap(([type, ids]) => ids.map(n => ({ relationType: type, node: { id: n, type: 'ANIME' } }))) },
});
// A tiny fake franchise: 1 and 2 are the TV series, 3 a prequel movie released later, 4 an OVA side story,
// 5 a recap film, 6 a spin-off (whose sequel 8 must never be fetched), 7 an alternate version, 9 a music video.
const db = new Map([
  m(1, 'TV', 2009, { SEQUEL: [2], SIDE_STORY: [4, 9], SUMMARY: [5], PREQUEL: [3], SPIN_OFF: [6], ALTERNATIVE: [7] }, 900),
  m(2, 'TV', 2012, { PREQUEL: [1] }),
  m(3, 'MOVIE', 2016, { SEQUEL: [1] }),
  m(4, 'OVA', 2010, { PARENT: [1] }),
  m(5, 'MOVIE', 2013, { PARENT: [1] }),
  m(6, 'TV', 2015, { SEQUEL: [8] }),
  m(7, 'TV', 2020),
  m(8, 'TV', 2018),
  m(9, 'MUSIC', 2011, { PARENT: [1] }),
].map(x => [x.id, x]));

test('crawl and classify a franchise into main, side, recap and transfers', async () => {
  const asked = [];
  const graph = await crawl(2, async ids => { asked.push(...ids); return ids.map(id => db.get(id)); });
  assert.ok(!asked.includes(8), 'spin-off relations are not walked');
  const { stops, transfers, anchor } = classify(2, graph);
  const role = id => stops.concat(transfers).find(s => s.id === id)?.role;
  assert.equal(anchor.id, 1);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(role), ['main', 'main', 'main', 'side', 'recap', 'Spin-off', 'Alternate version']);
  assert.equal(role(9), undefined, 'music videos are hidden');
  assert.deepEqual([...stops].sort(byDate).map(s => s.id), [1, 4, 2, 5, 3], 'release order');
  assert.deepEqual(storyOrder(stops).map(s => s.id), [3, 1, 4, 2, 5], 'story order puts the prequel film first');
});

test('18+ entries only appear when asked for', () => {
  const graph = { media: new Map([[1, { ...m(1, 'TV', 2020), popularity: 5 }], [2, { ...m(2, 'OVA', 2021), isAdult: true }]]), want: new Map([[1, true], [2, true]]), expanded: new Set([1, 2]) };
  assert.equal(classify(1, graph).stops.length, 1);
  assert.equal(classify(1, graph, { adult: true }).stops.length, 2);
});

test('an upcoming sequel without a format yet is still main story', () => {
  const graph = { media: new Map([[1, { ...m(1, 'TV', 2020, { SEQUEL: [2] }), popularity: 9 }], [2, { ...m(2, null, 2027, { PREQUEL: [1] }), status: 'NOT_YET_RELEASED' }]]), want: new Map([[1, true], [2, true]]), expanded: new Set([1, 2]) };
  assert.equal(classify(1, graph).stops.find(s => s.id === 2).role, 'main');
});

test('Express, Rapid and Local services judge extras by how many fans watched them', () => {
  const anchor = { popularity: 740000 };
  const stop = (role, popularity, extra = {}) => ({ role, popularity, format: 'MOVIE', duration: 100, ...extra });
  const now = new Date(2026, 10, 6);
  assert.equal(service(stop('main', 400000), anchor).level, 'express');
  assert.equal(service(stop('main', 20000), anchor).level, 'local', 'a "sequel" movie almost nobody watched is a compilation');
  assert.equal(service(stop('main', 20000, { format: 'TV' }), anchor).level, 'express', 'a TV season is never demoted');
  assert.deepEqual(service(stop('side', 60000), anchor), { level: 'local', why: "on only 8% of fans' lists" });
  assert.equal(service(stop('side', 300000), anchor).level, 'rapid');
  assert.equal(service(stop('side', 400000, { duration: 12, format: 'SPECIAL' }), anchor).why, '12-minute extra');
  assert.equal(service(stop('side', 400000, { tags: [{ name: 'Chibi' }] }), anchor).level, 'local');
  assert.equal(service(stop('recap', 400000), anchor).level, 'local');
  assert.equal(service(stop('side', 100), anchor).why, "on fewer than 1% of fans' lists");
  assert.equal(service(stop('side', 2000, { status: 'NOT_YET_RELEASED' }), anchor).level, 'rapid', 'too early to judge');
  assert.equal(service(stop('main', 20000, { startDate: { year: 2026, month: 8 } }), anchor, now).level, 'express', 'a new movie with few adds yet');
  assert.equal(service(stop('side', 20000, { startDate: { year: 2026, month: 8 } }), anchor, now).why, 'new, too early to judge');
  assert.equal(service(stop('main', 20000, { startDate: { year: 2025, month: 11 } }), anchor, now).level, 'local', 'a year out and still unwatched');
});

test('junctions hang spin-offs and other versions off the stop they branch from', async () => {
  const { junctions } = await import('../web/js/order.js');
  const st = (id, year, edges = []) => ({ id, startDate: { year }, relations: { edges: edges.map(([relationType, node]) => ({ relationType, node: { id: node } })) } });
  const s1 = st(1, 2003, [['ALTERNATIVE', 9]]), s2 = st(2, 2005, [['SIDE_STORY', 3]]), s3 = st(3, 2006, [['SPIN_OFF', 8]]), s4 = st(4, 2010);
  const remake = { ...st(9, 2009), role: 'Alternate version' }, spin = { ...st(8, 2007), role: 'Spin-off' }, loose = { ...st(7, 2008), role: 'Spin-off' };
  const all = [s1, s2, s3, s4];
  const j = junctions(all, all, [remake, spin, loose]);
  assert.deepEqual(j.get(1).map(x => [x.media.id, x.kind, x.earlier]), [[9, 'alt', false]]);
  assert.deepEqual(j.get(3).map(x => [x.media.id, x.kind]), [[8, 'spin'], [7, 'spin']], 'no link: placed by date');
  const express = junctions([s1, s4], all, [spin]);
  assert.deepEqual([...express.keys()], [1], 'a hidden branch stop hands its junction to the stop before it');
});
