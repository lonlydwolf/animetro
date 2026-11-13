import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSlot, listedStatus, slotState, planBoard, saveChecked } from '../web/js/plan.js';
import { listStatus, logout, me, identity } from '../web/js/api.js';

const USER = { id: 42, canWrite: true };

test('a show already on your list shows its status, never + Planning (Audit N1)', () => {
  for (const [status, label] of [['COMPLETED', 'Completed'], ['CURRENT', 'Watching'], ['DROPPED', 'Dropped'], ['PAUSED', 'Paused'], ['PLANNING', 'Planning'], ['REPEATING', 'Rewatching']]) {
    const html = planSlot(1, { status, progress: 3 }, true);
    assert.doesNotMatch(html, /data-plan/, status);
    assert.equal(html, `<span class="tag s-${status}">${label}</span>`);
  }
});

test('a show confirmed absent offers + Planning only when you can write', () => {
  assert.equal(planSlot(42, undefined, true), '<button class="tag add" data-plan="42">+ Planning</button>');
  assert.equal(planSlot(42, undefined, false), '');
  assert.equal(planSlot(42, undefined, undefined), '');
});

test('when the list could not be checked there is no add, only a check-again button', () => {
  const html = planSlot(42, undefined, true, false);
  assert.doesNotMatch(html, /data-plan/);
  assert.match(html, /data-recheck="42"/);
  assert.equal(planSlot(42, undefined, false, false), '');
});

test('read-only riders still see the status they have', () => {
  assert.equal(planSlot(1, { status: 'COMPLETED' }, false), '<span class="tag s-COMPLETED">Completed</span>');
});

test('odd values cannot break out of the markup', () => {
  assert.equal(planSlot('1" onclick="x', undefined, true), '<button class="tag add" data-plan="NaN">+ Planning</button>');
  assert.equal(planSlot(1, { status: '"><img src=x>' }, true), planSlot(1, undefined, true, false), 'an unknown status is just unknown');
});

// Partial GraphQL answers can carry an entry whose status is nulled out. Any entry means "on your list".
const ODD = [['null', { mediaId: 1, status: null }], ['missing', { mediaId: 1 }], ['unrecognised', { mediaId: 1, status: 'ARCHIVED' }],
  ['inherited key', { mediaId: 1, status: 'constructor' }], ['proto key', { mediaId: 1, status: '__proto__' }], ['empty', { mediaId: 1, status: '' }]];

test('any existing entry blocks the add; one with an odd status is unknown (N1 re-review)', () => {
  for (const [why, entry] of ODD) {
    assert.equal(slotState(entry), 'unknown', why);
    const html = planSlot(1, entry, true);
    assert.doesNotMatch(html, /data-plan/, why);
    assert.match(html, /data-recheck="1"/, why);
    assert.equal(planSlot(1, entry, false), '', why);
  }
  assert.equal(slotState({ status: 'COMPLETED' }), 'listed');
  assert.equal(slotState(undefined), 'absent');
  assert.equal(slotState(undefined, false), 'unknown');
});

test('listedStatus: a nulled entry or one without a show id makes the whole lookup unknown', async () => {
  assert.equal(await listedStatus(USER, [1, 2], async () => ({ p0: { mediaList: [{ mediaId: 2, status: 'CURRENT' }, null] } })), null);
  assert.equal(await listedStatus(USER, [1], async () => ({ p0: { mediaList: [{ mediaId: null, status: 'COMPLETED' }] } })), null);
  assert.equal(await listedStatus(USER, [1], async () => ({ p0: { mediaList: [{ status: 'COMPLETED' }] } })), null);
});

// The real gql() over a fetch that answers with partial data plus a GraphQL error, as AniList does.
// A signed-in rider (token account-A, profile 42) against a fetch the test controls. logout() first: the identity
// (me()) and the query cache are per page, and each test is a fresh page. me()'s own profile request is answered
// straight away, as AniList would, so it never takes one of the test's answers.
const PROFILE = { id: 42, name: 'Audit', avatar: null, bannerImage: null, siteUrl: null, options: null };
const isProfile = body => /^\{Viewer\{/.test(body.query);
const json = body => new Response(JSON.stringify(body));
function signIn(fetch) {
  logout();
  localStorage.setItem('animetro.token', 'account-A');
  globalThis.fetch = async (url, opts) => (isProfile(JSON.parse(opts.body)) ? json({ data: { Viewer: PROFILE } }) : fetch(url, opts));
}
async function withAniList(answer, fn) {
  const real = globalThis.fetch;
  signIn(async () => json(answer()));
  try { await me(); return await fn(); } finally { globalThis.fetch = real; logout(); } // a page has its rider before it offers saves
}
const partial = entry => () => ({ data: { p0: { mediaList: [entry] } }, errors: [{ message: 'Internal Server Error', path: ['p0', 'mediaList', 0, 'status'] }] });

test('regression (N1 re-review): null/missing/odd status through the real lookup never offers + Planning', async () => {
  for (const [why, entry] of ODD) {
    await withAniList(partial(entry), async () => {
      const mine = await listedStatus(USER, [1]);
      assert.ok(mine?.has(1), why);
      const slot = planSlot(1, mine.get(1), USER.canWrite, !!mine);
      assert.doesNotMatch(slot, /data-plan/, why);
      assert.match(slot, /data-recheck="1"/, why);
    });
  }
});

const deferred = () => { let resolve; const promise = new Promise(r => (resolve = r)); return { promise, resolve }; };
const tick = () => new Promise(r => setImmediate(r));
// A board whose lookups wait until the test answers them, in any order.
function rig({ rider = USER } = {}) {
  const asks = [], saves = [];
  let tok = 'account-A';
  const board = planBoard({
    rider: async () => rider,
    token: () => tok,
    identity: () => ({ riderId: rider?.id ?? null, canWrite: !!rider?.canWrite, account: tok }),
    lookup: (user, ids, _q, opts = {}) => { const d = deferred(); asks.push({ user, ids, opts, ...d }); return d.promise; },
    save: async entries => (saves.push(entries), { m0: { mediaId: entries[0].mediaId, status: entries[0].status } }),
  });
  return { board, asks, saves, switchTo: t => (tok = t) };
}
const listed = (id, status) => new Map([[id, { mediaId: id, status }]]);
const answerAdd = async (r, i, mine) => { await tick(); r.asks[i].resolve(mine); };

test('race 1: concurrent Check list retries, an older answer never overrides a newer one', async () => {
  const r = rig();
  const older = r.board.recheck(1), newer = r.board.recheck(1);
  await tick();
  r.asks[1].resolve(listed(1, null)); // newer: on your list, status nulled
  assert.equal(await newer, 'unknown');
  r.asks[0].resolve(new Map()); // older: "absent", but stale
  assert.equal(await older, 'stale');
  assert.deepEqual(r.asks.map(a => a.opts), [{ fresh: true }, { fresh: true }], 'a retry skips the page cache');
  assert.equal(r.board.state(1), 'unknown');
  assert.doesNotMatch(r.board.slot(1, true), /data-plan/);
});

test('race 2: one record per show, so a later pull that learns Completed updates every card', async () => {
  const r = rig();
  const first = r.board.learn([1]); await tick(); r.asks[0].resolve(new Map()); await first;
  assert.match(r.board.slot(1, true), /data-plan="1"/);
  const second = r.board.learn([1, 2]); await tick(); r.asks[1].resolve(listed(1, 'COMPLETED')); await second;
  assert.equal(r.board.slot(1, true), '<span class="tag s-COMPLETED">Completed</span>');
  assert.match(r.board.slot(2, true), /data-plan="2"/);
});

test('race 2: + Planning from a stale card checks again and never overwrites an existing entry', async () => {
  for (const status of ['COMPLETED', 'CURRENT', 'DROPPED', null]) {
    const r = rig();
    const l = r.board.learn([1]); await tick(); r.asks[0].resolve(new Map()); await l; // the card says absent
    const add = r.board.add(1);
    await answerAdd(r, 1, listed(1, status)); // the fresh lookup says otherwise
    assert.equal(await add, status ? 'listed' : 'unknown', String(status));
    assert.deepEqual(r.saves, [], String(status));
    assert.deepEqual(r.asks[1].opts, { viewer: true, fresh: true, reserved: true });
    assert.doesNotMatch(r.board.slot(1, true), /data-plan/);
  }
});

test('race 3: a lookup that resolves after the account changed is unknown', async () => {
  const r = rig();
  const l = r.board.learn([99]); await tick();
  r.switchTo('account-B');
  r.asks[0].resolve(new Map());
  await l;
  assert.equal(r.board.state(99), 'unknown');
  const re = r.board.recheck(99); await tick(); r.switchTo('account-C'); r.asks[1].resolve(new Map());
  assert.equal(await re, 'unknown');
});

test('race 3: the account changing during the + Planning check sends nothing', async () => {
  const r = rig();
  const add = r.board.add(99); await tick();
  r.switchTo('account-B');
  r.asks[0].resolve(new Map());
  assert.equal(await add, 'account-changed');
  assert.deepEqual(r.saves, []);
  assert.match(r.board.slot(99, true), /data-recheck="99"/);
});

test('+ Planning saves once, only when confirmed absent, and uses the saved answer', async () => {
  const r = rig();
  const add = r.board.add(5), again = r.board.add(5);
  assert.equal(await again, 'busy');
  assert.match(r.board.slot(5, true), /disabled/);
  await answerAdd(r, 0, new Map());
  assert.equal(await add, 'added');
  assert.deepEqual(r.saves, [[{ mediaId: 5, status: 'PLANNING' }]]);
  assert.equal(r.board.slot(5, true), '<span class="tag s-PLANNING">Planning</span>');
  assert.equal(r.asks.length, 1);
});

test('+ Planning: an older lookup answering after the save cannot bring the add back', async () => {
  const r = rig();
  const re = r.board.recheck(6); await tick();
  const add = r.board.add(6); await answerAdd(r, 1, new Map());
  assert.equal(await add, 'added');
  r.asks[0].resolve(new Map()); // the retry from before the save says "absent"
  assert.equal(await re, 'stale');
  assert.equal(r.board.state(6), 'listed');
});

test('+ Planning: a failed lookup or save leaves the show unknown; read-only riders never save', async () => {
  const r = rig();
  const a = r.board.add(7); await answerAdd(r, 0, null);
  assert.equal(await a, 'unknown');
  const boom = planBoard({ rider: async () => USER, token: () => 't', identity: () => ({ riderId: 42, canWrite: true, account: 't' }), lookup: async () => new Map(), save: async () => { throw new Error("AniList didn't save that."); } });
  await assert.rejects(boom.add(8), /didn't save/);
  assert.equal(boom.state(8), 'unknown');
  const ro = rig({ rider: { id: 1, canWrite: false } });
  assert.equal(await ro.board.add(9), 'unknown');
  assert.deepEqual([ro.asks.length, ro.saves.length], [0, 0]);
});

test("who you are can't be read (me() rejects): unknown everywhere, no lookup, no save", async () => {
  const asks = [], saves = [];
  const board = planBoard({
    rider: async () => { throw new Error("Couldn't reach AniList."); }, token: () => 'account-A', identity: () => undefined,
    lookup: async (...a) => (asks.push(a), new Map()), save: async e => (saves.push(e), { m0: { status: 'PLANNING' } }),
  });
  await board.learn([1, 2]);
  assert.equal(board.state(1), 'unknown');
  assert.match(board.slot(1, true), /data-recheck="1"/);
  assert.equal(await board.recheck(1), 'unknown');
  assert.equal(await board.add(1), 'unknown');
  assert.deepEqual([asks.length, saves.length], [0, 0]);
});

test('nobody signed in: no lookup is needed and nothing can be added', async () => {
  const board = planBoard({ rider: async () => null, token: () => null, identity: () => ({ riderId: null, canWrite: false, account: '' }), save: async () => assert.fail('must not save') });
  await board.learn([1]);
  assert.equal(board.slot(1, false), '');
  assert.equal(await board.add(1), 'absent');
});

// The same three races through the real gql() and saveEntries(), with AniList answers held until the test releases them.
async function realAniList(fn) {
  const real = globalThis.fetch, held = [], writes = [];
  signIn(async (_, opts) => {
    const body = JSON.parse(opts.body);
    if (body.query.startsWith('mutation')) { writes.push({ query: body.query, auth: opts.headers.Authorization }); return json({ data: { m0: { mediaId: 1, status: 'PLANNING', progress: 0 } } }); }
    const d = deferred(); held.push({ body, auth: opts.headers.Authorization, ...d }); return d.promise;
  });
  const reply = (i, data, errors) => held[i].resolve(json({ data, errors }));
  try { await me(); return await fn({ held, writes, reply, board: planBoard() }); } // a page has its rider before it offers saves
  finally { globalThis.fetch = real; logout(); }
}

test('real gql, race 1: newer status:null then older empty answer: no add, nothing sent', () => realAniList(async ({ held, writes, reply, board }) => {
  const older = board.recheck(21), newer = board.recheck(21);
  await tick(); await tick();
  assert.equal(held.length, 2);
  reply(1, { p0: { mediaList: [{ mediaId: 21, status: null }] } }, [{ message: 'partial', path: ['p0', 'mediaList', 0, 'status'] }]);
  assert.equal(await newer, 'unknown');
  reply(0, { p0: { mediaList: [] } });
  assert.equal(await older, 'stale');
  assert.doesNotMatch(board.slot(21, true), /data-plan/);
  assert.deepEqual(writes, []);
}));

test('real gql, race 2: a stale + Planning card checks fresh and finds Completed: nothing sent', () => realAniList(async ({ held, writes, reply, board }) => {
  const l = board.learn([22]); await tick(); await tick(); reply(0, { p0: { mediaList: [] } }); await l;
  assert.match(board.slot(22, true), /data-plan="22"/);
  const add = board.add(22); await tick(); await tick();
  assert.match(held[1].body.query, /Viewer\{ id \}/);
  reply(1, { Viewer: { id: 42 }, p0: { mediaList: [{ mediaId: 22, status: 'COMPLETED' }] } });
  assert.equal(await add, 'listed');
  assert.deepEqual(writes, []);
}));

test('real gql, race 3: switched account (cached profile still says 42): refused before anything is sent', () => realAniList(async ({ held, writes, board }) => {
  assert.equal((await me()).id, 42); // this page knows the rider as 42 (account-A)
  localStorage.setItem('animetro.token', 'account-B'); // another tab signed in as someone else; no storage event here
  assert.equal(await board.add(23), 'unknown'); // the identity this page rendered with isn't the signed-in account
  assert.deepEqual([held.length, writes.length], [0, 0]);
}));

test('real gql, race 3: account switch while the + Planning check is in flight: nothing sent', () => realAniList(async ({ writes, reply, board }) => {
  const add = board.add(24); await tick(); await tick();
  localStorage.setItem('animetro.token', 'account-B');
  reply(0, { Viewer: { id: 42 }, p0: { mediaList: [] } });
  assert.equal(await add, 'account-changed');
  assert.deepEqual(writes, []);
}));

test('real gql: confirmed absent for the signed-in account: one PLANNING write with that token', () => realAniList(async ({ writes, reply, board }) => {
  const add = board.add(25); await tick(); await tick();
  reply(0, { Viewer: { id: 42 }, p0: { mediaList: [] } });
  assert.equal(await add, 'added');
  assert.equal(writes.length, 1);
  assert.match(writes[0].query, /mediaId:25,status:PLANNING/);
  assert.equal(writes[0].auth, 'Bearer account-A');
}));

test('listedStatus: entries by id, and an empty Map when none of the shows are listed', async () => {
  const seen = [];
  const query = async (q, v, o) => (seen.push([v, o]), { p0: { mediaList: [{ mediaId: 1, status: 'COMPLETED', progress: 12 }] } });
  const m = await listedStatus(USER, [1, 2], query);
  assert.equal(m.get(1).status, 'COMPLETED');
  assert.equal(m.has(2), false);
  assert.deepEqual(seen, [[{ u: 42, ids: [1, 2] }, { fresh: false }]]);
  assert.deepEqual(await listedStatus(USER, [3], async () => ({ p0: { mediaList: [] } })), new Map());
});

test('listedStatus: no rider or no ids needs no request', async () => {
  const boom = async () => { throw new Error('should not be asked'); };
  assert.deepEqual(await listedStatus(null, [1], boom), new Map());
  assert.deepEqual(await listedStatus(USER, [], boom), new Map());
});

test('listedStatus: a failed or partial lookup is unknown (null), never "not on your list"', async () => {
  assert.equal(await listedStatus(USER, [1], async () => { throw new Error("Couldn't reach AniList."); }), null);
  assert.equal(await listedStatus(USER, [1], async () => ({ p0: null })), null);
  assert.equal(await listedStatus(USER, [1], async () => ({})), null);
  const many = Array.from({ length: 60 }, (_, i) => i + 1);
  assert.equal(await listedStatus(USER, many, async () => ({ p0: { mediaList: [] } })), null, 'second page missing');
});

test('listedStatus with viewer: asks whose token it is and refuses a different account', async () => {
  const ask = viewer => async q => (assert.match(q, /Viewer\{ id \}/), { Viewer: viewer, p0: { mediaList: [] } });
  assert.deepEqual(await listedStatus(USER, [1], ask({ id: 42 }), { viewer: true }), new Map());
  assert.equal(await listedStatus(USER, [1], ask({ id: 77 }), { viewer: true }), null);
  assert.equal(await listedStatus(USER, [1], ask(null), { viewer: true }), null);
});

test('regression (N1 review): AniList unreachable -> listStatus says "absent", the board says unknown and sends nothing', () => realAniList(async ({ writes }) => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  assert.deepEqual(await listStatus([1]), new Map()); // why gacha can't use it: failure looks like absence
  const board = planBoard();
  await board.learn([1]);
  assert.equal(board.state(1), 'unknown');
  assert.match(board.slot(1, true), /data-recheck="1"/);
  assert.equal(await board.recheck(1), 'unknown');
  assert.equal(await board.add(1), 'unknown');
  assert.deepEqual(writes, []);
}));

test('regression (N1 re-review): Check list and + Planning keep add off for null/missing/odd status (real gql)', async () => {
  for (const [why, entry] of ODD) {
    await withAniList(partial(entry), async () => {
      const board = planBoard();
      assert.equal(await board.recheck(1), 'unknown', why);
      assert.doesNotMatch(board.slot(1, true), /data-plan/, why);
    });
    await withAniList(() => ({ data: { Viewer: { id: 42 }, p0: { mediaList: [entry] } }, errors: [{ message: 'partial' }] }), async () => {
      assert.equal(await planBoard({ save: async () => assert.fail('must not save') }).add(1), 'unknown', why);
    });
  }
});

test('Check list resolves once AniList answers cleanly', async () => {
  await withAniList(() => ({ data: { p0: { mediaList: [{ mediaId: 11, status: 'DROPPED', progress: 2 }] } } }), async () => {
    const board = planBoard();
    assert.equal(await board.recheck(11), 'listed');
    assert.equal(board.slot(11, true), '<span class="tag s-DROPPED">Dropped</span>');
  });
  const board = planBoard({ rider: async () => USER, token: () => 't', identity: () => ({ riderId: 42, canWrite: true, account: 't' }), lookup: async () => new Map() });
  assert.equal(await board.recheck(7), 'absent');
  assert.equal(board.slot(7, true), '<button class="tag add" data-plan="7">+ Planning</button>');
  assert.equal(board.slot(7, false), '');
});

test('real api: a click waiting for rate-limit room, then logout and login as B: nothing is checked or saved as B', () => realAniList(async ({ held, writes }) => {
  assert.equal((await me()).id, 42); // signed in as A (account-A)
  let release;
  const queued = saveChecked([{ id: 999, change: { status: 'PLANNING' } }], { room: () => new Promise(r => (release = r)) });
  await tick(); await tick();
  logout(); localStorage.setItem('animetro.token', 'account-B');
  release();
  const r = await queued;
  assert.equal(r.accountChanged, true);
  assert.deepEqual([held.length, writes.length], [0, 0]);
}));

test('identity(): read synchronously; only once me() has resolved, and only while that account is still signed in', () => realAniList(async () => {
  const id = identity();
  assert.deepEqual({ ...id, account: typeof id.account }, { riderId: 42, canWrite: true, account: 'string' });
  assert.ok(Object.isFrozen(id));
  assert.ok(!id.account.includes('account-A'), 'a fingerprint, not the token');
  localStorage.setItem('animetro.token', 'account-B');
  assert.equal(identity(), undefined); // the rendered identity belongs to A
  localStorage.setItem('animetro.token', 'account-A');
  assert.equal(identity(), id);
  logout();
  assert.equal(identity(), undefined);
}));
