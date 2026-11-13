import { gql, me, token, saveEntries, RateLimited } from './api.js';
import { esc, STATUS } from './ui.js';

// The rider's entries for `ids` as Map(mediaId -> entry), or null when AniList couldn't be asked. Unlike
// listStatus() a failed lookup is never an empty Map: "couldn't check" must not read as "not on your list".
// `viewer` also asks AniList whose token this is and gives null unless it's `user`; `fresh` skips the cache.
export async function listedStatus(user, ids, query = gql, { viewer = false, fresh = false } = {}) {
  if (!user || !ids.length) return new Map();
  const parts = Array.from({ length: Math.ceil(ids.length / 50) }, (_, i) =>
    `p${i}: Page(page:${i + 1},perPage:50){ mediaList(userId:$u,type:ANIME,mediaId_in:$ids){ mediaId status progress updatedAt } }`);
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

// ---- saving what the page showed ------------------------------------------------------------------------------
// A page shows your list as it was when it loaded; another tab or app may have changed it since. A save built
// from that view (+ Planning on a show that "isn't on your list", +1 from an old episode count) could then undo
// what you did elsewhere, e.g. move a Completed show back to Planning. So every change is checked at the click:
// one fresh lookup for all of them, asked as the account that's signed in (Viewer must still be the rider this page
// shows), then one save, sent once, of only the changes whose entry is still exactly what the page showed.

// The entry the page showed is still the entry on AniList: both absent, or same status and progress.
export const unchanged = (seen, now) => (seen ? !!now && now.status === seen.status && (now.progress ?? 0) === (seen.progress ?? 0) : !now);

// items: [{ id, seen, change }]: seen = the entry the page showed (undefined: not on your list), change = the
// fields to save. current(): false once the caller no longer wants this answer (checked after the lookup).
// Resolves to {
//   saved:   Map(id -> entry as AniList saved it),
//   changed: Map(id -> entry now, null if it's gone): not what the page showed, so not saved,
//   unknown: [ids] not saved because the list couldn't be checked or the account changed, or saved-or-not after
//            an error (error says which),
//   rateLimited: AniList refused the save for now; nothing was saved,
//   readOnly: nobody who can write is signed in; stale: current() said no. Nothing was saved for either.
// }
export async function saveChecked(items, { rider = me, token: tok = token, lookup = listedStatus, save = saveEntries, current = () => true } = {}) {
  const out = { saved: new Map(), changed: new Map(), unknown: [], rateLimited: false, readOnly: false, stale: false, error: null };
  const ids = items.map(x => x.id);
  if (!items.length) return out;
  const t = tok();
  const person = await Promise.resolve().then(rider).catch(() => undefined); // undefined: can't tell who's signed in
  if (person === undefined) { out.unknown = ids; return out; }
  if (!person?.canWrite) { out.readOnly = true; return out; }
  const mine = await lookup(person, ids, undefined, { viewer: true, fresh: true });
  if (!current()) { out.stale = true; return out; }
  // nothing is awaited between this check and the save call, so the save goes out with the token just checked
  if (tok() !== t || !mine) { out.unknown = ids; return out; }
  const go = [];
  for (const x of items) if (unchanged(x.seen, mine.get(x.id))) go.push(x); else out.changed.set(x.id, mine.get(x.id) ?? null);
  if (!go.length) return out;
  try {
    // one attempt, now: a resend after a rate-limit wait would act on a check that may no longer hold
    const d = await save(go.map(x => ({ mediaId: x.id, ...x.change })), { retry: false });
    go.forEach((x, i) => out.saved.set(x.id, d?.[`m${i}`]?.status ? d[`m${i}`] : { mediaId: x.id, ...x.change }));
  } catch (err) {
    if (err instanceof RateLimited) { out.rateLimited = true; return out; }
    out.error = err;
    const ok = new Set(err.saved || []); // a batch AniList only partly saved
    for (const x of go) if (ok.has(x.id)) out.saved.set(x.id, { mediaId: x.id, ...x.change }); else out.unknown.push(x.id);
  }
  return out;
}

// "Add to Planning" for shows the page showed as not on your list.
export const addToPlanning = (ids, deps) => saveChecked(ids.map(id => ({ id, seen: undefined, change: { status: 'PLANNING' } })), deps);

// What happened, in a sentence: "Added 3 to Planning; 2 were already on your list."
export function planReport(r, asked) {
  if (r.rateLimited) return 'AniList is busy right now, so nothing was added. Try again in a moment.';
  if (r.readOnly) return 'Log in with AniList on My pass to add shows to your list.';
  const added = r.saved.size, listed = r.changed.size, missed = r.unknown.length;
  if (!added && !listed && missed && !r.error) return "Couldn't check your list, so nothing was added. Try again in a moment.";
  if (!added && listed && !missed) return listed === 1 && asked === 1 ? "It's already on your list, so nothing was changed." : `${listed !== asked ? listed : listed === 2 ? 'Both' : `All ${listed}`} ${listed === 1 ? 'was' : 'were'} already on your list, so nothing was added.`;
  const parts = [];
  if (added) parts.push(added === 1 && asked === 1 ? 'Added to Planning' : `Added ${added} to Planning`);
  if (listed) parts.push(`${listed} ${listed === 1 ? 'was' : 'were'} already on your list`);
  if (missed) parts.push(`${missed} didn't go through${r.error ? ` (${String(r.error.message).replace(/\.$/, '')})` : ''}; try again`);
  return parts.join('; ') + '.';
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

    // "+ Planning": 'added' once saved; 'rate-limited' if AniList refused it for now (nothing saved); otherwise the
    // show's state now ('busy' if a save for it is already running)
    async add(id) {
      if (busy.has(id)) return 'busy';
      busy.add(id);
      try {
        const g = next(id);
        const r = await saveChecked([{ id, seen: undefined, change: { status: 'PLANNING' } }],
          { rider, token: tok, lookup, save, current: () => gens.get(id) === g });
        if (r.stale || r.readOnly) return state(id);
        if (r.changed.has(id)) { info.set(id, { entry: r.changed.get(id), known: true }); return state(id); } // never overwrite it
        if (r.unknown.length && !r.error) { record(id, null, false); return 'unknown'; } // couldn't check, or the account changed
        next(id); // a save was attempted: anything asked before it is out of date now
        // refused: nothing was done, so + Planning again; the next click runs the whole check again
        if (r.rateLimited) { info.set(id, { known: true }); return 'rate-limited'; }
        if (r.error) { record(id, null, false); throw r.error; } // it may or may not have saved
        info.set(id, { entry: r.saved.get(id), known: true });
        return 'added';
      } finally { busy.delete(id); }
    },
  };
}
