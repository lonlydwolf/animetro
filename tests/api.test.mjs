import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gql, rankSearch } from '../web/js/api.js';

test('a repeated query within 5 minutes is answered from the cache; a mutation clears it', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ data: { Media: { id: 1 } } }), { headers: { 'X-RateLimit-Remaining': '25' } }); };
  await gql('{Media(id:1){id}}');
  await gql('{Media(id:1){id}}');
  assert.equal(calls, 1);
  await gql('mutation{ m0: SaveMediaListEntry(mediaId:1){ mediaId } }');
  await gql('{Media(id:1){id}}');
  assert.equal(calls, 3);
});

test('the login token is only sent with personal queries', async () => {
  const sent = [];
  globalThis.fetch = async (_, opts) => { sent.push(!!opts.headers.Authorization); return new Response(JSON.stringify({ data: { x: 1 } })); };
  localStorage.setItem('animetro.token', 'test-token');
  await gql('{Page{media(isAdult:true){id}}}');
  await gql('{Viewer{id}}');
  await gql('query($u:Int){Page{mediaList(userId:$u){mediaId}}}', { u: 1 });
  localStorage.removeItem('animetro.token');
  assert.deepEqual(sent, [false, true, true]);
});

test('search re-ranks exact and contained title matches above obscure synonym hits', () => {
  const t = (id, english, romaji, popularity) => ({ id, title: { english, romaji }, popularity });
  const hits = [t(1, 'Onigiri', 'Onigiri', 9000), t(2, 'Demon Slayer The Movie: Mugen Train', 'x', 517000), t(3, 'Demon Slayer: Kimetsu no Yaiba', 'Kimetsu no Yaiba', 1012000)];
  assert.deepEqual(rankSearch(hits, 'Demon Slayer').map(m => m.id), [3, 2, 1]);
  assert.equal(rankSearch(hits, 'onigiri')[0].id, 1);
  assert.equal(rankSearch(hits, 'kimetsu no yaiba')[0].id, 3);
  assert.deepEqual(rankSearch([t(5, 'A', 'A', 1), t(6, 'B', 'B', 9)], 'zzz').map(m => m.id), [5, 6]);
});
