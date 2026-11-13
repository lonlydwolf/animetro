import './setup.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { searchBox } from '../web/js/ui.js';

// The header typeahead against a scripted AniList: each search term gets its own pending answer.
const answers = new Map();
const pending = s => { if (!answers.has(s)) { let resolve; answers.set(s, { p: new Promise(r => (resolve = r)), resolve: () => resolve() }); } return answers.get(s); };
const media = s => [{ id: s.length * 10, popularity: 1, title: { english: s, romaji: s }, format: 'TV', coverImage: {} }];
let fetched = [];
globalThis.fetch = async (_, opts) => {
  const { s } = JSON.parse(opts.body).variables;
  fetched.push(s);
  await pending(s).p;
  return new Response(JSON.stringify({ data: { Page: { media: media(s) } } }));
};
globalThis.document = { createElement: () => ({ setAttribute() {}, addEventListener() {}, innerHTML: '', classList: { toggle() {} } }) };

const wait = ms => new Promise(r => setTimeout(r, ms));
const DEBOUNCE = 400; // a little over the box's 350ms

function box() {
  const on = {}, picked = [], queried = [];
  const input = { value: '', after() {}, setAttribute() {}, addEventListener: (t, f) => (on[t] = f) };
  searchBox(input, m => picked.push(m.title.english), q => queried.push(q));
  const type = v => { input.value = v; on.input(); };
  const key = (k, extra = {}) => { const e = { key: k, prevented: false, preventDefault() { this.prevented = true; }, ...extra }; on.keydown(e); return e; };
  return { type, key, picked, queried };
}
beforeEach(() => { answers.clear(); fetched = []; });

test('Enter before any suggestion arrives searches for the typed text', async () => {
  const b = box();
  b.type('Frieren');
  const e = b.key('Enter');
  assert.ok(e.prevented);
  assert.deepEqual(b.queried, ['Frieren']);
  assert.deepEqual(b.picked, []);
  await wait(DEBOUNCE);
  assert.deepEqual(fetched, [], 'the pending lookup was cancelled');
});

test('Enter picks the top suggestion once it belongs to the current text', async () => {
  const b = box();
  b.type('Mushishi');
  await wait(DEBOUNCE); pending('Mushishi').resolve(); await wait(10);
  b.key('Enter');
  assert.deepEqual(b.picked, ['Mushishi']);
  assert.deepEqual(b.queried, []);
});

test("while new text is loading, Enter never picks the previous text's suggestion", async () => {
  const b = box();
  b.type('Gintama');
  await wait(DEBOUNCE); pending('Gintama').resolve(); await wait(10);
  b.type('Haikyu');           // Gintama's rows must not survive this keystroke
  b.key('ArrowDown');
  b.key('Enter');
  assert.deepEqual(b.picked, []);
  assert.deepEqual(b.queried, ['Haikyu']);
});

test('a slower answer to older text is ignored', async () => {
  const b = box();
  b.type('Monogatari');
  await wait(DEBOUNCE);       // Monogatari is in flight
  b.type('Mob Psycho');
  await wait(DEBOUNCE);       // Mob Psycho is in flight too
  pending('Mob Psycho').resolve(); await wait(10);
  pending('Monogatari').resolve(); await wait(10);
  b.key('Enter');
  assert.deepEqual(b.picked, ['Mob Psycho']);
});

test('Escape drops the suggestions and a lookup still in flight', async () => {
  const b = box();
  b.type('Bocchi');
  await wait(DEBOUNCE);
  b.key('Escape');
  pending('Bocchi').resolve(); await wait(10);
  b.key('Enter');
  assert.deepEqual(b.picked, []);
  assert.deepEqual(b.queried, ['Bocchi']);
});

test('Enter on an empty box does nothing', () => {
  const b = box();
  b.type('  ');
  assert.equal(b.key('Enter').prevented, false);
  assert.deepEqual(b.queried, []);
});

test('by default the typed text opens its line, which finds the best match', () => {
  const on = {};
  searchBox({ value: 'Fate/Zero', after() {}, setAttribute() {}, addEventListener: (t, f) => (on[t] = f) }, () => {});
  on.keydown({ key: 'Enter', preventDefault() {} });
  assert.equal(location.href, 'line.html?q=Fate%2FZero');
  location.href = 'http://localhost/';
});

test('keys pressed while an IME is composing are left to the IME', async () => {
  const b = box();
  b.type('しんげき');
  // Enter here confirms the composed text; browsers mark it isComposing, older Safari only with keyCode 229
  for (const extra of [{ isComposing: true }, { keyCode: 229 }]) {
    for (const k of ['Enter', 'ArrowDown', 'Escape']) assert.equal(b.key(k, extra).prevented, false, `${k} ${JSON.stringify(extra)}`);
  }
  assert.deepEqual(b.queried, [], 'composing Enter does not search the unfinished text');
  assert.deepEqual(b.picked, []);
  // composition done: the suggestions still load, and a plain Enter picks them
  b.type('進撃');
  await wait(DEBOUNCE); pending('進撃').resolve(); await wait(10);
  b.key('Enter', { isComposing: true });
  assert.deepEqual(b.picked, []);
  b.key('Enter');
  assert.deepEqual(b.picked, ['進撃']);
});

test('after composing, a plain Enter with no suggestions searches the text', () => {
  const b = box();
  b.type('鬼滅');
  b.key('Enter', { isComposing: true, keyCode: 229 });
  assert.deepEqual(b.queried, []);
  b.key('Enter');
  assert.deepEqual(b.queried, ['鬼滅']);
});
