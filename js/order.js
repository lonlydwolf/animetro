// Watch-order logic, no DOM and no network: crawl() is handed a fetchMany(ids) function.
// Relations we walk through to find the whole franchise...
const FOLLOW = new Set(['PREQUEL', 'SEQUEL', 'PARENT', 'SIDE_STORY', 'SUMMARY', 'COMPILATION']);
// ...and ones we show as "transfers" but don't walk (walking them pulls in whole other franchises).
const LEAF = new Set(['SPIN_OFF', 'ALTERNATIVE']);
const MAX_STOPS = 120;
const MAIN_FORMATS = new Set(['TV', 'TV_SHORT', 'ONA', 'MOVIE']);

export const ROLE = {
  main: 'Main story',
  side: 'Side story',
  recap: 'Recap, safe to skip',
};

// ---- crawl ---------------------------------------------------------------
export async function crawl(rootId, fetchMany, onProgress = () => {}) {
  const media = new Map();            // id -> media (null if AniList didn't return it)
  const want = new Map([[rootId, true]]); // id -> should we walk its relations?
  const expanded = new Set();
  const expand = () => {
    for (let changed = true; changed;) {
      changed = false;
      for (const [id, follow] of [...want]) {
        const m = media.get(id);
        if (!follow || !m || expanded.has(id)) continue;
        expanded.add(id);
        changed = true;
        for (const e of m.relations.edges) {
          if (e.node.type !== 'ANIME') continue;
          if (FOLLOW.has(e.relationType)) want.set(e.node.id, true);
          else if (LEAF.has(e.relationType) && !want.has(e.node.id)) want.set(e.node.id, false);
        }
      }
    }
  };
  let capped = false;
  for (;;) {
    const todo = [...want.keys()].filter(id => !media.has(id)).slice(0, 50);
    if (!todo.length) break;
    if (media.size >= MAX_STOPS) { capped = true; break; }
    const found = await fetchMany(todo);
    todo.forEach(id => media.set(id, null));
    found.forEach(m => media.set(m.id, m));
    onProgress([...media.values()].filter(Boolean).length);
    expand();
  }
  return { media, want, expanded, capped };
}

// ---- figure out what each stop is ---------------------------------------
export function classify(rootId, { media, want, expanded }) {
  const all = [...media.values()].filter(m => m && !m.isAdult && m.format !== 'MUSIC');
  if (!all.length) throw new Error('That series could not be found on AniList.');
  const byId = new Map(all.map(m => [m.id, m]));
  const inbound = new Map(all.map(m => [m.id, new Set()]));
  for (const id of expanded) {
    for (const e of media.get(id)?.relations.edges || []) inbound.get(e.node.id)?.add(e.relationType);
  }
  const followed = all.filter(m => want.get(m.id));
  const pop = arr => arr.reduce((a, b) => (b.popularity > (a?.popularity ?? -1) ? b : a), null);
  const anchor = pop(followed.filter(m => ['TV', 'TV_SHORT', 'ONA'].includes(m.format))) || pop(followed) || byId.get(rootId);

  // Main line = everything connected to the anchor through prequel/sequel links.
  const chain = new Set([anchor.id]);
  for (const queue = [anchor]; queue.length;) {
    const m = queue.pop();
    for (const e of m.relations.edges) {
      const n = byId.get(e.node.id);
      if (n && (e.relationType === 'SEQUEL' || e.relationType === 'PREQUEL') && !chain.has(n.id)) { chain.add(n.id); queue.push(n); }
    }
  }
  const stops = [], transfers = [];
  for (const m of all) {
    const rel = inbound.get(m.id);
    if (chain.has(m.id) && MAIN_FORMATS.has(m.format)) m.role = 'main';
    else if (rel.has('SUMMARY') || rel.has('COMPILATION')) m.role = 'recap';
    else if (want.get(m.id) || chain.has(m.id)) m.role = 'side';
    else m.role = rel.has('ALTERNATIVE') ? 'Alternate version' : 'Spin-off';
    (ROLE[m.role] ? stops : transfers).push(m);
  }
  return { stops, transfers, anchor };
}

const dateKey = m => {
  const s = m.startDate || {};
  return (s.year ?? 9999) * 10000 + (s.month ?? 12) * 100 + (s.day ?? 31);
};
export const byDate = (a, b) => dateKey(a) - dateKey(b) || a.id - b.id;

// Story order: respect prequel/sequel/side-story links, break ties by release date.
export function storyOrder(stops) {
  const ids = new Set(stops.map(m => m.id));
  const next = new Map(stops.map(m => [m.id, new Set()]));
  const indeg = new Map(stops.map(m => [m.id, 0]));
  const edge = (a, b) => { if (a !== b && !next.get(a).has(b)) { next.get(a).add(b); indeg.set(b, indeg.get(b) + 1); } };
  for (const m of stops) {
    for (const e of m.relations.edges) {
      if (!ids.has(e.node.id)) continue;
      if (['SEQUEL', 'SIDE_STORY', 'SUMMARY', 'COMPILATION'].includes(e.relationType)) edge(m.id, e.node.id);
      if (['PREQUEL', 'PARENT'].includes(e.relationType)) edge(e.node.id, m.id);
    }
  }
  const left = [...stops].sort(byDate), out = [];
  while (left.length) {
    // ponytail: O(n²) pick, n <= 120 stops so it's instant
    let i = left.findIndex(m => indeg.get(m.id) === 0);
    if (i < 0) i = 0; // cycle in AniList data: fall back to earliest release
    const [m] = left.splice(i, 1);
    out.push(m);
    for (const n of next.get(m.id)) indeg.set(n, indeg.get(n) - 1);
  }
  return out;
}
