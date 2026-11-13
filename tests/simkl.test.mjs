import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, simklLibrary, simklConnected, setSyncOn, setSimklClient, startLogin, waitForLogin } from '../web/js/simkl.js';

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
  setSyncOn(true);
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

test('a renewal that answers without a refresh token keeps the one we have, for the next renewal', async t => {
  login();
  const sent = [];
  let renewals = 0;
  t.mock.method(globalThis, 'fetch', async (url, opt) => {
    if (String(url).includes('/oauth2/token')) {
      sent.push(new URLSearchParams(opt.body).get('refresh_token'));
      return reply(200, { access_token: `new${++renewals}`, expires_in: 7 * 86400 }); // no refresh_token
    }
    return reply(opt.headers.Authorization === `Bearer new${renewals}` ? 200 : 401, { anime: [] });
  });
  await simklLibrary(); // 401 with "old", renew, retry with new1
  assert.equal(stored().refresh, 'r1');
  assert.equal(stored().access, 'new1');
  localStorage.setItem(TOKEN, JSON.stringify({ ...stored(), access: 'revoked' }));
  await simklLibrary(); // 401 with "revoked", renew again: with the refresh token we kept
  assert.deepEqual(sent, ['r1', 'r1']);
  assert.equal(stored().refresh, 'r1');
});

// ---- cancelling a login (audit N7) --------------------------------------------
const CODE = { device_code: 'dev', user_code: 'ABCD', interval: 0.001, expires_in: 60 };
const TOKENS = { access_token: 'a', refresh_token: 'r', expires_in: 86400 };
const connectable = () => { setSyncOn(true); setSimklClient('cid'); localStorage.removeItem(TOKEN); };
// A fetch that answers only once release() is called, and, like a real server, ignores aborts.
function held(t, answer) {
  const calls = [];
  let release;
  const gate = new Promise(r => { release = r; });
  t.mock.method(globalThis, 'fetch', async (url, opt) => {
    calls.push({ url: String(url), signal: opt.signal });
    await gate;
    return answer();
  });
  return { calls, release: () => release(), sent: () => new Promise(r => setImmediate(r)) };
}

test('cancelling while the token request is out keeps nothing, even if it succeeds', async t => {
  connectable();
  const net = held(t, () => reply(200, TOKENS));
  const ctl = new AbortController();
  const waiting = waitForLogin(CODE, ctl.signal);
  while (!net.calls.length) await net.sent();
  assert.equal(net.calls[0].signal, ctl.signal, 'the request carries the cancel signal');
  ctl.abort();
  net.release();
  await assert.rejects(waiting, /Cancelled/);
  assert.equal(simklConnected(), false);
});

test('turning sync off while the token request is out keeps nothing (no signal needed)', async t => {
  connectable();
  const net = held(t, () => reply(200, TOKENS));
  const waiting = waitForLogin(CODE);
  while (!net.calls.length) await net.sent();
  setSyncOn(false); // e.g. from another tab
  net.release();
  await assert.rejects(waiting, /Cancelled/);
  assert.equal(localStorage.getItem(TOKEN), null);
});

test('changing the client ID mid-login keeps nothing', async t => {
  connectable();
  const net = held(t, () => reply(200, TOKENS));
  const waiting = waitForLogin(CODE);
  while (!net.calls.length) await net.sent();
  setSimklClient('other');
  net.release();
  await assert.rejects(waiting, /Cancelled/);
  assert.equal(simklConnected(), false);
});

test('a login nobody cancelled still saves the token', async t => {
  connectable();
  const net = held(t, () => reply(200, TOKENS));
  const waiting = waitForLogin(CODE, new AbortController().signal);
  net.release();
  await waiting;
  assert.equal(stored().access, 'a');
});

test('cancelling during the wait between polls stops at once, without another request', async t => {
  connectable();
  const net = held(t, () => reply(400, { error: 'authorization_pending' }));
  const ctl = new AbortController();
  const started = Date.now();
  const waiting = waitForLogin({ ...CODE, interval: 30 }, ctl.signal);
  ctl.abort();
  await assert.rejects(waiting, /Cancelled/);
  assert.ok(Date.now() - started < 1000, 'did not sit out the 30s poll interval');
  assert.equal(net.calls.length, 0);
});

test('cancelling while asking for a device code rejects and passes the signal on', async t => {
  connectable();
  const net = held(t, () => reply(200, CODE));
  const ctl = new AbortController();
  const asking = startLogin(ctl.signal);
  while (!net.calls.length) await net.sent();
  assert.equal(net.calls[0].signal, ctl.signal);
  ctl.abort();
  net.release();
  await assert.rejects(asking, /Cancelled/);
});

test('an aborted fetch reads as cancelled, not as a connection problem', async t => {
  connectable();
  t.mock.method(globalThis, 'fetch', async () => { throw new DOMException('aborted', 'AbortError'); });
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(startLogin(ctl.signal), /Cancelled/);
});

test('a token renewal that lands after sync was turned off does not bring the login back', async t => {
  login(Date.now() - 1000); // expired: the next call renews first
  const net = held(t, () => reply(200, FRESH));
  const library = simklLibrary();
  while (!net.calls.length) await net.sent();
  setSyncOn(false);
  net.release();
  await assert.rejects(library, /disconnected/);
  assert.equal(localStorage.getItem(TOKEN), null);
});

test('a renewal that lands after another tab renewed uses their token, keeping theirs', async t => {
  login(Date.now() - 1000);
  const tokenCalls = [];
  t.mock.method(globalThis, 'fetch', async (url, opt) => {
    if (String(url).includes('/oauth2/token')) {
      tokenCalls.push(1);
      // meanwhile the other tab's renewal lands, which makes ours stale
      localStorage.setItem(TOKEN, JSON.stringify({ access: 'theirs', refresh: 'r9', expires: Date.now() + 7 * 864e5 }));
      return reply(400, { error: 'invalid_grant' });
    }
    tokenCalls.push(opt.headers.Authorization);
    return reply(200, { anime: [] });
  });
  await simklLibrary();
  assert.deepEqual(tokenCalls, [1, 'Bearer theirs']);
  assert.equal(stored().access, 'theirs', 'not wiped by our rejected stale refresh');
});

test('another tab renewing with the same refresh token (they never rotate) is noticed too', async t => {
  login(Date.now() - 1000);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, opt) => {
    if (String(url).includes('/oauth2/token')) {
      calls.push('token');
      // the other tab's renewal lands meanwhile: new access token, same refresh token
      localStorage.setItem(TOKEN, JSON.stringify({ access: 'theirs', refresh: 'r1', expires: Date.now() + 7 * 864e5 }));
      return reply(400, { error: 'invalid_grant' });
    }
    calls.push(opt.headers.Authorization);
    return reply(200, { anime: [] });
  });
  await simklLibrary();
  assert.deepEqual(calls, ['token', 'Bearer theirs']);
  assert.ok(simklConnected(), 'not disconnected by our refresh losing the race');
  assert.equal(stored().access, 'theirs');
});
