import { supported, $, toastText, settle, deferred } from './paging-dom.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Explore's results grid against a scripted AniList: each media query takes the next handler from `plan`.
const asked = [], plan = [];
let listStatus = async () => new Map();
const page = (p, tag) => ({ Page: { pageInfo: { hasNextPage: true }, media: [{ id: p, title: { english: `${tag}-p${p}` }, coverImage: {}, format: 'TV' }] } });
globalThis.__me = null;
globalThis.__listStatus = ids => listStatus(ids);
globalThis.__gql = async (q, v) => {
  if (q.includes('GenreCollection')) return { GenreCollection: [], MediaTagCollection: [] };
  asked.push(v.page);
  return (plan.shift() ?? (() => page(v.page, 'q')))(v);
};
const results = () => $('#results'), more = () => $('#more');
const newSearch = () => $('#reset').onclick();
const skip = !supported && 'needs module.registerHooks';

test('explore loads its first page', { skip }, async () => {
  await import('../web/js/explore.js');
  await settle();
  assert.deepEqual(asked, [1]);
  assert.match(results().innerHTML, /q-p1/);
});

test('a failed load-more keeps the results and retries the same page', { skip }, async () => {
  asked.length = 0;
  plan.push(() => { throw new Error('Too many requests'); });
  more().onclick(); await settle();
  assert.deepEqual(asked, [2]);
  assert.match(results().innerHTML, /q-p1/, 'earlier results are still there');
  assert.doesNotMatch(results().innerHTML, /Too many/);
  assert.match(toastText(), /More results didn't load\. Too many requests/);
  assert.equal(more().disabled, false);
  assert.equal(more().hidden, false);
  assert.equal(results().style.opacity, 1);

  more().onclick(); await settle();
  more().onclick(); await settle();
  assert.deepEqual(asked, [2, 2, 3], 'page 2 is retried, not skipped');
  assert.match(results().innerHTML, /q-p1[\s\S]*q-p2[\s\S]*q-p3/);
});

test('an older query still waiting on list status cannot overwrite a newer one', { skip }, async () => {
  const status = deferred();
  let first = true;
  listStatus = async () => (first ? ((first = false), status.p) : new Map());
  plan.push(v => page(v.page, 'A'), v => page(v.page, 'B'));
  newSearch(); await settle(); // A has its page and is waiting inside cards()
  newSearch(); await settle(); // B renders
  assert.match(results().innerHTML, /B-p1/);
  status.resolve(new Map()); await settle();
  assert.match(results().innerHTML, /B-p1/);
  assert.doesNotMatch(results().innerHTML, /A-p1/);
  listStatus = async () => new Map();
});

test('an older query failing late is ignored', { skip }, async () => {
  const slow = deferred();
  plan.push(() => slow.p, v => page(v.page, 'C'));
  newSearch(); await settle();
  newSearch(); await settle();
  $('.toast').textContent = '';
  slow.reject(new Error('stale failure')); await settle();
  assert.match(results().innerHTML, /C-p1/);
  assert.equal(toastText(), '');
});

test('a load-more overtaken by a new query neither appends nor moves the page', { skip }, async () => {
  const slow = deferred();
  plan.push(() => slow.p, v => page(v.page, 'D'));
  more().onclick(); await settle();
  newSearch(); await settle();
  slow.resolve(page(2, 'C')); await settle();
  assert.match(results().innerHTML, /D-p1/);
  assert.doesNotMatch(results().innerHTML, /C-p2/);
  asked.length = 0;
  more().onclick(); await settle();
  assert.deepEqual(asked, [2], 'the next load-more is page 2 of the new query');
});

test('a load-more resuming after a newer search started leaves the page and button alone', { skip }, async () => {
  const status = deferred(), newer = deferred();
  listStatus = () => status.p;
  plan.push(v => ({ Page: { pageInfo: { hasNextPage: false }, media: page(v.page, 'old').Page.media } }), () => newer.p);
  more().onclick(); await settle(); // the load-more has its page and waits on list status inside cards()
  // the instant cards() writes, a newer search starts: after cards' own check, before search() resumes
  const R = results(), append = R.insertAdjacentHTML;
  R.insertAdjacentHTML = function (...args) { R.insertAdjacentHTML = append; append.apply(this, args); queueMicrotask(newSearch); };
  listStatus = async () => new Map();
  status.resolve(new Map()); await settle();
  assert.equal(more().hidden, false, "the old last-page flag doesn't hide the newer search's button");
  assert.equal(more().disabled, true, 'the newer search still owns the button');
  newer.resolve(page(1, 'E')); await settle();
  assert.match(results().innerHTML, /E-p1/);
  assert.equal(more().disabled, false);
  asked.length = 0;
  more().onclick(); await settle();
  assert.deepEqual(asked, [2], 'the page counter follows the newer search');
});

test('a failed first page shows the error in place and hides load-more', { skip }, async () => {
  plan.push(() => { throw new Error('AniList is down'); });
  newSearch(); await settle();
  assert.match(results().innerHTML, /AniList is down/);
  assert.equal(more().hidden, true);
  assert.equal(results().style.opacity, 1);
});
