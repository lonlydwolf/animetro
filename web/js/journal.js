// Watch history helpers: turn AniList list activities into readable rows, and daily counts into a streak.
// Pure logic (no DOM, no network) so test/check.mjs can run it.

// AniList writes progress as "4" or "1 - 10".
export function episodesIn(progress) {
  if (!progress) return 0;
  const [a, b] = String(progress).split('-').map(n => parseInt(n, 10));
  return b ? Math.max(1, b - a + 1) : 1;
}

// One activity -> { kind, verb, eps, minutes }. kind drives filters and the icon.
export function describe(a) {
  const eps = episodesIn(a.progress), len = a.media?.duration || (a.media?.format === 'MOVIE' ? 100 : 24);
  const range = String(a.progress || '').replace(/\s*-\s*/, '–');
  const s = (a.status || '').toLowerCase();
  if (s.startsWith('watched')) return { kind: 'watched', verb: eps > 1 ? `Watched episodes ${range} of` : `Watched episode ${range} of`, eps, minutes: eps * len };
  if (s === 'rewatching') return { kind: 'watched', verb: 'Started rewatching', eps: 0, minutes: 0 };
  if (s.startsWith('rewatched')) return { kind: 'watched', verb: eps > 1 ? `Rewatched episodes ${range} of` : a.progress ? `Rewatched episode ${range} of` : 'Rewatched', eps, minutes: eps * len };
  if (s === 'completed') return { kind: 'completed', verb: 'Completed', eps: 0, minutes: 0 };
  if (s.startsWith('plans')) return { kind: 'list', verb: 'Planned to watch', eps: 0, minutes: 0 };
  if (s === 'dropped') return { kind: 'list', verb: 'Dropped', eps: 0, minutes: 0 };
  if (s.startsWith('paused')) return { kind: 'list', verb: 'Paused', eps: 0, minutes: 0 };
  return { kind: 'list', verb: a.status ? a.status[0].toUpperCase() + a.status.slice(1) : 'Updated', eps: 0, minutes: 0 };
}

export const dayKey = (t, tz) => new Date(t * 1000).toLocaleDateString('en-CA', tz ? { timeZone: tz } : undefined); // YYYY-MM-DD

// Consecutive days with activity, ending today (or yesterday, so the streak survives until you watch today).
export function streak(days, today) {
  const set = new Set(days);
  const d = new Date(today + 'T12:00:00');
  if (!set.has(today)) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(d.toLocaleDateString('en-CA'))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
