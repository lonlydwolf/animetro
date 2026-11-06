import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { franchises, districts, snake } from '../web/js/map.js';

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
