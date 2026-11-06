// "Got some time?": fills a time budget with episodes you can actually watch now.
// Pure logic (no DOM, no network) so test/check.mjs can run it.

const released = m => (m.status === 'NOT_YET_RELEASED' ? 0
  : m.nextAiringEpisode ? m.nextAiringEpisode.episode - 1
  : m.episodes ?? (m.format === 'MOVIE' ? 1 : 0));
export const epMinutes = m => m.duration || (m.format === 'MOVIE' ? 100 : 24);

// Logging this episode completes the show only when AniList knows the final count and you've reached it.
// (Episodes aired so far is not the end: catching up with an airing show must not mark it Completed.)
export const finishes = (progress, m) => !!m?.episodes && progress >= m.episodes;

// What's left of a show you're watching: episodes out but unwatched, and whether watching them all finishes it.
export function remaining(e) {
  const m = e.media, out = released(m), left = Math.max(0, out - (e.progress || 0));
  // "last" = one episode left of a finished show that has more than one episode (a movie is just one sitting)
  return { out, left, airing: !!m.nextAiringEpisode, last: !m.nextAiringEpisode && left === 1 && out > 1, minutes: left * epMinutes(m) };
}

// riding: list entries you're watching; planning: entries on your Planning list (each { progress, media }).
// Order: shows closest to the finish line first (finishing feels good), then the best-rated new starts.
// Each pick takes as many consecutive episodes as still fit; a movie fits whole or not at all.
export function fit(minutes, riding, planning, { maxNew = 2 } = {}) {
  const cand = e => ({ media: e.media, from: (e.progress || 0) + 1, ...remaining(e) });
  const now = riding.map(cand).filter(c => c.left > 0).sort((a, b) => a.minutes - b.minutes);
  const next = planning.map(cand).filter(c => c.left > 0).sort((a, b) => (b.media.averageScore || 0) - (a.media.averageScore || 0));
  let time = minutes, started = 0;
  const picks = [];
  for (const c of [...now, ...next]) {
    const fresh = !riding.some(e => e.media.id === c.media.id);
    if (fresh && started >= maxNew) continue; // don't scatter a flight across ten new shows
    const len = epMinutes(c.media);
    const n = c.media.format === 'MOVIE' ? (len <= time ? 1 : 0) : Math.min(c.left, Math.floor(time / len));
    if (!n) continue;
    picks.push({ media: c.media, from: c.from, to: c.from + n - 1, eps: n, minutes: n * len, finishes: n === c.left && !c.airing, fresh });
    time -= n * len;
    if (fresh) started++;
    if (time < 10) break;
  }
  return { picks, used: minutes - time };
}
