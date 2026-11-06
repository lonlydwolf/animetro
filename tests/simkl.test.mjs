import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../web/js/simkl.js';

const ent = (id, status, progress, extra = {}) => ({ status, progress, score: 0, media: { id, idMal: id + 1000, episodes: 12, title: { romaji: 'T' + id } }, ...extra });
const row = (anilist, status, watched, extra = {}) => ({ status, watched_episodes_count: watched, anime: { ids: { simkl: anilist * 7, anilist: String(anilist) } }, ...extra });

test('backup sync only sends what differs and never removes anything', () => {
  const p = plan([
    ent(1, 'COMPLETED', 12),             // new on Simkl, finished: whole show completed
    ent(2, 'CURRENT', 5),                // Simkl has 3: episodes 4 and 5
    ent(3, 'PLANNING', 0),               // Simkl says watching: move to plan to watch
    ent(4, 'COMPLETED', 12),             // already completed: nothing
    ent(5, 'PAUSED', 2, { score: 8.4 }), // same status and episodes, new rating: rating only
    ent(6, 'CURRENT', 1),                // matched by MAL id only
    ent(7, 'REPEATING', 3),              // rewatching counts as completed
  ], [row(2, 'watching', 3), row(3, 'watching', 0), row(4, 'completed', 12), row(5, 'hold', 2, { user_rating: 6 }),
    { status: 'watching', watched_episodes_count: 1, anime: { ids: { mal: '1006' } } }, row(7, 'completed', 12)]);
  assert.deepEqual(p.history, [
    { ids: { anilist: 1, mal: 1001 }, status: 'completed' },
    { ids: { anilist: 2, mal: 1002 }, status: 'watching', episodes: [{ number: 4 }, { number: 5 }] },
  ]);
  assert.deepEqual(p.list, [{ ids: { anilist: 3, mal: 1003 }, to: 'plantowatch' }]);
  assert.deepEqual(p.ratings, [{ ids: { anilist: 5, mal: 1005 }, rating: 8 }]);
  assert.deepEqual(p.changes.map(c => c.media.id), [1, 2, 3, 5]);
  assert.equal(p.episodes, 12 + 2);
});

test('a show on AniList with no progress yet is added as watching', () => {
  assert.equal(plan([ent(9, 'CURRENT', 0)], []).list[0].to, 'watching');
});
