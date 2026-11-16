// Ticket stubs: every show you've completed as a collectible stub, numbered in the order you finished them and
// grouped by the year you arrived. Everything comes from your AniList list entries (COMPLETED and REPEATING);
// nothing is stored. Pure logic (no DOM, no network) so tests/stubs.test.mjs can run it.
import { scale } from './scale.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FACE_WORDS = ["Didn't like it", 'It was okay', 'Liked it'];

// AniList's fuzzy dates can lack the day, the month, or everything. Returns { y, m, d, text } with m and d null
// when unknown ("12 Mar 2024", "Mar 2024", "2024"), or null without a year. Out-of-range parts count as unknown.
export function fuzzyDate(date) {
  const y = Number.isInteger(date?.year) && date.year > 0 ? date.year : null;
  if (!y) return null;
  const m = Number.isInteger(date.month) && date.month >= 1 && date.month <= 12 ? date.month : null;
  const d = m && Number.isInteger(date.day) && date.day >= 1 && date.day <= 31 ? date.day : null;
  return { y, m, d, text: [d, m && MONTHS[m - 1], y].filter(Boolean).join(' ') };
}

// Whole days from boarding to arrival, counting both (same day = 1), when both dates are exact.
export function journeyDays(from, to) {
  if (!from?.d || !to?.d) return null;
  const days = Math.round((Date.UTC(to.y, to.m - 1, to.d) - Date.UTC(from.y, from.m - 1, from.d)) / 86_400_000) + 1;
  return days >= 1 ? days : null;
}

// Where the ride starts and ends. A movie or a one-episode show has no "episode 1 to 1": it runs from the
// opening to the end credits.
export function route(media, progress) {
  const n = media?.episodes || progress || null;
  if (n === 1 || (media?.format === 'MOVIE' && !(n > 1))) return { origin: 'Opening', terminus: 'End credits', stops: 1, single: true };
  if (media?.format === 'MOVIE') return { origin: 'Part 1', terminus: `Part ${n}`, stops: n, single: false };
  return { origin: 'Ep 1', terminus: n ? `Ep ${n}` : 'Last stop', stops: n, single: false };
}

// Episodes × episode length. Without a length on AniList it guesses like the history page (24 minutes, 100 for a
// movie) and says so; without an episode count there's nothing to multiply.
export function rideTime(media, progress) {
  const n = media?.episodes || progress || (media?.format === 'MOVIE' ? 1 : null);
  if (!n) return { minutes: null, estimated: false };
  const len = media?.duration || (media?.format === 'MOVIE' ? 100 : 24);
  return { minutes: n * len, estimated: !media?.duration };
}

// A score in the rider's own AniList format. 0 means not scored (null).
// { text, out, label }: text is what's printed ("8.5", "★★★★☆", "🙂"), out the scale after it ("/10"), label for
// screen readers.
export function scoreText(score, format) {
  if (!(score > 0)) return null;
  if (format === 'POINT_5') {
    const n = Math.min(5, Math.max(1, Math.round(score)));
    return { text: '★'.repeat(n) + '☆'.repeat(5 - n), out: '', label: `${n} out of 5 stars` };
  }
  if (format === 'POINT_3') {
    const n = Math.min(3, Math.max(1, Math.round(score)));
    return { text: scale('POINT_3')[n - 1].label, out: '', label: FACE_WORDS[n - 1] };
  }
  if (format === 'POINT_100') return { text: String(Math.round(score)), out: '/100', label: `${Math.round(score)} out of 100` };
  const v = format === 'POINT_10_DECIMAL' ? String(Math.round(score * 10) / 10) : String(Math.round(score));
  return { text: v, out: '/10', label: `${v} out of 10` };
}

// AniList answers the score format for every public profile; should it ever be missing, read it off the scores.
export const guessFormat = scores => (scores.some(s => s > 10) ? 'POINT_100' : scores.some(s => s % 1) ? 'POINT_10_DECIMAL' : 'POINT_10');

// Oldest arrival first. Shows without a finish date go first: on AniList those are mostly shows from before you
// logged dates (imported lists), and it keeps the newest show's number equal to the number of shows completed.
// A year or month without a day sorts at the start of that year or month.
const key = s => (s.arrived ? [1, s.arrived.y, s.arrived.m || 0, s.arrived.d || 0] : [0, 0, 0, 0]);
const byArrival = (a, b) => {
  const ka = key(a), kb = key(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return (a.updatedAt || 0) - (b.updatedAt || 0) || a.id - b.id;
};

// List entries -> stubs, numbered 1…n in the order you finished them (newest last). Custom lists repeat entries,
// so each show counts once. The number counts every completed show, 18+ ones too, so it doesn't change when 18+ is
// switched on or off; 18+ stubs are left out unless `adult` is true.
// entries: [{ status, score, repeat, progress, updatedAt, startedAt, completedAt, media: { id, format, episodes, duration, isAdult, … } }]
export function stubs(entries, { format, adult = false } = {}) {
  const unique = [...new Map((entries || []).filter(e => e?.media).map(e => [e.media.id, e])).values()];
  const fmt = format || guessFormat(unique.map(e => e.score || 0));
  return unique.map(e => {
    const boarded = fuzzyDate(e.startedAt), arrived = fuzzyDate(e.completedAt);
    return {
      id: e.media.id,
      media: e.media,
      updatedAt: e.updatedAt,
      boarded,
      arrived,
      days: journeyDays(boarded, arrived),
      route: route(e.media, e.progress),
      ride: rideTime(e.media, e.progress),
      score: scoreText(e.score, fmt),
      rewatch: { count: e.repeat || 0, now: e.status === 'REPEATING' },
    };
  }).sort(byArrival).map((s, i) => ({ ...s, no: i + 1 })).filter(s => adult || !s.media.isAdult);
}

// Stubs grouped by the year you arrived, newest year first and newest stub first inside it. Stubs without a finish
// date get their own group at the end (year: null), never a made-up year.
export function album(list) {
  const years = new Map();
  for (const s of [...list].sort((a, b) => b.no - a.no)) {
    const y = s.arrived?.y ?? null;
    if (!years.has(y)) years.set(y, []);
    years.get(y).push(s);
  }
  return [...years].sort(([a], [b]) => (a == null) - (b == null) || b - a).map(([year, stubs]) => ({
    year,
    label: year == null ? 'Arrival date not logged' : String(year),
    stubs,
    minutes: stubs.reduce((t, s) => t + (s.ride.minutes || 0), 0),
  }));
}

// Stub numbers print with at least four digits, like a ticket's serial: No. 0042.
export const serial = no => String(no).padStart(4, '0');
