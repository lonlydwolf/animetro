import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { riderList, listedStatus } from '../web/js/plan.js';

const rider = { id: 5, name: 'rider', canWrite: true };
const offline = async () => { throw new Error("Couldn't reach AniList."); };
// listedStatus over a scripted AniList answer
const over = answer => (u, ids) => listedStatus(u, ids, async () => answer());

test('who you are failing makes the page read-only with that reason', async () => {
  let asked = 0;
  const r = await riderList([1], { rider: offline, lookup: async () => { asked++; return new Map(); } });
  assert.equal(r.user, null);
  assert.equal(r.list.size, 0);
  assert.match(r.error.message, /Couldn't reach AniList/);
  assert.equal(asked, 0);
});

test('logged out is not an error and asks nothing', async () => {
  let asked = 0;
  const r = await riderList([1], { rider: async () => null, lookup: async () => { asked++; return new Map(); } });
  assert.deepEqual([r.user, r.list.size, r.error, asked], [null, 0, null, 0]);
});

test("a list that can't be read is an error, not a list with nothing on it", async () => {
  for (const answer of [
    () => { throw new Error('Internal Server Error'); }, // request failed
    () => ({ p0: null }), // a page missing from a partial answer
    () => ({ p0: { mediaList: [{ mediaId: null, status: 'CURRENT' }] } }), // an entry we can't pin to a show
  ]) {
    const r = await riderList([1, 2], { rider: async () => rider, lookup: over(answer) });
    assert.equal(r.user, null, 'read-only: no write controls');
    assert.equal(r.list.size, 0);
    assert.match(r.error.message, /didn't answer/);
  }
});

test('a list that was read: listed shows have their entry, missing ones are confirmed absent', async () => {
  const r = await riderList([1, 2], { rider: async () => rider, lookup: over(() => ({ p0: { mediaList: [{ mediaId: 1, status: 'CURRENT', progress: 3 }] } })) });
  assert.equal(r.user, rider);
  assert.equal(r.error, null);
  assert.equal(r.list.get(1).progress, 3);
  assert.equal(r.list.has(2), false);
});
