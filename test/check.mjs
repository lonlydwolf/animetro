// Run: node test/check.mjs  (no dependencies)
import assert from 'node:assert';
globalThis.location = { hash: '', pathname: '/', search: '', href: 'http://localhost/' }; // api.js peeks at the URL on load
const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), key: i => [...m.keys()][i], get length() { return m.size; } }; };
globalThis.sessionStorage = mem(); globalThis.localStorage = mem();
const { rankSearch, gql } = await import('../js/api.js');
const { crawl, classify, storyOrder, byDate } = await import('../js/order.js');
const { ride, taste, match, TIERS } = await import('../js/score.js');

// ---- 5-minute cache: same query twice = one request; a mutation clears it ----
let calls = 0;
globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ data: { Media: { id: 1 } } }), { headers: { 'X-RateLimit-Remaining': '25' } }); };
await gql('{Media(id:1){id}}');
await gql('{Media(id:1){id}}');
assert.equal(calls, 1);
await gql('mutation{ m0: SaveMediaListEntry(mediaId:1){ mediaId } }');
await gql('{Media(id:1){id}}');
assert.equal(calls, 3);

// ---- the login token only goes with personal queries ----
const sent = [];
globalThis.fetch = async (_, opts) => { sent.push(!!opts.headers.Authorization); return new Response(JSON.stringify({ data: { x: 1 } })); };
localStorage.setItem('animetro.token', 'secret');
await gql('{Page{media(isAdult:true){id}}}');
await gql('{Viewer{id}}');
await gql('query($u:Int){Page{mediaList(userId:$u){mediaId}}}', { u: 1 });
localStorage.removeItem('animetro.token');
assert.deepEqual(sent, [false, true, true]);

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

// ---- 18+ entries only show up when asked for ----
const adultGraph = { media: new Map([[1, { ...m(1, 'TV', 2020), popularity: 5 }], [2, { ...m(2, 'OVA', 2021), isAdult: true }]]), want: new Map([[1, true], [2, true]]), expanded: new Set([1, 2]) };
assert.equal(classify(1, adultGraph).stops.length, 1);
assert.equal(classify(1, adultGraph, { adult: true }).stops.length, 2);

// ---- ride points, tiers, stamps ----
const fresh = ride({ count: 0, episodesWatched: 0, minutesWatched: 0, meanScore: 0, statuses: [], genres: [] });
assert.equal(fresh.points, 0);
assert.equal(fresh.tier.name, TIERS[0].name);
assert.equal(fresh.stamps.filter(x => x.got).length, 0);
const vet = ride({
  count: 294, episodesWatched: 3502, minutesWatched: 87511, meanScore: 78.7,
  statuses: [{ status: 'COMPLETED', count: 260 }, { status: 'PLANNING', count: 244 }, { status: 'DROPPED', count: 11 }],
  genres: Array.from({ length: 14 }, (_, i) => ({ genre: 'g' + i, count: 10 })),
  formats: [{ format: 'MOVIE', count: 39 }], releaseYears: [{ releaseYear: 1988, count: 1 }], lengths: [{ length: '101+', count: 1 }],
  countries: [{ country: 'JP' }, { country: 'CN' }, { country: 'KR' }], studios: [{ count: 23 }],
});
const got = new Set(vet.stamps.filter(x => x.got).map(x => x.name));
for (const name of ['First ride', 'Century', 'Thousand episodes', 'Week pass', 'Month pass', 'Cinema car', 'Time traveler', 'Long haul', 'Genre hopper', 'International transfer', 'Studio regular', 'Dreamer']) assert(got.has(name), name);
for (const name of ['Year pass', 'Tough crowd', 'Emergency exit']) assert(!got.has(name), name);
// 87511/20 + 260*20 + 14*25 + 12 stamps*150
assert.equal(vet.points, 4375 + 5200 + 350 + 1800);
assert.equal(vet.tier.name, 'Limited Express');
assert.equal(vet.next.name, 'Shinkansen');
assert(vet.pct > 0 && vet.pct < 1);
assert.equal(ride({ minutesWatched: 1e7, statuses: [], genres: [] }).next, undefined); // top tier has nowhere to go

// ---- taste match ----
const me = taste({ meanScore: 75, genres: [{ genre: 'Drama', count: 50, meanScore: 85 }, { genre: 'Action', count: 50, meanScore: 60 }],
  tags: [{ count: 40, meanScore: 85, tag: { name: 'Tragedy', category: 'Theme-Drama' } }, { count: 90, meanScore: 75, tag: { name: 'Male Protagonist', category: 'Cast-Main Cast' } }] });
assert(!me.tags.has('Male Protagonist'));            // cast/demographic tags don't count as taste
assert(me.genres.get('Drama') > me.genres.get('Action')); // higher-rated genres weigh more
const sad = match({ genres: ['Drama'], tags: [{ name: 'Tragedy', rank: 90 }], averageScore: 80 }, me);
const loud = match({ genres: ['Action'], tags: [{ name: 'Mecha', rank: 90 }], averageScore: 80 }, me);
assert(sad.pct > loud.pct);
assert.deepEqual(sad.why, ['Tragedy']);
assert(sad.pct <= 100 && loud.pct >= 0);

console.log('all checks passed');
