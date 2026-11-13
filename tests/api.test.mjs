import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gql, rankSearch, saveEntries } from '../web/js/api.js';

test('a repeated query within 5 minutes is answered from the cache', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ data: { Media: { id: 1 } } }), { headers: { 'X-RateLimit-Remaining': '25' } }); };
  await gql('{Media(id:1){id}}');
  await gql('{Media(id:1){id}}');
  assert.equal(calls, 1);
});

test('a list change refetches every answer it could have changed, and keeps public lookups', async () => {
  const asked = [];
  globalThis.fetch = async (_, opts) => {
    asked.push(JSON.parse(opts.body).query);
    return new Response(JSON.stringify({ data: { x: { id: 1 } } }), { headers: { 'X-RateLimit-Remaining': '25' } });
  };
  localStorage.setItem('animetro.token', 'test-token');
  const listBound = [
    '{Viewer{id name}}',
    'query($u:Int){ MediaListCollection(userId:$u,type:ANIME){ lists{ entries{ mediaId status } } } }',
    'query($u:Int,$ids:[Int]){ p0: Page(page:1,perPage:50){ mediaList(userId:$u,mediaId_in:$ids){ mediaId status } } }',
    'query($id:Int){ Media(id:$id){ id mediaListEntry{ status progress } } }', // list fields embedded in a media lookup
    'query($id:Int){ MediaList(userId:1,mediaId:$id){ status } }',
    'query($u:Int){ User(id:$u){ statistics{ anime{ count episodesWatched } } } }', // personal aggregates
    'query($u:Int,$p:Int){ Page(page:$p){ activities(userId:$u,type:ANIME_LIST){ ... on ListActivity{ id progress } } } }', // public, but yours
  ];
  const publicOnes = [
    'query($ids:[Int]){Page(perPage:50){media(id_in:$ids,type:ANIME){id relations{edges{relationType}}}}}', // a crawl
    'query($id:Int){ Media(id:$id,type:ANIME){ id title{english} description } }',
    '{ GenreCollection }',
  ];
  const all = [...listBound, ...publicOnes];
  for (const q of all) await gql(q, { u: 1, id: 2, ids: [3], p: 1 });
  for (const q of all) await gql(q, { u: 1, id: 2, ids: [3], p: 1 });
  assert.equal(asked.length, all.length, 'second round is all cached');
  asked.length = 0;
  await gql('mutation{ m0: SaveMediaListEntry(mediaId:2,progress:1){ mediaId } }');
  for (const q of all) await gql(q, { u: 1, id: 2, ids: [3], p: 1 });
  localStorage.removeItem('animetro.token');
  assert.deepEqual(asked.slice(1), listBound);
});

test('mediaListEntry is a personal field, so it goes with the token', async () => {
  let auth;
  globalThis.fetch = async (_, opts) => { auth = opts.headers.Authorization; return new Response(JSON.stringify({ data: { Media: { id: 1 } } })); };
  localStorage.setItem('animetro.token', 'test-token');
  await gql('query($id:Int){ Media(id:$id){ id mediaListEntry{ status } } }', { id: 9 });
  localStorage.removeItem('animetro.token');
  assert.equal(auth, 'Bearer test-token');
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

test('a batch save that only partly succeeds is reported as a failure, with what did save', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: { m0: { mediaId: 10, status: 'PLANNING', progress: 0 }, m1: null },
    errors: [{ message: 'validation', status: 400 }],
  }));
  await assert.rejects(saveEntries([{ mediaId: 10, status: 'PLANNING' }, { mediaId: 11, status: 'PLANNING' }]),
    err => { assert.deepEqual(err.saved, [10]); assert.match(err.message, /Saved 1 of 2/); return true; });
});

test('a batch save that fully succeeds returns every entry', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { m0: { mediaId: 10 }, m1: { mediaId: 11 } } }));
  const d = await saveEntries([{ mediaId: 10, status: 'PLANNING' }, { mediaId: 11, status: 'PLANNING' }]);
  assert.equal(d.m1.mediaId, 11);
});
