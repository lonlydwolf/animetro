import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { myList, seenIds } from '../web/js/api.js';

const profile = { id: 5, name: 'rider', avatar: { large: '' }, bannerImage: null, siteUrl: '', options: { profileColor: 'blue' } };
const lists = { MediaListCollection: { lists: [{ entries: [{ mediaId: 1, status: 'COMPLETED' }, { mediaId: 2, status: 'PLANNING' }] }] } };
let listUp = false, calls = 0;
globalThis.fetch = async (_, opts) => {
  const q = JSON.parse(opts.body).query;
  if (/User\(name/.test(q)) return new Response(JSON.stringify({ data: { User: profile } }));
  calls++;
  if (!listUp) throw new TypeError('Failed to fetch');
  return new Response(JSON.stringify({ data: lists }));
};

test("a list that can't be read rejects instead of passing for an empty one, and is asked again next time", async () => {
  localStorage.setItem('animetro.user', 'rider');
  await assert.rejects(myList(), /Couldn't reach AniList/);
  await assert.rejects(seenIds(), /Couldn't reach AniList/); // "new to me" must not treat that as "seen nothing"
  listUp = true;
  assert.deepEqual([...await myList()], [[1, 'COMPLETED'], [2, 'PLANNING']]);
  assert.deepEqual(await seenIds(), [1]);
  assert.equal(calls, 3); // two failed asks, then one that is kept for the page
});

test('nobody logged in is an empty list, without asking', async () => {
  // fresh module state isn't available here, so check the logged-out branch through a new import
  const { myList: fresh } = await import('../web/js/api.js?logged-out');
  localStorage.removeItem('animetro.user');
  const before = calls;
  assert.equal((await fresh()).size, 0);
  assert.equal(calls, before);
});
