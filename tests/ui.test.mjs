import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeUrl, safeColor, cover, tint, card, esc, safeFilename, fail } from '../web/js/ui.js';
import { UnknownUser } from '../web/js/api.js';

const HOSTILE = 'https://s4.anilist.co/x.jpg" onerror="alert(localStorage.getItem(\'animetro.token\'))';

test('only plain https addresses get into attributes', () => {
  assert.equal(safeUrl('https://s4.anilist.co/file/cover.jpg'), 'https://s4.anilist.co/file/cover.jpg');
  assert.equal(safeUrl(HOSTILE), '');
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('http://example.com/a.jpg'), '');
  assert.equal(safeUrl(null), '');
});

test('only hex colors get into CSS, anything else falls back', () => {
  assert.equal(safeColor('#e4a15d'), '#e4a15d');
  assert.equal(safeColor('red;background:url(x)'), 'var(--rail)');
  assert.equal(safeColor(undefined, '#fff'), '#fff');
});

test('missing covers fall back to a blank image instead of crashing', () => {
  assert.match(cover({ coverImage: null }), /^data:image\/gif/);
  // the fallback must be a complete image, or browsers show it as broken
  const gif = Buffer.from(cover({}).split(',')[1], 'base64');
  assert.match(gif.subarray(0, 6).toString(), /^GIF8[79]a$/);
  assert.equal(gif.readUInt16LE(6), 1, 'width 1');
  assert.equal(gif.at(-1), 0x3b, 'ends with the GIF trailer');
  assert.match(cover({}), /^data:image\/gif/);
  assert.equal(cover({ coverImage: { large: 'https://a.co/l.jpg' } }, 'extraLarge'), 'https://a.co/l.jpg');
  assert.equal(tint({ coverImage: null }, '#123'), '#123');
});

test('a card built from hostile API data carries no injected attributes', () => {
  const html = card({ id: 1, title: { english: '<img src=x onerror=alert(1)>' }, coverImage: { large: HOSTILE, color: '"><script>' }, format: 'TV' });
  assert.ok(!/onerror=/i.test(html.replace(/&lt;img src=x onerror=alert\(1\)&gt;/, '')), html);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes(esc('<img src=x onerror=alert(1)>')), 'the title is shown as text');
});

test('file names built from titles or usernames carry no markup', () => {
  assert.equal(safeFilename('Gangester-animetro-pass.png'), 'Gangester-animetro-pass.png');
  assert.equal(safeFilename('x"><img src=x onerror="alert(1)">.png'), 'x-img-src-x-onerror-alert-1-.png');
  assert.equal(safeFilename('../../etc/passwd'), 'etc-passwd');
  assert.equal(safeFilename(''), 'animetro');
});

test('a page error from an unknown username points to My pass; other errors stay plain and escaped', () => {
  const el = {};
  fail(el, new UnknownUser('ghost<b>'));
  assert.match(el.innerHTML, /No AniList user called &quot;ghost&lt;b&gt;&quot;\./);
  assert.match(el.innerHTML, /<a href="pass\.html">Change it on My pass<\/a>/);
  fail(el, new Error("Couldn't reach AniList."));
  assert.doesNotMatch(el.innerHTML, /pass\.html/);
});
