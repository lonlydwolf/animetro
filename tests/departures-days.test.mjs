import { supported, $, settle, deferred } from './paging-dom.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The departures board against a scripted AniList: each airing query waits for its day's answer.
const answers = [];
const airing = name => ({ episode: 1, airingAt: Date.now() / 1000 + 3600, media: { id: name.length, isAdult: false, popularity: 9999, episodes: 12, title: { english: name }, coverImage: {} } });
const day = name => ({ p1: { airingSchedules: [airing(name)] }, p2: { airingSchedules: [] } });
globalThis.__me = null;
globalThis.__listStatus = async () => new Map();
globalThis.__gql = () => { const a = deferred(); answers.push(a); return a.p; };
globalThis.setInterval = () => 0; // the board's clock would keep the test process alive
document.querySelectorAll = () => [];
let clickDay;
$('#days').addEventListener = (_, f) => (clickDay = n => f({ target: { closest: () => ({ dataset: { day: String(n) } }) } }));
const board = () => $('#rows').innerHTML;
const skip = !supported && 'needs module.registerHooks';

test("a late answer for an earlier day doesn't overwrite the selected day", { skip }, async () => {
  await import('../web/js/departures.js');
  const [today] = answers;
  clickDay(1);
  const [, tomorrow] = answers;
  tomorrow.resolve(day('Tomorrow show')); await settle();
  assert.match(board(), /Tomorrow show/);
  today.resolve(day('Today show')); await settle();
  assert.match(board(), /Tomorrow show/);
  assert.doesNotMatch(board(), /Today show/);
});

test("a late failure for an earlier day doesn't replace the board", { skip }, async () => {
  clickDay(2);
  const slow = answers.at(-1);
  clickDay(3);
  answers.at(-1).resolve(day('Day three show')); await settle();
  slow.reject(new Error('stale failure')); await settle();
  assert.match(board(), /Day three show/);
});

test('changing a filter while a day loads keeps the loading message', { skip }, async () => {
  clickDay(4);
  $('#niche').onchange();
  assert.match(board(), /Loading board/);
  answers.at(-1).reject(new Error('AniList is down')); await settle();
  assert.match(board(), /AniList is down/);
  $('#niche').onchange();
  assert.match(board(), /AniList is down/, 'the error stays put too');
});
