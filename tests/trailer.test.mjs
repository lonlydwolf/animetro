import { test } from 'node:test';
import assert from 'node:assert/strict';
import { youtubeId } from '../web/js/trailer.js';

test('a normal YouTube trailer id passes through', () => {
  assert.equal(youtubeId({ id: 'dQw4w9WgXcQ', site: 'youtube' }), 'dQw4w9WgXcQ');
  assert.equal(youtubeId({ id: 'a-b_C1', site: 'youtube' }), 'a-b_C1');
});

test('other sites and missing trailers give nothing', () => {
  assert.equal(youtubeId({ id: 'x7abc12', site: 'dailymotion' }), '');
  assert.equal(youtubeId({ id: 'dQw4w9WgXcQ', site: 'YouTube ' }), '');
  assert.equal(youtubeId({ id: 'dQw4w9WgXcQ' }), '');
  assert.equal(youtubeId(null), '');
  assert.equal(youtubeId(undefined), '');
});

test('ids that could break out of a URL, attribute or CSS url() are rejected', () => {
  for (const id of [
    'abc)def',                         // closes url(
    'x);background:url(//evil.test/a', // CSS injection
    'abc"def', "abc'def", 'a<b>cdef',  // attribute / markup breakout
    'abc def', 'abc\ndef', 'abc\\def', // whitespace, escapes
    '../../x', 'abc?x=1', 'abc#frag', 'abc/def', 'abc&x=1', 'abc%20d',
    'abc', '',                         // too short
    'a'.repeat(21),                    // too long
  ]) assert.equal(youtubeId({ id, site: 'youtube' }), '', JSON.stringify(id));
});

test('non-string ids are rejected', () => {
  for (const id of [123456789, ['dQw4w9WgXcQ'], { toString: () => 'dQw4w9WgXcQ' }, null]) {
    assert.equal(youtubeId({ id, site: 'youtube' }), '');
  }
});
