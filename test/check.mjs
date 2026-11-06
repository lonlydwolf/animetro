// Run: node test/check.mjs  (no dependencies)
import assert from 'node:assert';
globalThis.location = { hash: '', pathname: '/', search: '' }; // api.js peeks at the URL on load
const { rankSearch } = await import('../js/api.js');
const { crawl, classify, storyOrder, byDate } = await import('../js/order.js');

// ---- search re-ranking ----
const t = (id, english, romaji, popularity) => ({ id, title: { english, romaji }, popularity });
const hits = [t(1, 'Onigiri', 'Onigiri', 9000), t(2, 'Demon Slayer The Movie: Mugen Train', 'x', 517000), t(3, 'Demon Slayer: Kimetsu no Yaiba', 'Kimetsu no Yaiba', 1012000)];
assert.deepEqual(rankSearch(hits, 'Demon Slayer').map(m => m.id), [3, 2, 1]);
assert.equal(rankSearch(hits, 'onigiri')[0].id, 1);
assert.equal(rankSearch(hits, 'kimetsu no yaiba')[0].id, 3);
assert.deepEqual(rankSearch([t(5, 'A', 'A', 1), t(6, 'B', 'B', 9)], 'zzz').map(m => m.id), [5, 6]);

// ---- watch order on a tiny fake franchise ----
const m = (id, format, year, rel = {}, popularity = 100) => ({
  id, format, popularity, isAdult: false, startDate: { year, month: 1, day: 1 },
  relations: { edges: Object.entries(rel).flatMap(([type, ids]) => ids.map(n => ({ relationType: type, node: { id: n, type: 'ANIME' } }))) },
});
const db = new Map([
  m(1, 'TV', 2009, { SEQUEL: [2], SIDE_STORY: [4, 9], SUMMARY: [5], PREQUEL: [3], SPIN_OFF: [6], ALTERNATIVE: [7] }, 900),
  m(2, 'TV', 2012, { PREQUEL: [1] }),
  m(3, 'MOVIE', 2016, { SEQUEL: [1] }),          // prequel released later
  m(4, 'OVA', 2010, { PARENT: [1] }),
  m(5, 'MOVIE', 2013, { PARENT: [1] }),          // recap film
  m(6, 'TV', 2015, { SEQUEL: [8] }),             // spin-off: shown, not walked
  m(7, 'TV', 2020),                              // alternate version
  m(8, 'TV', 2018),                              // spin-off's sequel: must never be fetched
  m(9, 'MUSIC', 2011, { PARENT: [1] }),          // music video: hidden
].map(x => [x.id, x]));
const asked = [];
const graph = await crawl(2, async ids => { asked.push(...ids); return ids.map(id => db.get(id)); });
assert.ok(!asked.includes(8), 'spin-off relations are not walked');
const { stops, transfers, anchor } = classify(2, graph);
const role = id => stops.concat(transfers).find(s => s.id === id)?.role;
assert.equal(anchor.id, 1);
assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(role), ['main', 'main', 'main', 'side', 'recap', 'Spin-off', 'Alternate version']);
assert.equal(role(9), undefined);
assert.deepEqual([...stops].sort(byDate).map(s => s.id), [1, 4, 2, 5, 3]);   // release order
assert.deepEqual(storyOrder(stops).map(s => s.id), [3, 1, 4, 2, 5]);          // story order: prequel film first

console.log('all checks passed');
