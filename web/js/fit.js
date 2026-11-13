// "Got some time?": fills a time budget with episodes you can actually watch now.
// Pure logic (no DOM, no network) so test/check.mjs can run it.

import { airedCount } from './episodes.js';

export const epMinutes = m => m.duration || (m.format === 'MOVIE' ? 100 : 24);

// Logging this episode completes the show only when AniList knows the final count and you've reached it.
// (Episodes aired so far is not the end: catching up with an airing show must not mark it Completed.)
export const finishes = (progress, m) => !!m?.episodes && progress >= m.episodes;

// The progress a Home action saves. +1 is the next episode, or null (save nothing) past a known final count;
// Mark completed keeps what you've watched, brought down to the final count if a list somehow went past it.
export const logged = (progress, m, complete = false) => {
  const total = m?.episodes || Infinity;
  return complete ? Math.min(progress, total) : progress + 1 > total ? null : progress + 1;
};

// What's left of a show you're watching: episodes out but unwatched, and whether watching them all finishes it.
// airedCount() decides what is out. When it can't tell (airing with no schedule on AniList), out is null and nothing
// counts as ready: the show is neither "all watched" nor "every episode ready", and logging stays open up to the final
// count. Reaching AniList's final count ends the show whatever the schedule says.
export function remaining(e) {
  const m = e.media, p = e.progress || 0, total = m.episodes;
  let aired = airedCount(m);
  if (aired == null && total && p >= total) aired = Infinity;
  const unknown = aired == null, airing = aired !== Infinity;
  const out = unknown ? null : Math.min(aired, total || (m.format === 'MOVIE' ? 1 : airing ? Infinity : 0));
  const left = unknown ? 0 : Math.max(0, out - p);
  return {
    out, left, airing, unknown,
    // "last" = one episode left of a finished show that has more than one episode (a movie is just one sitting)
    last: !airing && left === 1 && out > 1,
    // +1 makes sense: an episode is known to be out, or might be (schedule unknown, final count not reached)
    more: left > 0 || unknown,
    minutes: left * epMinutes(m),
  };
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
