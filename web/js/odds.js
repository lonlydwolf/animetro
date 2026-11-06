// "Will I finish it?": your chance of finishing a show, from what you finished and dropped before.
// Pure logic so test/check.mjs can run it. Inputs are AniList list entries:
// { status, updatedAt, media: { episodes, format, genres, status } }.
//
// How: start from your overall finish rate, then nudge it by how you do with shows of the same length,
// format and genres. Each group's rate is pulled toward your overall rate until it has enough titles
// (so 3 dropped OVAs don't swing everything), and genres share one vote between them.

const LENGTH = [[1, 1, 'single-episode titles'], [2, 6, 'shows of 2 to 6 episodes'], [7, 13, '12-episode-ish shows'],
  [14, 26, 'two-cour shows (14 to 26 episodes)'], [27, 52, 'shows of 27 to 52 episodes'], [53, Infinity, 'shows over 52 episodes']];
const FORMAT = { TV: 'TV shows', TV_SHORT: 'short TV shows', MOVIE: 'movies', OVA: 'OVAs', ONA: 'web series (ONAs)', SPECIAL: 'specials' };
// still-airing shows have no total yet, so count what's aired
const count = m => m.episodes || (m.nextAiringEpisode ? m.nextAiringEpisode.episode - 1 : 0);
const lengthOf = m => count(m) > 0 && LENGTH.find(([a, b]) => count(m) >= a && count(m) <= b);

const SMOOTH = 6, MIN = 3, MIN_HISTORY = 10;
const logit = p => Math.log(p / (1 - p));
const clamp = p => Math.min(.97, Math.max(.03, p));

const QUIET = 90 * 86400; // untouched this long = quietly given up (lots of people never press "Dropped")

// 1 = finished, 0 = gave up, null = still undecided (left out)
export function outcome(e, now = Date.now() / 1000) {
  const stale = now - (e.updatedAt || now) > QUIET;
  if (e.status === 'COMPLETED' || e.status === 'REPEATING') return 1;
  if (e.status === 'DROPPED') return 0;
  if (e.status === 'PAUSED') return stale ? 0 : .5;
  if (e.status === 'CURRENT') return stale && e.media.status === 'FINISHED' ? 0 : null;
  return null;
}

export function finishOdds(history, media, now = Date.now() / 1000) {
  const scored = history.map(e => ({ m: e.media, v: outcome(e, now) })).filter(x => x.v != null);
  if (scored.length < MIN_HISTORY) return null;
  const base = clamp(scored.reduce((a, x) => a + x.v, 0) / scored.length);
  const group = (test, label) => {
    const hits = scored.filter(x => test(x.m));
    if (hits.length < MIN) return null;
    const raw = hits.reduce((a, x) => a + x.v, 0) / hits.length;
    const rate = clamp((raw * hits.length + base * SMOOTH) / (hits.length + SMOOTH));
    return { label, raw, n: hits.length, shift: logit(rate) - logit(base) };
  };
  const len = lengthOf(media), feats = [];
  if (len) feats.push({ ...group(m => lengthOf(m) === len, len[2]), weight: 1 });
  if (FORMAT[media.format]) feats.push({ ...group(m => m.format === media.format, FORMAT[media.format]), weight: .7 });
  const genres = (media.genres || []).map(g => group(m => m.genres?.includes(g), `${g} shows`)).filter(Boolean);
  genres.forEach(g => feats.push({ ...g, weight: 1 / genres.length })); // all genres together count as one vote
  const used = feats.filter(f => f.label && f.n);
  const pct = Math.round(100 / (1 + Math.exp(-(logit(base) + used.reduce((a, f) => a + f.shift * f.weight, 0)))));
  const reasons = used.filter(f => Math.abs(f.shift) > .3 && Math.abs(f.raw - base) >= .05).sort((a, b) => Math.abs(b.shift * b.weight) - Math.abs(a.shift * a.weight)).slice(0, 2)
    .map(f => f.raw >= base ? `You finish ${Math.round(f.raw * 100)}% of ${f.label}` : `You leave ${Math.round((1 - f.raw) * 100)}% of ${f.label} unfinished`);
  return { pct, base: Math.round(base * 100), reasons, from: scored.length };
}
