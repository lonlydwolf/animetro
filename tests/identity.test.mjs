import './setup.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { me, logout, listStatus, UnknownUser } from '../web/js/api.js';

const viewer = { id: 7, name: 'Rider', avatar: { large: '' }, bannerImage: null, siteUrl: '', options: { profileColor: 'blue' } };
const answer = body => async () => new Response(JSON.stringify(body));
const offline = async () => { throw new TypeError('Failed to fetch'); };
let calls;
const counted = fn => async (...a) => { calls++; return fn(...a); };

beforeEach(() => { logout(); localStorage.removeItem('animetro.token'); localStorage.removeItem('animetro.user'); calls = 0; });

test('nobody logged in is null, without asking AniList', async () => {
  globalThis.fetch = counted(offline);
  assert.equal(await me(), null);
  assert.equal(calls, 0);
});

test('offline with a token rejects instead of looking logged out, and the next call asks again', async () => {
  localStorage.setItem('animetro.token', 'tok');
  globalThis.fetch = counted(offline);
  await assert.rejects(me(), /Couldn't reach AniList/);
  globalThis.fetch = counted(answer({ data: { Viewer: viewer } }));
  const u = await me();
  assert.equal(u.name, 'Rider');
  assert.equal(u.canWrite, true);
  assert.equal(calls, 2);
});

test('an AniList server error rejects too', async () => {
  localStorage.setItem('animetro.token', 'tok');
  globalThis.fetch = answer({ data: { Viewer: null }, errors: [{ message: 'Internal Server Error', status: 500 }] });
  await assert.rejects(me(), /Internal Server Error/);
});

test('a username that does not exist rejects with UnknownUser, and is asked again next time', async () => {
  localStorage.setItem('animetro.user', 'nobody');
  globalThis.fetch = counted(answer({ data: { User: null }, errors: [{ message: 'Not Found.', status: 404 }] }));
  await assert.rejects(me(), err => err instanceof UnknownUser && err.username === 'nobody' && /No AniList user called "nobody"/.test(err.message));
  globalThis.fetch = counted(answer({ data: { User: { ...viewer, name: 'nobody' } } })); // e.g. AniList had a hiccup
  const u = await me();
  assert.equal(u.name, 'nobody');
  assert.equal(u.canWrite, false);
  assert.equal(calls, 2);
});

test('a username lookup that cannot reach AniList rejects, and is asked again next time', async () => {
  localStorage.setItem('animetro.user', 'someone');
  globalThis.fetch = offline;
  await assert.rejects(me(), err => !(err instanceof UnknownUser) && /Couldn't reach AniList/.test(err.message));
  globalThis.fetch = answer({ data: { User: { ...viewer, name: 'someone' } } });
  assert.equal((await me()).name, 'someone');
});

test('a token whose profile comes back empty rejects rather than looking logged out', async () => {
  localStorage.setItem('animetro.token', 'tok');
  globalThis.fetch = answer({ data: { Viewer: null } });
  await assert.rejects(me(), /didn't send your profile/);
});

test('an empty profile answer is not replayed from the query cache: the next call recovers (token and username)', async () => {
  localStorage.setItem('animetro.token', 'tok');
  globalThis.fetch = counted(answer({ data: { Viewer: null } }));
  await assert.rejects(me());
  globalThis.fetch = counted(answer({ data: { Viewer: viewer } }));
  assert.equal((await me()).name, 'Rider');
  assert.equal(calls, 2);

  logout(); localStorage.setItem('animetro.user', 'someone'); calls = 0;
  globalThis.fetch = counted(answer({ data: { User: null } }));
  await assert.rejects(me(), UnknownUser);
  globalThis.fetch = counted(answer({ data: { User: { ...viewer, name: 'someone' } } }));
  assert.equal((await me()).name, 'someone');
  assert.equal(calls, 2);
});

test('list badges stay best effort when who you are cannot be read', async () => {
  localStorage.setItem('animetro.token', 'tok');
  globalThis.fetch = offline;
  assert.equal((await listStatus([1, 2])).size, 0);
});
