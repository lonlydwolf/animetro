import './setup.mjs';
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { gql, saveEntries, RateLimited } from '../web/js/api.js';

// AniList stand-in: answers from a script of responses; records when (fake clock) each request went out.
let script, sent, start, pauses, clock = 1_800_000_000_000;
const ok = (headers = {}) => ({ status: 200, headers });
const busy = (headers = {}) => ({ status: 429, headers });
const scripted = async () => {
  sent.push(Date.now() - start);
  const r = script.length > 1 ? script.shift() : script[0];
  const body = r.status === 429 ? { data: null, errors: [{ message: 'Too Many Requests.', status: 429 }] } : { data: { Media: { id: 1 } } };
  return new Response(JSON.stringify(body), { status: r.status, headers: r.headers });
};
addEventListener('ratelimit', e => pauses.push(e.detail));
const unix = ms => String(Math.floor((Date.now() + ms) / 1000));

beforeEach(() => {
  clock += 10_000_000; // far past any pause a previous test left behind
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: clock });
  start = Date.now(); sent = []; pauses = [];
  globalThis.fetch = scripted; // a test may swap in its own stand-in; the next one starts from the script again
});
afterEach(() => mock.timers.reset());

// Let the request run, moving the fake clock half a second at a time, until it settles.
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
async function run(p, limit = 600_000) {
  let done = false;
  p.then(() => (done = true), () => (done = true));
  for (let t = 0; t <= limit; t += 500) { await settle(); if (done) break; mock.timers.tick(500); }
  return p;
}
const ask = () => gql('{Media(id:1){id}}', {}, { fresh: true });

test('a 429 waits until X-RateLimit-Reset, once: no extra fallback wait stacked on top', async () => {
  script = [busy({ 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': unix(20_000) }), ok({ 'X-RateLimit-Remaining': '29' })];
  await run(ask());
  assert.deepEqual(sent, [0, 20_000]);
  assert.deepEqual(pauses, [20]);
});

test('without a readable Reset, a 429 falls back to Retry-After, then to a bounded default', async () => {
  script = [busy({ 'Retry-After': '5' }), ok()];
  await run(ask());
  assert.deepEqual(sent, [0, 5_000]);
  start = Date.now(); sent = [];
  script = [busy(), ok()];
  await run(ask());
  assert.deepEqual(sent, [0, 15_000]);
});

test('a Reset that is already past is ignored; one absurdly far away is capped', async () => {
  script = [busy({ 'X-RateLimit-Reset': unix(-30_000), 'Retry-After': '7' }), ok()];
  await run(ask());
  assert.deepEqual(sent, [0, 7_000]);
  start = Date.now(); sent = [];
  script = [busy({ 'X-RateLimit-Reset': unix(3_600_000) }), ok()];
  await run(ask());
  assert.deepEqual(sent, [0, 65_000]);
});

test('retries are capped, then the rider gets a plain error', async () => {
  script = [busy({ 'X-RateLimit-Reset': unix(10_000) })];
  const p = run(ask());
  await assert.rejects(p, /turning requests away/);
  assert.equal(sent.length, 4); // first try + 3 retries
});

test('running low pauses the next request until the reset, before AniList has to refuse', async () => {
  script = [ok({ 'X-RateLimit-Limit': '30', 'X-RateLimit-Remaining': '2', 'X-RateLimit-Reset': unix(12_000) }), ok({ 'X-RateLimit-Remaining': '29' })];
  await run(ask());
  await run(ask());
  assert.deepEqual(sent, [0, 12_000]);
});

test('running low without a Reset assumes the window ends a minute later', async () => {
  script = [ok({ 'X-RateLimit-Limit': '30', 'X-RateLimit-Remaining': '1' }), ok({ 'X-RateLimit-Remaining': '29' })];
  await run(ask());
  await run(ask());
  assert.deepEqual(sent, [0, 60_000]);
});

test('"low" follows the limit AniList reports instead of assuming 30', async () => {
  script = [ok({ 'X-RateLimit-Limit': '30', 'X-RateLimit-Remaining': '8' })];
  await run(ask());
  await run(ask());
  assert.deepEqual(sent, [0, 0]); // 8 of 30 left: plenty
  start = Date.now(); sent = [];
  script = [ok({ 'X-RateLimit-Limit': '90', 'X-RateLimit-Remaining': '8' }), ok({ 'X-RateLimit-Remaining': '80' })];
  await run(ask());
  await run(ask());
  assert.deepEqual(sent, [0, 60_000]); // 8 of 90 left: slow down
});

test('requests already queued behind a pause all go when it ends, not one pause each', async () => {
  script = [busy({ 'X-RateLimit-Reset': unix(10_000) }), ok({ 'X-RateLimit-Remaining': '25' })];
  await run(ask());
  start = Date.now(); sent = [];
  script = [ok({ 'X-RateLimit-Limit': '30', 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': unix(10_000) }), ok({ 'X-RateLimit-Remaining': '25' })];
  await run(ask());
  await run(Promise.all([ask(), ask(), ask()]));
  assert.deepEqual(sent, [0, 10_000, 10_000, 10_000]);
});

test('a success from a request already in flight does not lift a 429 pause', async () => {
  // A and B go out together; A is refused (reset in 20s), then B's earlier-sent request succeeds with room left.
  const replies = [];
  globalThis.fetch = () => { sent.push(Date.now() - start); return new Promise(r => replies.push(r)); };
  const reply = (status, headers) => replies.shift()(new Response(JSON.stringify(status === 429
    ? { data: null, errors: [{ message: 'Too Many Requests.', status: 429 }] } : { data: { Media: { id: 1 } } }), { status, headers }));
  const a = ask(), b = ask();
  await settle();
  assert.deepEqual(sent, [0, 0]);
  reply(429, { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': unix(20_000) });
  await settle();
  reply(200, { 'X-RateLimit-Limit': '30', 'X-RateLimit-Remaining': '25' });
  await settle();
  const c = ask(); // new request after both answers: still inside A's 429 pause
  await settle();
  assert.deepEqual(sent, [0, 0], 'C must not go out during the pause');
  let t = 0;
  while (sent.length < 4 && t < 60_000) { mock.timers.tick(500); t += 500; await settle(); }
  assert.deepEqual(sent, [0, 0, 20_000, 20_000]); // A's retry and C, together, once the pause ends
  while (replies.length) reply(200, { 'X-RateLimit-Remaining': '24' });
  await Promise.all([a, b, c]);
});

// { retry: false }: for a save checked just before it goes out. One attempt, now, or RateLimited.
const once = () => gql('{Media(id:1){id}}', {}, { fresh: true, retry: false });

test('retry: false reports a 429 at once and never resends it', async () => {
  script = [busy({ 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': unix(20_000) }), ok()];
  await assert.rejects(run(once()), e => e instanceof RateLimited && e.status === 429 && /busy/.test(e.message));
  assert.deepEqual(sent, [0]);
  assert.equal(Date.now() - start, 0, 'no waiting');
});

test('retry: false does not wait out a pause: it refuses without sending, and the pause still holds for others', async () => {
  script = [busy({ 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': unix(20_000) }), ok()];
  await assert.rejects(run(once()), RateLimited);
  await assert.rejects(run(once()), RateLimited); // still paused: not even sent
  assert.deepEqual(sent, [0]);
  await run(ask()); // an ordinary request waits the pause out as before
  assert.deepEqual(sent, [0, 20_000]);
});

test('retry: false also refuses while running low, instead of waiting for the reset', async () => {
  script = [ok({ 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': unix(30_000) })];
  await run(ask());
  await assert.rejects(run(once()), RateLimited);
  assert.deepEqual(sent, [0]);
});

test('retry: false goes straight out when nothing is limiting', async () => {
  script = [ok({ 'X-RateLimit-Remaining': '29' })];
  assert.deepEqual(await run(once()), { Media: { id: 1 } });
  assert.deepEqual(sent, [0]);
});

test('saveEntries passes retry: false through: a refused save is one request and RateLimited', async () => {
  script = [busy({ 'X-RateLimit-Reset': unix(20_000) }), ok()];
  await assert.rejects(run(saveEntries([{ mediaId: 1, status: 'PLANNING' }], { retry: false })), RateLimited);
  assert.deepEqual(sent, [0]);
});
