import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// api.js reads the login result from the address when it loads, so each case imports a fresh copy.
const load = async (hash, n) => {
  location.hash = hash;
  globalThis.history = { replaceState: () => { location.hash = ''; } };
  return import(`../web/js/api.js?case=${n}`);
};

test('a login the app started is accepted, once', async () => {
  const api = await load('', 1);
  localStorage.setItem('animetro.client', '123');
  const state = new URL(api.loginUrl()).searchParams.get('state');
  assert.match(state, /^[0-9a-f]{32}$/);
  const back = await load(`#access_token=good&state=${state}`, 2);
  assert.equal(back.loginRejected, false);
  assert.equal(localStorage.getItem('animetro.token'), 'good');
  assert.equal(location.hash, '', 'the token is removed from the address');
  const replay = await load(`#access_token=again&state=${state}`, 3);
  assert.equal(replay.loginRejected, true, 'the same state cannot be used twice');
  assert.equal(localStorage.getItem('animetro.token'), 'good');
});

test('a login link the app did not start is ignored', async () => {
  localStorage.removeItem('animetro.token');
  const api = await load('#access_token=planted', 4);
  assert.equal(api.loginRejected, true);
  assert.equal(localStorage.getItem('animetro.token'), null);
  const wrong = await load('#access_token=planted&state=guess', 5);
  assert.equal(wrong.loginRejected, true);
  assert.equal(localStorage.getItem('animetro.token'), null);
});

test("on the web there is no built-in client: the Mac app's client is never offered there", async () => {
  const api = await load('', 6);
  assert.equal(api.inApp, false);
  assert.equal(api.builtInLogin(), false, 'riders bring their own client');
  localStorage.removeItem('animetro.client');
  assert.equal(api.clientId(), '');
  assert.equal(new URL(api.loginUrl()).searchParams.get('client_id'), '');
  localStorage.setItem('animetro.client', '123');
  const url = new URL(api.loginUrl());
  assert.equal(url.searchParams.get('client_id'), '123');
  assert.equal(url.searchParams.get('response_type'), 'token');
  assert.match(url.searchParams.get('state'), /^[0-9a-f]{32}$/);
  assert.doesNotMatch(url.href, /56211/);
  localStorage.removeItem('animetro.client');
});
