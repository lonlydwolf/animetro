// Watch-order logic, no DOM and no network: crawl() is handed a fetchMany(ids) function.
// Relations we walk through to find the whole franchise...
const FOLLOW = new Set(['PREQUEL', 'SEQUEL', 'PARENT', 'SIDE_STORY', 'SUMMARY', 'COMPILATION']);
// ...and ones we show as "transfers" but don't walk (walking them pulls in whole other franchises).
const LEAF = new Set(['SPIN_OFF', 'ALTERNATIVE']);
export const MAX_STOPS = 120;
const BATCH = 50; // ids per fetchMany call
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
    const pending = [...want.keys()].filter(id => !media.has(id));
    if (!pending.length) break;
    // never fetch past the cap: each batch is limited to the room that's left
    const room = MAX_STOPS - media.size;
    if (room <= 0) { capped = true; break; }
    const todo = pending.slice(0, Math.min(BATCH, room));
    const found = await fetchMany(todo);
    todo.forEach(id => media.set(id, null));
    found.forEach(m => media.set(m.id, m));
    onProgress([...media.values()].filter(Boolean).length);
    expand();
  }
  return { media, want, expanded, capped };
}

// ---- figure out what each stop is ---------------------------------------
export function classify(rootId, { media, want, expanded }, { adult = false } = {}) {
  const all = [...media.values()].filter(m => m && (adult || !m.isAdult) && m.format !== 'MUSIC');
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
    // a format AniList hasn't filled in yet (upcoming sequels) still counts as main story
    if (chain.has(m.id) && (MAIN_FORMATS.has(m.format) || !m.format)) m.role = 'main';
    else if (rel.has('SUMMARY') || rel.has('COMPILATION')) m.role = 'recap';
    else if (want.get(m.id) || chain.has(m.id)) m.role = 'side';
    else m.role = rel.has('ALTERNATIVE') ? 'Alternate version' : 'Spin-off';
    (ROLE[m.role] ? stops : transfers).push(m);
  }
  return { stops, transfers, anchor };
}

// ---- train services: which stops most people skip ---------------------------
// Express = the main story. Rapid = the main story plus the extras most fans watch. Local = every stop.
// AniList has no "canon" flag, so we read the crowd: popularity is how many users have an entry on their
// list, and a side story only a few % of the main show's audience bothered with is usually skippable.
const REACH = .25; // a side stop on a quarter of the main show's lists still rides the Rapid
// months: newer entries haven't collected list adds yet, so popularity can't judge them. Kept short because real
// story movies get added fast (Chainsaw Man's Reze movie: 250k lists within a year; the JJK compilation: 2%)
const FRESH = 6;
export function service(m, anchor, now = new Date()) {
  const reach = anchor?.popularity ? Math.min(1, (m.popularity || 0) / anchor.popularity) : 0;
  const pct = Math.round(reach * 100);
  const s = m.startDate || {};
  const fresh = s.year && (now.getFullYear() * 12 + now.getMonth()) - (s.year * 12 + (s.month || 1) - 1) < FRESH;
  if (m.role === 'main') {
    // theatrical compilations of TV seasons are often linked as sequels; real story movies get watched,
    // compilations don't (JJK 0: 45% of fans, the JJK recap films: 2-3%)
    if (m.format !== 'TV' && m.format !== 'TV_SHORT' && m.format && m.status !== 'NOT_YET_RELEASED' && !fresh && reach < .1)
      return { level: 'local', why: `probably a compilation: on only ${pct}% of fans' lists` };
    return { level: 'express' };
  }
  if (m.role === 'recap') return { level: 'local', why: 'recap of earlier episodes' };
  // not out yet: hardly anyone has it on their list, so popularity says nothing
  if (m.status === 'NOT_YET_RELEASED') return { level: 'rapid', why: 'not out yet' };
  if (fresh && reach < REACH) return { level: 'rapid', why: 'new, too early to judge' };
  if (m.tags?.some(t => t.name === 'Chibi')) return { level: 'local', why: 'chibi comedy short' };
  if (m.duration && m.duration <= 15 && m.format !== 'TV') return { level: 'local', why: `${m.duration}-minute extra` };
  if (reach >= REACH) return { level: 'rapid', why: `on ${pct}% of fans' lists` };
  return { level: 'local', why: reach < .01 ? "on fewer than 1% of fans' lists" : `on only ${pct}% of fans' lists` };
}

const dateKey = m => {
  const s = m.startDate || {};
  return (s.year ?? 9999) * 10000 + (s.month ?? 12) * 100 + (s.day ?? 31);
};
export const byDate = (a, b) => dateKey(a) - dateKey(b) || a.id - b.id;

// ---- Junction Box: where spin-offs and other versions branch off the line ---------------------------------
// Each transfer hangs off the stop it's related to (from either side's relations). If that stop isn't shown
// (Express hides it, say), it moves back to the nearest shown stop before it in `order` (the release or story
// order on screen, before filtering); with no link at all, it goes by release date.
// Returns Map(shown stop id -> [{ media, kind: 'alt' | 'spin', earlier }]).
export function junctions(shown, order, transfers) {
  const out = new Map();
  if (!shown.length) return out;
  const visible = new Set(shown);
  const linked = (a, b) => a.relations?.edges.filter(e => e.node.id === b.id).map(e => e.relationType) || [];
  const byRelease = [...shown].sort(byDate);
  const back = s => order.slice(0, order.indexOf(s) + 1).reverse().find(x => visible.has(x)) || shown[0];
  for (const t of [...transfers].sort(byDate)) {
    const from = order.filter(s => linked(s, t).length || linked(t, s).length).sort(byDate)[0];
    const types = from ? [...linked(from, t), ...linked(t, from)] : [];
    const at = from ? back(from) : [...byRelease].reverse().find(s => dateKey(s) <= dateKey(t)) || byRelease[0];
    const kind = types.includes('ALTERNATIVE') || t.role === 'Alternate version' ? 'alt' : 'spin';
    out.set(at.id, [...(out.get(at.id) || []), { media: t, kind, earlier: from ? dateKey(t) < dateKey(from) : false }]);
  }
  return out;
}

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
