// Gacha's + Planning against AniList's rate limit (Audit N1 blocker): the save goes out once, right after the check
// that allows it, or not at all. Its own file: a 429 pauses the whole api.js module, and the fake clock here
// (Date + setTimeout) moves past that pause without real waiting.
import './setup.mjs';
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { logout } from '../web/js/api.js';
import { planBoard, addToPlanning, planReport } from '../web/js/plan.js';

const PROFILE = { id: 42, name: 'Audit', avatar: null, bannerImage: null, siteUrl: null, options: null };
const json = (body, init) => new Response(JSON.stringify(body), init);
const refused = () => json({ data: null, errors: [{ message: 'Too Many Requests.', status: 429 }] }, { status: 429, headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 30) } });
let clock = 1_900_000_000_000, lookups, writes, anilist;

beforeEach(() => {
  clock += 10_000_000; // far past any pause a previous test left behind
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: clock });
  logout(); // a fresh page: no identity, no cached answers
  localStorage.setItem('animetro.token', 'account-A');
  lookups = []; writes = [];
  // AniList stand-in: the profile, the + Planning check (Viewer + list) and saves; anilist() decides the rest.
  globalThis.fetch = async (_, opts) => {
    const body = JSON.parse(opts.body), auth = opts.headers.Authorization;
    if (/^\{Viewer\{/.test(body.query)) return json({ data: { Viewer: PROFILE } });
    if (body.query.startsWith('mutation')) { writes.push({ query: body.query, auth }); return anilist.save({ auth }); }
    lookups.push({ auth });
    return anilist.lookup({ auth });
  };
});
afterEach(() => { mock.timers.reset(); logout(); });

const viewer = auth => (auth === 'Bearer account-A' ? 42 : 77);
const later = ms => mock.timers.tick(ms); // move the fake clock past a pause

test('429 on the save, then another tab signs in as B: no resend with B\'s token; the next click checks as B and refuses', async () => {
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
  assert.equal(await board.add(101), 'unknown'); // the click checks again, with B's token: Viewer 77, not 42
  assert.deepEqual(lookups.map(l => l.auth), ['Bearer account-A', 'Bearer account-B']);
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
