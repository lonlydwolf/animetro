import { gql, me, token, saveEntries } from './api.js';
import { esc, STATUS } from './ui.js';

// The rider's entries for `ids` as Map(mediaId -> entry), or null when AniList couldn't be asked. Unlike
// listStatus() a failed lookup is never an empty Map: "couldn't check" must not read as "not on your list".
// `viewer` also asks AniList whose token this is and gives null unless it's `user`; `fresh` skips the cache.
export async function listedStatus(user, ids, query = gql, { viewer = false, fresh = false } = {}) {
  if (!user || !ids.length) return new Map();
  const parts = Array.from({ length: Math.ceil(ids.length / 50) }, (_, i) =>
    `p${i}: Page(page:${i + 1},perPage:50){ mediaList(userId:$u,type:ANIME,mediaId_in:$ids){ mediaId status progress } }`);
  try {
    const d = await query(`query($u:Int,$ids:[Int]){ ${viewer ? 'Viewer{ id } ' : ''}${parts.join(' ')} }`, { u: user.id, ids }, { fresh });
    if (viewer && d?.Viewer?.id !== user.id) return null; // the token belongs to someone else now
    const pages = parts.map((_, i) => d?.[`p${i}`]?.mediaList);
    if (!pages.every(Array.isArray)) return null; // a page missing from a partial answer counts as unknown
    const entries = pages.flat();
    // an entry we can't pin to a show (nulled by a partial answer) could be any of them: all unknown
    if (!entries.every(e => e && Number.isInteger(e.mediaId))) return null;
    return new Map(entries.map(e => [e.mediaId, e]));
  } catch { return null; }
}

// 'listed': on your list with a status we know. 'absent': confirmed not on your list, the only state that may add.
// 'unknown': the list couldn't be checked, or the show is on it but its status is null, missing or unrecognised.
export function slotState(entry, known = true) {
  if (entry) return Object.hasOwn(STATUS, entry.status ?? '') ? 'listed' : 'unknown';
  return known ? 'absent' : 'unknown';
}

// The list slot on a gacha result: the status a show already has on your list, or "+ Planning" only when the show is
// confirmed absent. Unknown gets no add, only a button to check again. `busy` greys the buttons while a check runs.
export function planSlot(id, entry, canWrite, known = true, busy = false) {
  const state = slotState(entry, known);
  if (state === 'listed') return `<span class="tag s-${esc(entry.status)}">${esc(STATUS[entry.status])}</span>`;
  if (!canWrite) return '';
  const off = busy ? ' disabled' : '';
  return state === 'absent'
    ? `<button class="tag add" data-plan="${+id}"${off}>+ Planning</button>`
    : `<button class="tag" data-recheck="${+id}" title="Couldn't check your list, so adding is off for now"${off}>↻ Check list</button>`;
}

// Everything gacha knows about your list, one record per show, so every card of a show shows the same thing.
// What a card shows is only a hint: + Planning looks the show up again, fresh and checked against the signed-in
// account, and saves only if it's confirmed absent. Each lookup takes a per-show generation, and an answer that
// a newer lookup or a save has overtaken is dropped. An answer that comes back after the token changed counts
// as unknown.
//   rider(): the signed-in rider ({ id, canWrite }); token(): the current token; lookup/save: listedStatus/saveEntries.
export function planBoard({ rider = me, token: tok = token, lookup = listedStatus, save = saveEntries } = {}) {
  const info = new Map(), gens = new Map(), busy = new Set();
  const next = id => { const g = (gens.get(id) || 0) + 1; gens.set(id, g); return g; };
  const state = id => slotState(info.get(id)?.entry, info.get(id)?.known ?? false);
  const record = (id, mine, sameRider) => info.set(id, sameRider && mine ? { entry: mine.get(id), known: true } : { known: false });
  // who's signed in: null for nobody, undefined if that can't be read right now (me() rejects then)
  const who = () => Promise.resolve().then(rider).catch(() => undefined);
  const ask = async (ids, opts) => { const u = await who(); return u === undefined ? null : lookup(u, ids, undefined, opts); };

  return {
    state,
    slot: (id, canWrite) => planSlot(id, info.get(id)?.entry, canWrite, info.get(id)?.known ?? false, busy.has(id)),

    // after a pull: what the list says about these shows (a hint for rendering)
    async learn(ids) {
      const t = tok(), g = new Map(ids.map(id => [id, next(id)]));
      const mine = await ask(ids);
      for (const id of ids) if (gens.get(id) === g.get(id)) record(id, mine, tok() === t);
    },

    // "Check list": 'stale' if a newer lookup overtook this one, else the show's state now
    async recheck(id) {
      const g = next(id), t = tok();
      const mine = await ask([id], { fresh: true }); // really ask again, not the page cache
      if (gens.get(id) !== g) return 'stale';
      record(id, mine, tok() === t);
      return state(id);
    },

    // "+ Planning": 'added' once saved; otherwise the show's state now ('busy' if a save for it is already running)
    async add(id) {
      if (busy.has(id)) return 'busy';
      busy.add(id);
      try {
        const g = next(id), t = tok(), person = await who();
        if (person === undefined) { record(id, null, false); return 'unknown'; } // can't tell who would be saving
        if (!person?.canWrite) return state(id);
        const mine = await lookup(person, [id], undefined, { viewer: true, fresh: true });
        if (gens.get(id) !== g) return state(id);
        // nothing is awaited between this check and the save call, so the write goes out with the token just checked
        if (tok() !== t || !mine) { record(id, null, false); return 'unknown'; }
        if (mine.get(id)) { record(id, mine, true); return state(id); } // already on your list: never overwrite it
        let saved;
        try { saved = (await save([{ mediaId: id, status: 'PLANNING' }]))?.m0; } catch (err) { next(id); record(id, null, false); throw err; }
        next(id); // anything asked before the save is out of date now
        info.set(id, { entry: saved?.status ? saved : { status: 'PLANNING' }, known: true });
        return 'added';
      } finally { busy.delete(id); }
    },
  };
}
