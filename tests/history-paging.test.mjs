import { supported, $, toastText, settle } from './paging-dom.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const MONTH_AGO = Date.now() / 1000 - 30 * 86400;
const act = p => ({ id: p, status: 'watched episode', progress: '1', createdAt: MONTH_AGO - p * 86400,
  media: { id: p, title: { english: `Show${p}` }, coverImage: {}, format: 'TV', episodes: 12, duration: 24, isAdult: false } });

test('a failed "Load older" keeps the timeline and can be retried', { skip: !supported && 'needs module.registerHooks' }, async () => {
  const asked = [];
  let failNext = false;
  globalThis.__me = { id: 1 };
  globalThis.__gql = async (q, v) => {
    if (q.includes('activityHistory')) return { User: { stats: { activityHistory: [] } } };
    asked.push(v.p);
    if (failNext) { failNext = false; throw new Error("Couldn't reach AniList."); }
    return { Page: { pageInfo: { hasNextPage: v.p < 3 }, activities: [act(v.p)] } };
  };
  await import('../web/js/history.js');
  await settle();
  const log = $('#log'), more = $('#more');
  assert.deepEqual(asked, [1]);
  assert.match(log.innerHTML, /Show1/);

  failNext = true;
  await more.onclick();
  assert.deepEqual(asked, [1, 2]);
  assert.match(log.innerHTML, /Show1/, 'the timeline is still there');
  assert.doesNotMatch(log.innerHTML, /reach AniList/);
  assert.match(toastText(), /Older rides didn't load\. Couldn't reach AniList\./);
  assert.equal(more.disabled, false);
  assert.equal(more.hidden, false);

  await more.onclick();
  assert.deepEqual(asked, [1, 2, 2], 'the retry asks for the same page again');
  assert.match(log.innerHTML, /Show1[\s\S]*Show2/);
  await more.onclick();
  assert.deepEqual(asked, [1, 2, 2, 3]);
  assert.equal(more.hidden, true, 'no more pages after the last one');
});
