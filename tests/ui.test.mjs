import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeUrl, safeColor, cover, tint, card, esc } from '../web/js/ui.js';

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
