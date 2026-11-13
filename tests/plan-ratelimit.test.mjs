// Gacha's + Planning against AniList's rate limit (Audit N1 blocker): the save goes out once, right after the check
// that allows it, or not at all. Its own file: a 429 pauses the whole api.js module, and the fake clock here
// (Date + setTimeout) moves past that pause without real waiting.
import './setup.mjs';
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { logout, me } from '../web/js/api.js';
import { planBoard, addToPlanning, planReport, saveChecked } from '../web/js/plan.js';

const PROFILE = { id: 42, name: 'Audit', avatar: null, bannerImage: null, siteUrl: null, options: null };
const json = (body, init) => new Response(JSON.stringify(body), init);
const refused = () => json({ data: null, errors: [{ message: 'Too Many Requests.', status: 429 }] }, { status: 429, headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 30) } });
let clock = 1_900_000_000_000, lookups, writes, anilist;

beforeEach(async () => {
  clock += 10_000_000; // far past any pause a previous test left behind
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: clock });
  logout(); // a fresh page: no identity, no cached answers
  localStorage.setItem('animetro.token', 'account-A');
  lookups = []; writes = [];
  // AniList stand-in: the profile, the + Planning check (Viewer + list) and saves; anilist() decides the rest.
  globalThis.fetch = async (_, opts) => {
    const body = JSON.parse(opts.body), auth = opts.headers.Authorization;
    if (/^\{Viewer\{/.test(body.query)) return json({ data: { Viewer: PROFILE } });
    if (body.query.startsWith('mutation')) { writes.push({ query: body.query, auth }); return anilist.save({ auth, body }); }
    lookups.push({ auth });
    return anilist.lookup({ auth, body });
  };
  await me(); // a page has its rider before it offers saves
});
afterEach(() => { mock.timers.reset(); logout(); });

const viewer = auth => (auth === 'Bearer account-A' ? 42 : 77);
const later = ms => mock.timers.tick(ms); // move the fake clock past a pause

test('429 on the save, then another tab signs in as B: no resend with B\'s token; the next click is refused before anything goes out as B', async () => {
  anilist = {
    lookup: ({ auth }) => json({ data: { Viewer: { id: viewer(auth) }, p0: { mediaList: [] } } }),
    save: () => { localStorage.setItem('animetro.token', 'account-B'); return refused(); }, // B signs in during the wait
  };
  const board = planBoard();
  assert.equal(await board.add(101), 'rate-limited');
  assert.deepEqual(writes, [{ query: writes[0].query, auth: 'Bearer account-A' }]); // the one refused attempt, as A
  assert.match(board.slot(101, true), /data-plan="101"/, '+ Planning is back: nothing was saved');
  assert.doesNotMatch(board.slot(101, true), /disabled/);
  later(65_000);
  assert.equal(writes.length, 1, 'no automatic resend, even after the pause');
  assert.equal(await board.add(101), 'unknown'); // this page's identity (A) isn't the signed-in account any more
  assert.deepEqual(lookups.map(l => l.auth), ['Bearer account-A']); // nothing at all as B
  assert.equal(writes.length, 1);
});

test('429 on the save, then the show lands on the list (Completed): never overwritten', async () => {
  let onList = false;
  anilist = {
    lookup: () => json({ data: { Viewer: { id: 42 }, p0: { mediaList: onList ? [{ mediaId: 102, status: 'COMPLETED', progress: 12 }] : [] } } }),
    save: () => { onList = true; return refused(); }, // marked Completed elsewhere while AniList is refusing
  };
  const board = planBoard();
  assert.equal(await board.add(102), 'rate-limited');
  later(65_000);
  assert.equal(writes.length, 1, 'no automatic resend');
  assert.equal(await board.add(102), 'listed'); // the next click sees Completed
  assert.equal(board.slot(102, true), '<span class="tag s-COMPLETED">Completed</span>');
  assert.equal(writes.length, 1, 'PLANNING never reached the Completed show');
});

test('a check that leaves AniList saying "out of requests" means the save is not even sent', async () => {
  anilist = {
    lookup: () => json({ data: { Viewer: { id: 42 }, p0: { mediaList: [] } } }, { headers: { 'X-RateLimit-Limit': '30', 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 30) } }),
    save: () => assert.fail('must not be sent'),
  };
  const board = planBoard();
  assert.equal(await board.add(103), 'rate-limited');
  assert.deepEqual(writes, []);
  assert.match(board.slot(103, true), /data-plan="103"/);
});

test('once AniList has room again, + Planning checks and saves exactly once', async () => {
  let refuse = true;
  anilist = {
    lookup: () => json({ data: { Viewer: { id: 42 }, p0: { mediaList: [] } } }),
    save: () => (refuse ? ((refuse = false), refused()) : json({ data: { m0: { mediaId: 104, status: 'PLANNING', progress: 0 } } })),
  };
  const board = planBoard();
  assert.equal(await board.add(104), 'rate-limited');
  later(65_000);
  assert.equal(await board.add(104), 'added');
  assert.equal(writes.length, 2); // the refused one and the one the second click sent after its own check
  assert.equal(lookups.length, 2);
  assert.equal(board.slot(104, true), '<span class="tag s-PLANNING">Planning</span>');
});

// Line's "Add N to Planning" (addToPlanning) through the real gql() and saveEntries().
test('Line: a show marked Completed after the line loaded is not overwritten; the rest are added in one save', async () => {
  const list = new Map([[202, 'COMPLETED']]); // marked Completed in another tab after the line was drawn
  anilist = {
    lookup: () => json({ data: { Viewer: { id: 42 }, p0: { mediaList: [...list].map(([mediaId, status]) => ({ mediaId, status, progress: 12 })) } } }),
    save: () => json({ data: { m0: { mediaId: 201, status: 'PLANNING', progress: 0 }, m1: { mediaId: 203, status: 'PLANNING', progress: 0 } } }),
  };
  const r = await addToPlanning([201, 202, 203]);
  assert.equal(writes.length, 1);
  assert.match(writes[0].query, /m0: SaveMediaListEntry\(mediaId:201,status:PLANNING\).*m1: SaveMediaListEntry\(mediaId:203,status:PLANNING\)/);
  assert.doesNotMatch(writes[0].query, /mediaId:202/);
  assert.equal(r.changed.get(202).status, 'COMPLETED');
  assert.equal(planReport(r, 3), 'Added 2 to Planning; 1 was already on your list.');
});

test('Line: a refused batch (429) saves nothing, is never resent, and says AniList is busy', async () => {
  anilist = { lookup: () => json({ data: { Viewer: { id: 42 }, p0: { mediaList: [] } } }), save: () => refused() };
  const r = await addToPlanning([211, 212]);
  later(65_000);
  assert.equal(writes.length, 1);
  assert.equal(r.rateLimited, true);
  assert.equal(r.saved.size, 0);
  assert.equal(planReport(r, 2), 'AniList is busy right now, so nothing was added. Try again in a moment.');
});

// Checked saves on different shows (Home's or My pass's +1 on several cards) started together. Stand-in AniList with a
// degraded limit of 30 a minute: it counts every request in its window, says how many are left, and refuses past 30.
test('20 checked saves at once stay inside the rate limit; each save goes out right after its own check', async () => {
  const LIMIT = 30, log = [];
  let start = Date.now(), used = 0;
  const answer = data => {
    if (Date.now() >= start + 60_000) { start = Date.now(); used = 0; } // a new window
    used++;
    const headers = { 'X-RateLimit-Limit': String(LIMIT), 'X-RateLimit-Remaining': String(Math.max(0, LIMIT - used)), 'X-RateLimit-Reset': String(Math.ceil((start + 60_000) / 1000)) };
    if (used > LIMIT) return refused();
    return json({ data }, { headers });
  };
  anilist = {
    lookup: ({ body }) => { log.push({ t: Date.now(), kind: 'check', id: body.variables.ids[0] }); return answer({ Viewer: { id: 42 }, p0: { mediaList: [{ mediaId: body.variables.ids[0], status: 'CURRENT', progress: 3 }] } }); },
    save: ({ body }) => { const id = +body.query.match(/mediaId:(\d+)/)[1]; log.push({ t: Date.now(), kind: 'save', id }); return answer({ m0: { mediaId: id, status: 'CURRENT', progress: 4 } }); },
  };
  const t0 = Date.now();
  const all = Promise.all(Array.from({ length: 20 }, (_, i) => saveChecked([{ id: 300 + i, seen: { status: 'CURRENT', progress: 3 }, change: { progress: 4 } }])));
  let done = false;
  all.then(() => (done = true), () => (done = true));
  for (let t = 0; t <= 600_000 && !done; t += 500) { for (let k = 0; k < 8; k++) await new Promise(r => setImmediate(r)); if (!done) later(500); }
  const results = await all;

  assert.ok(results.every(r => r.saved.size === 1 && !r.rateLimited && !r.unknown.length), 'every +1 saved, none refused');
  assert.equal(log.length, 40);
  // never more than 30 in any minute, and so never a 429
  for (const a of log) assert.ok(log.filter(b => b.t >= a.t && b.t < a.t + 60_000).length <= LIMIT, `burst at ${a.t - t0}ms`);
  // one at a time, and each save immediately after its own check: any waiting came before the check
  for (let i = 0; i < log.length; i += 2) {
    assert.deepEqual([log[i].kind, log[i + 1].kind, log[i + 1].id], ['check', 'save', log[i].id]);
    assert.equal(log[i + 1].t, log[i].t, `no wait between check and save for ${log[i].id}`);
  }
  // it did have to wait once: the second window's first check comes a minute in
  const waited = log.filter((x, i) => i > 0 && x.kind === 'check' && x.t > log[i - 1].t);
  assert.ok(waited.length >= 1 && waited[0].t - t0 >= 59_000, 'waited for the window before a check');
});
