import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Inside the Mac app pages load from animetro://app/, and AniList's redirect animetro://auth is turned into
// animetro://app/pass.html#access_token=…&state=… by the app. api.js reads both when it loads, so each case
// imports a fresh copy with the address set first.
Object.assign(location, { protocol: 'animetro:', href: 'animetro://app/pass.html', pathname: '/pass.html', origin: 'null' });
const load = async (hash, n) => {
  location.hash = hash;
  globalThis.history = { replaceState: () => { location.hash = ''; } };
  return import(`../web/js/api.js?app=${n}`);
};

test("the Mac app logs in with Animetro's own client, in one click", async () => {
  const api = await load('', 1);
  assert.equal(api.inApp, true);
  assert.equal(api.builtInLogin(), true, 'no client ID step');
  localStorage.setItem('animetro.client', '999'); // a custom ID pasted in an older version doesn't take over
  assert.equal(api.clientId(), '56211');
  const url = new URL(api.loginUrl());
  assert.equal(url.origin + url.pathname, 'https://anilist.co/api/v2/oauth/authorize');
  assert.deepEqual([...url.searchParams.keys()], ['client_id', 'response_type', 'state']);
  assert.equal(url.searchParams.get('client_id'), '56211');
  assert.equal(url.searchParams.get('response_type'), 'token', 'implicit grant: no code exchange, no secret');
  assert.match(url.searchParams.get('state'), /^[0-9a-f]{32}$/);
  assert.notEqual(new URL(api.loginUrl()).searchParams.get('state'), url.searchParams.get('state'), 'a new state each time');
  localStorage.removeItem('animetro.client');
});

test('the token AniList sends back to the app is kept only with the state this app made, then leaves the address', async () => {
  localStorage.removeItem('animetro.token');
  const api = await load('', 2);
  const state = new URL(api.loginUrl()).searchParams.get('state');
  const planted = await load('#access_token=planted&state=guess', 3);
  assert.equal(planted.loginRejected, true);
  assert.equal(localStorage.getItem('animetro.token'), null);
  assert.equal(location.hash, '', 'even a refused token leaves the address');
  // the guess used up the one-time state, so start a fresh login
  const again = await load('', 4);
  const state2 = new URL(again.loginUrl()).searchParams.get('state');
  assert.notEqual(state2, state);
  const back = await load(`#access_token=good&state=${state2}`, 5);
  assert.equal(back.loginRejected, false);
  assert.equal(localStorage.getItem('animetro.token'), 'good');
  assert.equal(location.hash, '');
});
