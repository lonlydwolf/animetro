// Checks that the app hangs together: every page's scripts and styles exist, every module import
// resolves, and every link between pages points at a page that exists. Catches broken moves and renames.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '../web');
const pages = readdirSync(web).filter(f => f.endsWith('.html'));
const scripts = readdirSync(join(web, 'js')).filter(f => f.endsWith('.js'));
const read = f => readFileSync(join(web, f), 'utf8');

test('every page loads styles and scripts that exist', () => {
  for (const page of pages) {
    const html = read(page);
    const refs = [...html.matchAll(/(?:src|href)="([^"#?:]+\.(?:js|css|svg))"/g)].map(m => m[1]);
    assert.ok(refs.some(r => r.endsWith('.js')), `${page} loads a script`);
    for (const ref of refs) assert.ok(existsSync(join(web, ref)), `${page} -> ${ref}`);
  }
});

test('every module import resolves', () => {
  for (const file of scripts) {
    for (const [, spec] of read('js/' + file).matchAll(/from\s+'(\.[^']+)'/g)) {
      assert.ok(existsSync(join(web, 'js', spec)), `js/${file} imports ${spec}`);
    }
  }
});

test('every link between pages points at a page that exists', () => {
  const sources = [...pages.map(p => read(p)), ...scripts.map(f => read('js/' + f))];
  const linked = new Set(sources.flatMap(s => [...s.matchAll(/['"`(]([a-z]+\.html)/g)].map(m => m[1])));
  assert.ok(linked.size > 5);
  for (const page of linked) assert.ok(pages.includes(page), `link to missing page ${page}`);
});

// The Content-Security-Policy, the one copy every page must carry verbatim (no build step, so each page has it
// in a <meta>). Change it here and in all pages together. Why each source is there:
//   style-src 'unsafe-inline': pages and scripts set per-item colors and sizes with style="" attributes
//     (e.g. style="--c:#e4a15d"), which no hash or nonce can cover. Scripts stay strict: no inline, no eval.
//   fonts.googleapis.com / fonts.gstatic.com: the web fonts' stylesheet and files.
//   img-src: AniList covers, banners, avatars and link icons (s4.anilist.co); Crunchyroll episode stills from
//     AniList; Kitsu episode stills; the YouTube trailer still in the Mac app; data: for the blank
//     placeholder; blob: for the share-card preview. The Mac app's __image route is 'self'.
//   connect-src: AniList GraphQL, Kitsu, Simkl. frame-src: the YouTube trailer embed.
// frame-ancestors would be ignored in a <meta>, so it isn't here.
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data: blob: https://s4.anilist.co https://img1.ak.crunchyroll.com https://media.kitsu.app https://media.kitsu.io https://i.ytimg.com",
  "connect-src 'self' https://graphql.anilist.co https://kitsu.io https://api.simkl.com",
  'frame-src https://www.youtube-nocookie.com',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

test('every page carries the same Content-Security-Policy, ahead of anything it governs', () => {
  assert.ok(!/unsafe-eval/.test(CSP) && /script-src 'self';/.test(CSP), 'scripts stay strict');
  for (const page of pages) {
    const html = read(page);
    const metas = [...html.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/g)];
    assert.equal(metas.length, 1, `${page} has one CSP meta`);
    assert.equal(metas[0][1], CSP, `${page} carries the canonical policy`);
    const at = metas[0].index;
    for (const tag of ['<link', '<script', '<style']) {
      const first = html.indexOf(tag);
      assert.ok(first === -1 || first > at, `${page}: CSP meta comes before the first ${tag}`);
    }
  }
});

test('pages have no inline scripts or event-handler attributes (the CSP would block them)', () => {
  for (const page of pages) {
    const html = read(page);
    for (const [tag] of html.matchAll(/<script\b[^>]*>/g)) assert.match(tag, /\ssrc="/, `${page}: ${tag} has a src`);
    assert.doesNotMatch(html, /<[^>]+\son[a-z]+=/i, `${page} has no on*= handlers`);
  }
});

test('every origin the scripts call is in connect-src', () => {
  // API base addresses are module constants: const API = 'https://graphql.anilist.co', and so on
  const connect = CSP.match(/connect-src ([^;]+)/)[1].split(' ');
  const found = scripts.flatMap(file => [...read('js/' + file).matchAll(/const \w+ = '(https:\/\/[^/']+)[^']*';/g)].map(m => [file, m[1]]));
  assert.ok(found.length >= 3, 'found the API constants');
  for (const [file, origin] of found) assert.ok(connect.includes(origin), `js/${file}: ${origin} missing from connect-src`);
});
