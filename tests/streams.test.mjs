import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { searchTerm, siteLinks, ANIME_SITES, HENTAI_SITES } from '../web/js/streams.js';

test('the search term drops the season subtitle but keeps titles like Re:Zero whole', () => {
  assert.equal(searchTerm({ title: { romaji: 'Kimetsu no Yaiba: Yuukaku-hen' } }), 'Kimetsu no Yaiba');
  assert.equal(searchTerm({ title: { romaji: 'Re:Zero kara Hajimeru Isekai Seikatsu' } }), 'Re:Zero kara Hajimeru Isekai Seikatsu');
});

test('site links: search, homepage + copy, and direct AniList-ID links', () => {
  const links = siteLinks({ id: 154587, title: { romaji: 'Sousou no Frieren' }, isAdult: false });
  assert.equal(links.length, ANIME_SITES.length);
  assert.equal(links.find(x => x.name === 'Miruro').href, 'https://www.miruro.cx/search?query=Sousou%20no%20Frieren');
  assert.equal(links.find(x => x.name === 'animepahe').kind, 'home');
  assert.equal(links.find(x => x.name === 'AnimeX').href, 'https://animex.one/anime/154587');
});

test('18+ titles get the hentai list', () => {
  assert.equal(siteLinks({ title: { romaji: 'X' }, isAdult: true }).length, HENTAI_SITES.length);
});

test('every site has its bundled logo', () => {
  for (const x of [...siteLinks({ title: { romaji: 'X' } }), ...siteLinks({ title: { romaji: 'X' }, isAdult: true })]) {
    assert.ok(existsSync(new URL('../web/' + x.icon, import.meta.url)), x.icon);
  }
});
