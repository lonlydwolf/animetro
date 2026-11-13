// saveChecked(): list changes are checked against AniList at the click and saved only where the entry is still
// what the page showed (Audit N1 class: Line's Add to Planning, the anime page's controls, +1 buttons).
import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveChecked, addToPlanning, planReport, unchanged } from '../web/js/plan.js';
import { RateLimited } from '../web/js/api.js';

const USER = { id: 42, canWrite: true };
const entry = (mediaId, status, progress = 0) => ({ mediaId, status, progress });
// deps whose list is `list` (Map id -> entry); records what was asked and saved
function rig(list, { rider = async () => USER, save, tok = () => 'account-A', lookup } = {}) {
  const asks = [], saves = [];
  return {
    asks, saves,
    deps: {
      rider, token: tok,
      lookup: lookup || (async (user, ids, _q, opts) => (asks.push({ user, ids, opts }), new Map(ids.filter(id => list.has(id)).map(id => [id, list.get(id)])))),
      save: save || (async (entries, opts) => (saves.push({ entries, opts }), Object.fromEntries(entries.map((e, i) => [`m${i}`, { ...e, progress: e.progress ?? 0 }])))),
    },
  };
}

test('unchanged: absent stays absent; a shown entry must still have the same status and progress', () => {
  assert.equal(unchanged(undefined, undefined), true);
  assert.equal(unchanged(undefined, entry(1, 'COMPLETED')), false);
  assert.equal(unchanged(entry(1, 'CURRENT', 3), entry(1, 'CURRENT', 3)), true);
  assert.equal(unchanged(entry(1, 'CURRENT', 3), entry(1, 'CURRENT', 5)), false);
  assert.equal(unchanged(entry(1, 'PLANNING'), entry(1, 'COMPLETED', 12)), false);
  assert.equal(unchanged(entry(1, 'CURRENT', 3), undefined), false);
  assert.equal(unchanged({ status: 'PLANNING' }, { status: 'PLANNING', progress: null }), true);
});

test('Add to Planning: one fresh, account-checked lookup; one single-attempt save of only the confirmed-absent ids', async () => {
  const r = rig(new Map([[2, entry(2, 'COMPLETED', 12)], [4, entry(4, 'CURRENT', 3)]]));
  const out = await addToPlanning([1, 2, 3, 4, 5], r.deps);
  assert.deepEqual(r.asks, [{ user: USER, ids: [1, 2, 3, 4, 5], opts: { viewer: true, fresh: true } }]);
  assert.deepEqual(r.saves, [{ entries: [1, 3, 5].map(id => ({ mediaId: id, status: 'PLANNING' })), opts: { retry: false } }]);
  assert.deepEqual([...out.saved.keys()], [1, 3, 5]);
  assert.deepEqual([...out.changed], [[2, entry(2, 'COMPLETED', 12)], [4, entry(4, 'CURRENT', 3)]]);
  assert.equal(planReport(out, 5), 'Added 3 to Planning; 2 were already on your list.');
});

test('everything already on the list: nothing is sent', async () => {
  const r = rig(new Map([[7, entry(7, 'COMPLETED', 12)]]));
  const out = await addToPlanning([7], r.deps);
  assert.deepEqual(r.saves, []);
  assert.equal(planReport(out, 1), "It's already on your list, so nothing was changed.");
  const two = rig(new Map([[7, entry(7, 'DROPPED')], [8, entry(8, 'PAUSED')]]));
  assert.equal(planReport(await addToPlanning([7, 8], two.deps), 2), 'Both were already on your list, so nothing was added.');
  const three = rig(new Map([7, 8, 9].map(id => [id, entry(id, 'COMPLETED')])));
  assert.equal(planReport(await addToPlanning([7, 8, 9], three.deps), 3), 'All 3 were already on your list, so nothing was added.');
  assert.equal(planReport(await addToPlanning([7, 8, 10], three.deps), 3), 'Added 1 to Planning; 2 were already on your list.');
});

test('a change to a shown entry goes through only if it is still what the page showed', async () => {
  const r = rig(new Map([[1, entry(1, 'CURRENT', 5)], [2, entry(2, 'CURRENT', 3)]]));
  const out = await saveChecked([
    { id: 1, seen: entry(1, 'CURRENT', 3), change: { progress: 4 } }, // watched to 5 elsewhere: +1 from 3 would lower it
    { id: 2, seen: entry(2, 'CURRENT', 3), change: { progress: 4 } },
  ], r.deps);
  assert.deepEqual(r.saves.map(s => s.entries), [[{ mediaId: 2, progress: 4 }]]);
  assert.deepEqual(out.changed.get(1), entry(1, 'CURRENT', 5));
  assert.equal(out.saved.get(2).progress, 4);
});

test('a shown entry that is gone now is reported as changed (null), not recreated', async () => {
  const r = rig(new Map());
  const out = await saveChecked([{ id: 1, seen: entry(1, 'PLANNING'), change: { status: 'CURRENT', progress: 1 } }], r.deps);
  assert.deepEqual(r.saves, []);
  assert.equal(out.changed.get(1), null);
});

test('rate-limited: nothing saved, and the rider is told AniList is busy', async () => {
  const r = rig(new Map(), { save: async () => { throw new RateLimited(); } });
  const out = await addToPlanning([1, 2], r.deps);
  assert.equal(out.rateLimited, true);
  assert.equal(out.saved.size, 0);
  assert.equal(planReport(out, 2), 'AniList is busy right now, so nothing was added. Try again in a moment.');
});

test("the list can't be checked, or the account changes during the check: nothing is sent", async () => {
  const failed = rig(new Map(), { lookup: async () => null });
  const out = await addToPlanning([1, 2], failed.deps);
  assert.deepEqual([out.unknown, failed.saves], [[1, 2], []]);
  assert.equal(planReport(out, 2), "Couldn't check your list, so nothing was added. Try again in a moment.");
  let tok = 'account-A';
  const switched = rig(new Map(), { tok: () => tok, lookup: async () => { tok = 'account-B'; return new Map(); } });
  assert.deepEqual((await addToPlanning([1], switched.deps)).unknown, [1]);
  assert.deepEqual(switched.saves, []);
});

test("who you are can't be read, or can't write: no lookup and no save", async () => {
  const gone = rig(new Map(), { rider: async () => { throw new Error('offline'); } });
  assert.deepEqual((await addToPlanning([1], gone.deps)).unknown, [1]);
  const ro = rig(new Map(), { rider: async () => ({ id: 42, canWrite: false }) });
  const out = await addToPlanning([1], ro.deps);
  assert.equal(out.readOnly, true);
  assert.deepEqual([gone.asks.length, gone.saves.length, ro.asks.length, ro.saves.length], [0, 0, 0, 0]);
});

test('a batch AniList only partly saves: report what went in and what did not', async () => {
  const err = Object.assign(new Error('Saved 2 of 3. The rest didn\'t go through; try again.'), { saved: [1, 3] });
  const r = rig(new Map(), { save: async () => { throw err; } });
  const out = await addToPlanning([1, 2, 3], r.deps);
  assert.deepEqual([[...out.saved.keys()], out.unknown], [[1, 3], [2]]);
  assert.equal(planReport(out, 3), "Added 2 to Planning; 1 didn't go through (Saved 2 of 3. The rest didn't go through; try again); try again.");
});

test('current() false after the lookup: dropped without saving', async () => {
  const r = rig(new Map());
  const out = await addToPlanning([1], { ...r.deps, current: () => false });
  assert.equal(out.stale, true);
  assert.deepEqual(r.saves, []);
});

test('an empty selection asks nothing', async () => {
  const r = rig(new Map());
  const out = await addToPlanning([], r.deps);
  assert.deepEqual([r.asks.length, r.saves.length, out.saved.size], [0, 0, 0]);
});
