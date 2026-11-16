// Year on the rails: a year of riding, from every list update the rider logged on AniList that year.
// Distance, busiest line, longest streak, new studio districts, completions. Pure logic (no DOM, no network) so
// tests/year.test.mjs can run it; history.js does the fetching (through yearLoader below) and the drawing.
import { title } from './api.js';
import { describe, dayKey } from './journal.js';

const DAY = 86_400_000;
const TOUCHED = new Set(['COMPLETED', 'REPEATING', 'CURRENT', 'PAUSED', 'DROPPED']);

// The year in unix seconds, local time: from its first second up to (not including) the next year's first.
// AniList's createdAt_greater / createdAt_lesser are exclusive, hence the -1 on the way in.
export function yearBounds(year) {
  return { from: new Date(year, 0, 1) / 1000, to: new Date(year + 1, 0, 1) / 1000 };
}

// 'YYYY-MM-DD' -> a whole day number, so consecutive days differ by exactly 1 (no clocks, no DST).
const dayNo = key => Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / DAY;

// The longest run of consecutive days in `keys` ('YYYY-MM-DD'): { days, from, to }, or null for none.
export function longestStreak(keys) {
  const days = [...new Set(keys)].sort();
  let best = null, start = 0;
  for (let i = 0; i < days.length; i++) {
    if (i && dayNo(days[i]) - dayNo(days[i - 1]) !== 1) start = i;
    const n = i - start + 1;
    if (!best || n > best.days) best = { days: n, from: days[start], to: days[i] };
  }
  return best;
}

// The main animation studio of a show (not a producer like Aniplex that AniList also marks as main), as My map reads it.
export const studioOf = m => (m?.studios?.nodes || []).find(n => n.isAnimationStudio)?.name || null;

// The rider's year. acts: AniList ListActivity objects (18+ already left out if the rider hides them), in any order.
// lines: My map's lines (map.js franchises(), each with a color), to group shows into franchise lines. entries: the
// rider's list entries (My map's query), for studios and for what was ridden before this year. tz: an IANA zone for
// the days, default the rider's own. Without lines or entries every show is its own line and no district is new.
export function review(acts, year, { lines = [], entries = [], tz } = {}) {
  const lineOf = new Map();
  for (const l of lines) for (const s of l.stations) if (s.list) lineOf.set(s.id, l);
  const entryOf = new Map(entries.map(e => [e.media.id, e]));

  // this year's activities, oldest first, each with its day in the rider's time zone
  const rows = acts.map(a => ({ a, d: describe(a), day: dayKey(a.createdAt, tz) }))
    .filter(r => r.day.startsWith(`${year}-`))
    .sort((x, y) => x.a.createdAt - y.a.createdAt || x.a.id - y.a.id);
  const rides = rows.filter(r => r.d.kind !== 'list'); // episodes, rewatches and completions; plans and drops aren't riding

  const months = Array.from({ length: 12 }, () => ({ eps: 0, minutes: 0, days: 0 }));
  const seenDay = new Set();
  for (const r of rides) {
    const m = months[+r.day.slice(5, 7) - 1];
    m.eps += r.d.eps; m.minutes += r.d.minutes;
    if (!seenDay.has(r.day)) { seenDay.add(r.day); m.days++; }
  }
  const eps = months.reduce((n, m) => n + m.eps, 0), minutes = months.reduce((n, m) => n + m.minutes, 0);
  const top = months.reduce((b, m, i) => (m.eps > (months[b]?.eps ?? 0) ? i : b), -1);

  // franchise lines by episodes logged. A show that isn't on the list (any more) rides a line of its own.
  const byLine = new Map();
  for (const r of rides) {
    if (!r.d.eps) continue;
    const m = r.a.media, l = lineOf.get(m.id);
    const key = l ? `l${l.id}` : `m${m.id}`;
    if (!byLine.has(key)) {
      byLine.set(key, { key, id: (l?.anchor || m).id, name: title(l?.anchor || m), color: l?.color || m.coverImage?.color || null, eps: 0, minutes: 0, shows: new Set() });
    }
    const x = byLine.get(key);
    x.eps += r.d.eps; x.minutes += r.d.minutes; x.shows.add(m.id);
  }
  const ranked = [...byLine.values()].map(x => ({ ...x, shows: x.shows.size }))
    .sort((a, b) => b.eps - a.eps || b.minutes - a.minutes || a.name.localeCompare(b.name));

  // shows finished this year, in the order they were finished (each once)
  const done = new Map();
  for (const r of rows) if (r.d.kind === 'completed' && !done.has(r.a.media.id)) done.set(r.a.media.id, { media: r.a.media, at: r.a.createdAt, day: r.day });

  return {
    year, logs: rows.length, eps, minutes,
    days: seenDay.size,
    shows: new Set(rides.filter(r => r.d.eps).map(r => r.a.media.id)).size,
    streak: longestStreak([...seenDay]),
    months, busiestMonth: top >= 0 && months[top].eps ? top : null,
    lines: ranked, busiest: ranked[0] || null,
    completed: [...done.values()],
    bulk: batch(rows),
    districts: opened(rides, year, entryOf),
    first: rides[0] ? ride(rides[0]) : null,
    last: rides.length ? ride(rides.at(-1)) : null,
  };
}

// Completions logged in one go (an import, or a sync tool catching up): runs of BATCH or more, each within
// GAP seconds of the last. They still count, but the page says so. { shows, day } with the biggest run's day, or null.
const BATCH = 20, GAP = 300;
function batch(rows) {
  const runs = [];
  let run = [];
  for (const r of rows) {
    if (r.d.kind !== 'completed') continue;
    if (run.length && r.a.createdAt - run.at(-1).a.createdAt > GAP) { runs.push(run); run = []; }
    run.push(r);
  }
  runs.push(run);
  const big = runs.filter(x => x.length >= BATCH);
  if (!big.length) return null;
  const shows = new Set(big.flatMap(x => x.map(r => r.a.media.id))).size;
  return { shows, day: big.reduce((a, b) => (b.length > a.length ? b : a))[0].day };
}

const ride = r => ({ at: r.a.createdAt, day: r.day, media: r.a.media, verb: r.d.verb });

// New districts: studios first ridden this year. A studio is opened by the first show of its you logged riding this
// year, unless your list says you rode the studio before: one of its shows started or finished before this year, or
// one you'd ridden (watching, finished, paused, dropped) with no dates on AniList that you didn't ride this year,
// such as an imported list. Unknown history counts as earlier, so a list without dates doesn't make every studio new.
function opened(rides, year, entryOf) {
  const ridden = new Set(rides.map(r => r.a.media.id));
  const dateYear = e => Math.min(e.startedAt?.year || Infinity, e.completedAt?.year || Infinity);
  const before = new Set();
  for (const e of entryOf.values()) {
    const studio = studioOf(e.media);
    if (!studio || !TOUCHED.has(e.status)) continue;
    const y = dateYear(e);
    if (Number.isFinite(y) ? y < year : !ridden.has(e.media.id)) before.add(studio);
  }
  const out = new Map();
  for (const r of rides) {
    const studio = studioOf(entryOf.get(r.a.media.id)?.media);
    if (studio && !before.has(studio) && !out.has(studio)) out.set(studio, { name: studio, media: r.a.media, at: r.a.createdAt, day: r.day });
  }
  return [...out.values()];
}

// Loads each year's activities a page at a time, keeping every year apart: switching years mid-load stops the old
// year after the page in flight (what it got is kept, and it carries on from there if you switch back), and a year
// never sees another year's activities. fetchPage(year, page) -> { acts, more }. onPage(year, state) after each page.
// state: { acts, pages, more, error }. Activities are kept once each by id, so a page that shifted because something
// new was logged mid-load can't count twice.
export function yearLoader(fetchPage, onPage = () => {}) {
  const years = new Map();
  let active = null;
  const state = y => {
    if (!years.has(y)) years.set(y, { acts: [], ids: new Set(), pages: 0, more: true, error: null, run: null });
    return years.get(y);
  };
  // resolves with the year's state when it's fully loaded or no longer the active year; rejects if a page fails
  function load(y) {
    active = y;
    const s = state(y);
    s.error = null;
    s.run ||= (async () => {
      try {
        while (s.more && active === y) {
          const { acts, more } = await fetchPage(y, s.pages + 1);
          s.pages++; // only once the page has arrived, so a failed one is asked for again
          s.more = more;
          for (const a of acts) if (!s.ids.has(a.id)) { s.ids.add(a.id); s.acts.push(a); }
          onPage(y, s);
        }
      } catch (e) {
        s.error = e;
        throw e;
      } finally {
        s.run = null;
      }
      return s;
    })();
    return s.run;
  }
  return { load, get: y => years.get(y), get active() { return active; } };
}
