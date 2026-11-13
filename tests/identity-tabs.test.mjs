import './setup.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { me, logout, gql } from '../web/js/api.js';

const profile = id => ({ id, name: 'Rider ' + id, avatar: { large: '' }, bannerImage: null, siteUrl: '', options: { profileColor: 'blue' } });
let reloads, sent;
location.reload = () => reloads++;
// AniList stand-in: the Viewer is whoever the bearer token says
globalThis.fetch = async (_, opts) => {
  sent.push(opts.headers.Authorization ?? null);
  const who = { 'Bearer tok-a': 1, 'Bearer tok-b': 2 }[opts.headers.Authorization];
  return new Response(JSON.stringify({ data: { Viewer: who ? profile(who) : null, m0: { mediaId: 1 } } }));
};
const storageEvent = key => { const e = new Event('storage'); Object.assign(e, { key, storageArea: localStorage }); dispatchEvent(e); };

beforeEach(() => { logout(); localStorage.removeItem('animetro.token'); localStorage.removeItem('animetro.user'); reloads = 0; sent = []; });

test('the cached profile is never stored with the token itself', async () => {
  localStorage.setItem('animetro.token', 'tok-a');
  await me();
  const raw = sessionStorage.getItem('animetro.me');
  assert.ok(raw && !raw.includes('tok-a'));
});

test('a cached profile from another account is ignored, not trusted', async () => {
  localStorage.setItem('animetro.token', 'tok-a');
  assert.equal((await me()).id, 1);
  // what this tab is left with after another tab logs in as someone else: old sessionStorage, new token
  const stale = sessionStorage.getItem('animetro.me');
  logout();
  sessionStorage.setItem('animetro.me', stale);
  localStorage.setItem('animetro.token', 'tok-b');
  assert.equal((await me()).id, 2);
});

test('the old unstamped cache format is ignored', async () => {
  sessionStorage.setItem('animetro.me', JSON.stringify(profile(123)));
  localStorage.setItem('animetro.token', 'tok-a');
  assert.equal((await me()).id, 1);
});

test('logging out elsewhere leaves no cached identity behind', async () => {
  localStorage.setItem('animetro.token', 'tok-a');
  await me();
  const stale = sessionStorage.getItem('animetro.me');
  logout();
  sessionStorage.setItem('animetro.me', stale);
  assert.equal(await me(), null);
  assert.deepEqual(sent, ['Bearer tok-a']);
});

test("another tab's login, logout or account switch clears this tab's identity and reloads", async () => {
  localStorage.setItem('animetro.token', 'tok-a');
  await me();
  storageEvent('animetro.adult'); // unrelated settings don't
  assert.equal(reloads, 0);
  for (const key of ['animetro.token', 'animetro.user', null]) storageEvent(key);
  assert.equal(reloads, 3);
  assert.equal(sessionStorage.getItem('animetro.me'), null);
});

test('a save from a page built for one account is refused once the token belongs to another', async () => {
  localStorage.setItem('animetro.token', 'tok-a');
  await me();
  await gql('mutation{ m0: SaveMediaListEntry(mediaId:1){ mediaId } }');
  localStorage.setItem('animetro.token', 'tok-b'); // another tab, before its storage event arrives here
  sent = [];
  await assert.rejects(gql('mutation{ m0: SaveMediaListEntry(mediaId:1){ mediaId } }'), /another tab/);
  assert.deepEqual(sent, []);
  assert.equal(reloads, 1);
});
