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
// identity: who the page acts for, read synchronously at the click ({ riderId, canWrite, account })
function rig(list, { identity, save, tok = () => 'account-A', lookup } = {}) {
  const asks = [], saves = [];
  return {
    asks, saves,
    deps: {
      identity: identity || (() => ({ riderId: USER.id, canWrite: true, account: tok() })),
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
  assert.deepEqual(r.asks, [{ user: USER, ids: [1, 2, 3, 4, 5], opts: { viewer: true, fresh: true, reserved: true } }]);
  assert.deepEqual(r.saves, [{ entries: [1, 3, 5].map(id => ({ mediaId: id, status: 'PLANNING' })), opts: { retry: false, reserved: true } }]);
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
  const gone = rig(new Map(), { identity: () => undefined }); // me() never resolved
  assert.deepEqual((await addToPlanning([1], gone.deps)).unknown, [1]);
  const ro = rig(new Map(), { identity: () => ({ riderId: 42, canWrite: false, account: 'u:someone' }) });
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

// ---- the click belongs to the account that made it (review: queued clicks crossing accounts) ----
const deferred = () => { let resolve; const promise = new Promise(r => (resolve = r)); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
// deps for a token that can be switched; the rider is whoever the current token belongs to
function accounts() {
  const state = { tok: 'A', saves: [], asks: [] };
  state.deps = {
    identity: () => ({ riderId: state.tok === 'A' ? 42 : 77, canWrite: true, account: state.tok }),
    lookup: async (user, ids) => (state.asks.push({ user: user.id, tok: state.tok, ids }), new Map()),
    save: async entries => (state.saves.push({ tok: state.tok, entries }), { m0: { ...entries[0], progress: 0 } }),
    room: async () => {},
  };
  return state;
}

test('switch while a click waits for rate-limit room: dropped, nothing checked or saved as the new account', async () => {
  const s = accounts(), room = deferred();
  const queued = saveChecked([{ id: 123, change: { status: 'PLANNING' } }], { ...s.deps, room: () => room.promise });
  await flush();
  s.tok = 'B'; room.resolve();
  const r = await queued;
  assert.equal(r.accountChanged, true);
  assert.deepEqual([r.saved.size, s.asks.length, s.saves.length], [0, 0, 0]);
  assert.equal(planReport(r, 1), 'You signed in as a different AniList account since that click, so nothing was saved.');
});

test('switch while a click waits its turn in the queue: dropped too', async () => {
  const s = accounts(), check = deferred();
  const first = saveChecked([{ id: 1, change: { status: 'PLANNING' } }], { ...s.deps, lookup: async () => check.promise });
  const second = saveChecked([{ id: 2, change: { status: 'PLANNING' } }], s.deps); // queued behind the first
  await flush();
  s.tok = 'B'; check.resolve(new Map());
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual([a.accountChanged, b.accountChanged], [true, true]);
  assert.deepEqual(s.saves, []);
  assert.deepEqual(s.asks, []);
});

test('switch during the check: dropped right before the save', async () => {
  const s = accounts(), check = deferred();
  const r = saveChecked([{ id: 3, change: { status: 'PLANNING' } }], { ...s.deps, lookup: async () => check.promise });
  await flush();
  s.tok = 'B'; check.resolve(new Map());
  assert.equal((await r).accountChanged, true);
  assert.deepEqual(s.saves, []);
});

test('same token but a different rider by the time it runs: dropped', async () => {
  const s = accounts(), room = deferred();
  let id = 42;
  const r = saveChecked([{ id: 4, change: { status: 'PLANNING' } }], { ...s.deps, identity: () => ({ riderId: id, canWrite: true, account: 'A' }), room: () => room.promise });
  await flush();
  id = 77; room.resolve();
  assert.equal((await r).accountChanged, true);
  assert.deepEqual(s.saves, []);
});

test('no switch: the queued click still goes through as the account that made it', async () => {
  const s = accounts(), room = deferred();
  const r = saveChecked([{ id: 5, change: { status: 'PLANNING' } }], { ...s.deps, room: () => room.promise });
  await flush(); room.resolve();
  assert.equal((await r).saved.size, 1);
  assert.deepEqual(s.saves.map(x => x.tok), ['A']);
});

test('a lookup that throws or a save that fails does not block the queue', async () => {
  const s = accounts();
  const failed = saveChecked([{ id: 6, change: { status: 'PLANNING' } }], { ...s.deps, lookup: async () => { throw new Error('lookup failed'); } });
  const next = saveChecked([{ id: 7, change: { status: 'PLANNING' } }], s.deps);
  await assert.rejects(failed, /lookup failed/);
  assert.equal((await next).saved.size, 1);
  const [bad, good] = await Promise.all([
    saveChecked([{ id: 8, change: { status: 'PLANNING' } }], { ...s.deps, save: async () => { throw new Error('save failed'); } }),
    saveChecked([{ id: 9, change: { status: 'PLANNING' } }], s.deps),
  ]);
  assert.match(bad.error.message, /save failed/);
  assert.equal(good.saved.size, 1);
});

// ---- the identity is taken synchronously, as the click is made (review: rider boundary) ----
function riders() {
  const state = { id: 42, saves: [] };
  state.deps = {
    identity: () => ({ riderId: state.id, canWrite: true, account: 'unchanged-token' }), // same token throughout
    room: async () => {}, lookup: async () => new Map(),
    save: async entries => (state.saves.push({ id: state.id, entries }), { m0: { ...entries[0], progress: 0 } }),
  };
  return state;
}

test('rider changes (same token) right after saveChecked() returns: the click stays 42\'s and is dropped', async () => {
  const s = riders();
  const r = saveChecked([{ id: 1, change: { status: 'PLANNING' } }], s.deps);
  s.id = 77; // before any microtask has run
  const out = await r;
  assert.equal(out.accountChanged, true);
  assert.deepEqual([out.saved.size, s.saves.length], [0, 0]);
});

test('rider changes (same token) while the check is out: dropped right before the save', async () => {
  const s = riders(), check = deferred();
  const r = saveChecked([{ id: 2, change: { status: 'PLANNING' } }], { ...s.deps, lookup: () => check.promise });
  await flush();
  s.id = 77; check.resolve(new Map());
  const out = await r;
  assert.equal(out.accountChanged, true);
  assert.deepEqual([out.saved.size, s.saves.length], [0, 0]);
});

test('no identity to read at the click (the page never learned who you are): refused, nothing asked or saved', async () => {
  const s = riders(), asks = [];
  const out = await saveChecked([{ id: 3, change: { status: 'PLANNING' } }], { ...s.deps, identity: () => undefined, lookup: async () => (asks.push(1), new Map()) });
  assert.deepEqual([out.unknown, out.accountChanged, asks.length, s.saves.length], [[3], false, 0, 0]);
  assert.equal(planReport(out, 1), "Couldn't check your list, so nothing was added. Try again in a moment.");
});
