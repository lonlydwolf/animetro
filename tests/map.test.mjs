import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { franchises, districts, snake, ride } from '../web/js/map.js';

const md = (id, year, rel = {}, extra = {}) => ({ id, type: 'ANIME', format: 'TV', status: 'FINISHED', popularity: id, startDate: { year },
  studios: { nodes: [{ name: 'Studio A', isAnimationStudio: true }] }, title: { romaji: 'S' + id },
  relations: { edges: Object.entries(rel).flatMap(([t, ids]) => ids.map(n => ({ relationType: t, node: { id: n, type: 'ANIME', format: 'TV', status: n === 99 ? 'NOT_YET_RELEASED' : 'FINISHED', startDate: { year: 2030 }, title: { romaji: 'S' + n } } }))) }, ...extra });
const lines = franchises([
  { status: 'COMPLETED', progress: 12, media: md(1, 2010, { SEQUEL: [2] }) },
  { status: 'CURRENT', progress: 3, media: md(2, 2012, { PREQUEL: [1], SEQUEL: [3] }) },  // 3 isn't on the list: an unridden stop
  { status: 'PLANNING', progress: 0, media: md(4, 2015, { SPIN_OFF: [1] }) },            // planning only, and spin-offs don't join lines
  { status: 'COMPLETED', progress: 1, media: md(5, 2020, { SEQUEL: [99] }, { studios: { nodes: [{ name: 'Aniplex', isAnimationStudio: false }, { name: 'Studio A', isAnimationStudio: true }] } }) },
]);

test('only franchises you have ridden become lines, with unridden next stops included', () => {
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0].stations.map(s => [s.id, s.state]), [[1, 'done'], [2, 'here'], [3, 'unridden']]);
  assert.ok(lines[0].riding && !lines[0].complete);
});

test('an unreleased stop does not count against riding a line end to end', () => {
  assert.deepEqual(lines[1].stations.map(s => s.state), ['done', 'soon']);
  assert.ok(lines[1].complete);
});

test('lines from one animation studio (not a producer) form a district', () => {
  assert.equal(districts(lines)[0].name, 'Studio A');
});

test('long lines snake: left to right, U-turn, right to left', () => {
  const sn = snake(10, 300, { gap: 64, pad: 34 });
  assert.equal(sn.per, 4);
  assert.deepEqual(sn.pts.slice(3, 6).map(p => [p.x, p.row]), [[226, 0], [226, 1], [162, 1]]);
  assert.equal(sn.pts.at(-1).row, 2);
});

test('stations get Express/Rapid/Local, and a service view recounts the line', () => {
  const big = (id, extra) => ({ ...md(id, 2015, {}, extra), popularity: { 10: 100000, 11: 2000, 12: 40000 }[id] });
  const [l] = franchises([
    { status: 'COMPLETED', progress: 12, media: { ...big(10), relations: { edges: [
      { relationType: 'SIDE_STORY', node: { id: 11, type: 'ANIME', format: 'OVA', status: 'FINISHED', popularity: 2000, startDate: { year: 2016 }, title: { romaji: 'OVA' } } },
      { relationType: 'SIDE_STORY', node: { id: 12, type: 'ANIME', format: 'MOVIE', status: 'FINISHED', popularity: 40000, startDate: { year: 2017 }, title: { romaji: 'Movie' } } }] } } },
  ], new Date(2026, 0, 1));
  assert.deepEqual(l.stations.map(s => [s.id, s.svc]), [[10, 'express'], [11, 'local'], [12, 'rapid']]);
  assert.ok(!l.complete);
  const ex = ride(l, 'express');
  assert.deepEqual([ex.total, ex.done, ex.complete], [1, 1, true]);
  assert.equal(ride(l, 'rapid').total, 2);
  assert.equal(ride(l, 'local'), l);
});

test('rewind shows the network as it stood at the end of a year', async () => {
  const { rewind, firstYear } = await import('../web/js/map.js');
  const st = (id, year, extra) => ({ status: 'COMPLETED', progress: 12, ...extra, media: md(id, year, extra.rel || {}) });
  const ls = franchises([
    st(1, 2010, { completedAt: { year: 2018, month: 3 }, startedAt: { year: 2018 }, rel: { SEQUEL: [2] } }),
    st(2, 2012, { completedAt: { year: 2021 }, startedAt: { year: 2020 }, rel: { PREQUEL: [1], SEQUEL: [3] } }),
    st(3, 2022, { status: 'CURRENT', progress: 3, startedAt: { year: 2024 }, rel: { PREQUEL: [2] } }),
    st(10, 2015, { completedAt: { year: 2023 } }),
    st(20, 2005, { completedAt: null }), // finished, but no date at all: the siding
    st(30, 2001, { completedAt: null, updatedAt: Date.UTC(2019, 5, 1) / 1000 }), // no finish date: when it was last changed
  ]);
  assert.equal(firstYear(ls), 2018);
  const at = y => rewind(ls, y);
  assert.deepEqual(at(2017).lines.length, 0, 'nothing boarded yet');
  assert.deepEqual(at(2020).lines.find(l => l.total === 3).stations.map(s => s.state), ['done', 'here', 'soon'], '2020: on season 2, season 3 not out');
  assert.deepEqual(at(2024).lines.find(l => l.total === 3).stations.map(s => s.state), ['done', 'done', 'here']);
  assert.equal(at(2024).lines.length, 3, 'the 2023 line and the 2019 estimate have joined; the undated one waits');
  assert.equal(at(2024).siding, 1);
  assert.equal(at(2024).approx, 1);
  assert.equal(at(2018).lines.length, 1, 'the estimate only appears from 2019');
  assert.equal(at(2018).siding, 1, 'the siding count doesn\'t depend on the year');
});
