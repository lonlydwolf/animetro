import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, simklLibrary, simklConnected } from '../web/js/simkl.js';

const ent = (id, status, progress, extra = {}) => ({ status, progress, score: 0, media: { id, idMal: id + 1000, episodes: 12, title: { romaji: 'T' + id } }, ...extra });
const row = (anilist, status, watched, extra = {}) => ({ status, watched_episodes_count: watched, anime: { ids: { simkl: anilist * 7, anilist: String(anilist) } }, ...extra });

test('backup sync only sends what differs and never removes anything', () => {
  const p = plan([
    ent(1, 'COMPLETED', 12),             // new on Simkl, finished: whole show completed
    ent(2, 'CURRENT', 5),                // Simkl has 3: episodes 4 and 5
    ent(3, 'PLANNING', 0),               // Simkl says watching: move to plan to watch
    ent(4, 'COMPLETED', 12),             // already completed: nothing
    ent(5, 'PAUSED', 2, { score: 8.4 }), // same status and episodes, new rating: rating only
    ent(6, 'CURRENT', 1),                // matched by MAL id only
    ent(7, 'REPEATING', 3),              // rewatching counts as completed
  ], [row(2, 'watching', 3), row(3, 'watching', 0), row(4, 'completed', 12), row(5, 'hold', 2, { user_rating: 6 }),
    { status: 'watching', watched_episodes_count: 1, anime: { ids: { mal: '1006' } } }, row(7, 'completed', 12)]);
  assert.deepEqual(p.history, [
    { ids: { anilist: 1, mal: 1001 }, status: 'completed' },
    { ids: { anilist: 2, mal: 1002 }, status: 'watching', episodes: [{ number: 4 }, { number: 5 }] },
  ]);
  assert.deepEqual(p.list, [{ ids: { anilist: 3, mal: 1003 }, to: 'plantowatch' }]);
  assert.deepEqual(p.ratings, [{ ids: { anilist: 5, mal: 1005 }, rating: 8 }]);
  assert.deepEqual(p.changes.map(c => c.media.id), [1, 2, 3, 5]);
  assert.equal(p.episodes, 12 + 2);
});

test('a show on AniList with no progress yet is added as watching', () => {
  assert.equal(plan([ent(9, 'CURRENT', 0)], []).list[0].to, 'watching');
});

// ---- token refresh and retries, against a scripted fetch ----------------------
const TOKEN = 'animetro.simkl.token';
const login = (expires = Date.now() + 7 * 864e5) => {
  localStorage.setItem('animetro.simkl.client', 'cid');
  localStorage.setItem(TOKEN, JSON.stringify({ access: 'old', refresh: 'r1', expires }));
};
const stored = () => JSON.parse(localStorage.getItem(TOKEN));
const reply = (status, json = {}, headers = {}) => new Response(JSON.stringify(json), { status, headers });
const FRESH = { access_token: 'new', refresh_token: 'r2', expires_in: 7 * 86400 };

// Each step answers one request: { api: Response } for /sync calls, { token: Response | Error } for the OAuth endpoint.
function script(t, steps) {
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (url, opt) => {
    const kind = String(url).includes('/oauth2/token') ? 'token' : 'api';
    seen.push(kind === 'api' ? `api:${opt.headers.Authorization.replace('Bearer ', '')}` : 'token');
    const step = steps.shift();
    assert.ok(step && kind in step, `unexpected ${kind} request (#${seen.length})`);
    if (step[kind] instanceof Error) throw step[kind];
    return step[kind];
  });
  return seen;
}
const SLOW = { 'Retry-After': '0.01' }; // 10ms, so the test doesn't wait the real 10s

test('a 429 waits and retries with the same token, never refreshing it', async t => {
  login();
  const seen = script(t, [{ api: reply(429, {}, SLOW) }, { api: reply(200, { anime: [{ id: 1 }] }) }]);
  assert.deepEqual(await simklLibrary(), [{ id: 1 }]);
  assert.deepEqual(seen, ['api:old', 'api:old']);
  assert.equal(stored().access, 'old');
});

test('two 429s in a row give up without touching the login', async t => {
  login();
  const seen = script(t, [{ api: reply(429, {}, SLOW) }, { api: reply(429, {}, SLOW) }]);
  await assert.rejects(simklLibrary(), /answered 429/);
  assert.deepEqual(seen, ['api:old', 'api:old']);
  assert.ok(simklConnected());
});

test('a 401 renews the token once and retries with the new one', async t => {
  login();
  const seen = script(t, [{ api: reply(401) }, { token: reply(200, FRESH) }, { api: reply(200, { anime: [] }) }]);
  assert.deepEqual(await simklLibrary(), []);
  assert.deepEqual(seen, ['api:old', 'token', 'api:new']);
  assert.equal(stored().refresh, 'r2');
});

test('a 429 after a renewal still gets its wait-and-retry, with no second renewal', async t => {
  login();
  const seen = script(t, [{ api: reply(401) }, { token: reply(200, FRESH) }, { api: reply(429, {}, SLOW) }, { api: reply(200, { anime: [] }) }]);
  await simklLibrary();
  assert.deepEqual(seen, ['api:old', 'token', 'api:new', 'api:new']);
});

test('a token still rejected after renewing stops instead of looping', async t => {
  login();
  const seen = script(t, [{ api: reply(401) }, { token: reply(200, FRESH) }, { api: reply(401) }]);
  await assert.rejects(simklLibrary(), /answered 401/);
  assert.deepEqual(seen, ['api:old', 'token', 'api:new']);
});

test('a 429 then a failing refresh endpoint keeps you connected (audit repro)', async t => {
  login();
  // old code: the 429 retry forced a refresh, the 503 disconnected you
  script(t, [{ api: reply(429, {}, SLOW) }, { api: reply(401) }, { token: reply(503) }]);
  await assert.rejects(simklLibrary(), /still connected/);
  assert.deepEqual(stored(), { access: 'old', refresh: 'r1', expires: stored().expires });
});

for (const status of [500, 502, 503, 429]) {
  test(`a ${status} from the token endpoint is transient: credentials stay`, async t => {
    login();
    script(t, [{ api: reply(401) }, { token: reply(status) }]);
    await assert.rejects(simklLibrary(), new RegExp(`answered ${status}.*still connected`));
    assert.ok(simklConnected());
    assert.equal(stored().refresh, 'r1');
  });
}

test('an unreachable token endpoint keeps you connected', async t => {
  login();
  script(t, [{ api: reply(401) }, { token: new TypeError('fetch failed') }]);
  await assert.rejects(simklLibrary(), /Couldn't reach Simkl/);
  assert.ok(simklConnected());
});

for (const status of [400, 401]) {
  test(`a ${status} from the token endpoint means the login is gone: disconnect`, async t => {
    login();
    script(t, [{ api: reply(401) }, { token: reply(status, { error: 'invalid_grant' }) }]);
    await assert.rejects(simklLibrary(), /ran out\. Connect again/);
    assert.equal(simklConnected(), false);
  });
}

test('an early renewal that hits a busy Simkl falls back to the still-valid token', async t => {
  login(Date.now() + 3600e3); // due for renewal (under a day left), but not expired
  const seen = script(t, [{ token: reply(503) }, { api: reply(200, { anime: [] }) }]);
  await simklLibrary();
  assert.deepEqual(seen, ['token', 'api:old']);
  assert.ok(simklConnected());
});

test('a 429 after an early renewal fell back to the valid token retries with it, renewing no more', async t => {
  login(Date.now() + 3600e3); // due for renewal (under a day left), but not expired
  const seen = script(t, [{ token: reply(503) }, { api: reply(429, {}, SLOW) }, { api: reply(200, { anime: [] }) }]);
  await simklLibrary();
  assert.deepEqual(seen, ['token', 'api:old', 'api:old']); // was token, api, token, api
  assert.ok(simklConnected());
});

test('a 429 on the retry after a renewal keeps the renewed token', async t => {
  login(Date.now() + 3600e3);
  const seen = script(t, [{ token: reply(200, FRESH) }, { api: reply(429, {}, SLOW) }, { api: reply(200, { anime: [] }) }]);
  await simklLibrary();
  assert.deepEqual(seen, ['token', 'api:new', 'api:new']);
});

test('an expired token that cannot be renewed right now reports it, still connected', async t => {
  login(Date.now() - 1000);
  const seen = script(t, [{ token: reply(503) }]);
  await assert.rejects(simklLibrary(), /still connected/);
  assert.deepEqual(seen, ['token']);
  assert.ok(simklConnected());
});
