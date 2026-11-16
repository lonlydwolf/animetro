// "Shared carriage": your metro map overlaid with a friend's. The lines you share, who rode each station,
// a compatibility score and the shows waiting in both Planning lists.
// No DOM or network, so tests/carriage.test.mjs can run it.
import { franchises, marker } from './map.js';

// Statuses that count as having ridden a station: anything you started, finished or gave up on. Planning doesn't.
export const RODE = new Set(['COMPLETED', 'REPEATING', 'CURRENT', 'PAUSED', 'DROPPED']);

// A list as My map uses it: one entry per show, 18+ shows (and 18+ neighbouring stops) left out unless 18+ is on.
export function clean(entries, adult = false) {
  const keep = m => !m?.isAdult || adult;
  return [...new Map(entries.map(e => [e.media.id, e])).values()]
    .filter(e => keep(e.media))
    .map(e => ({ ...e, media: { ...e.media, relations: { edges: (e.media.relations?.edges || []).filter(x => keep(x.node)) } } }));
}

// Your lines with your friend's rides laid over them.
// lines: your franchises (as My map draws them), plus any of your friend's rides that sit on them, as extra stations.
//   Each station gets who: 'both' | 'me' | 'friend' | null and them: your friend's list status (or null).
//   A line is shared when you've both ridden at least one of its stations; shared lines come first.
// theirs: your friend's lines where you haven't ridden (or even reached) a single station.
export function overlay(mine, friends, now = new Date()) {
  const my = new Map(mine.map(e => [e.media.id, e.status]));
  const their = new Map(friends.map(e => [e.media.id, e.status]));
  // their rides you don't have on your list ride along as stations of yours you haven't been to
  const extra = friends.filter(e => RODE.has(e.status) && !my.has(e.media.id)).map(e => ({ status: null, progress: 0, media: e.media }));
  const lines = franchises([...mine, ...extra], now);
  for (const l of lines) {
    for (const s of l.stations) {
      const a = RODE.has(my.get(s.id)), b = RODE.has(their.get(s.id));
      s.who = a && b ? 'both' : a ? 'me' : b ? 'friend' : null;
      s.them = their.get(s.id) ?? null;
    }
    l.shared = l.stations.some(s => s.who === 'both' || s.who === 'me') && l.stations.some(s => s.who === 'both' || s.who === 'friend');
    l.both = l.stations.filter(s => s.who === 'both').length;
  }
  // stable: within each group franchises()' order (biggest first) holds
  lines.sort((a, b) => b.shared - a.shared);
  const near = new Set(lines.flatMap(l => l.stations.map(s => s.id)));
  const theirs = franchises(friends, now).filter(l => !l.stations.some(s => near.has(s.id)));
  return { lines, theirs };
}

// ---- compatibility ---------------------------------------------------------
// Scores arrive on AniList's 100-point scale (score(format: POINT_100)), whatever format each rider uses.
// A coarse format can't say 87: a 5-star rider's 4 stars covers 70-89. So two scores count as apart only by
// what's left after half the coarser rider's step (the 100-point scales, plain and decimal, have no step to speak of).
export const STEP = { POINT_100: 0, POINT_10_DECIMAL: 0, POINT_10: 10, POINT_5: 20, POINT_3: 25 };
const step = f => STEP[f] ?? 0;
export const MIN_SHARED = 10; // shows you've both ridden, below which there's nothing to judge (one tiny list says little)
export const MIN_SCORED = 5; // shows you've both scored, below which scores aren't compared
export const FAR = 40; // points apart (after the allowance) at which score agreement reaches 0

// a = { entries, format }, b = the same for the other rider. The same answer whichever comes first.
// score: 0-100, or null when you have too little in common to judge.
// basis: 'both' (overlap and scores, 50 points each), 'overlap' (too few shows you both scored: overlap only), or null.
export function compatibility(a, b) {
  const seen = r => new Map(r.entries.filter(e => RODE.has(e.status)).map(e => [e.media.id, e.score || 0]));
  const A = seen(a), B = seen(b);
  const shared = [...A.keys()].filter(id => B.has(id));
  const out = { mine: A.size, theirs: B.size, shared: shared.length, overlap: 0, scored: 0, gap: null, apart: null, lean: null, agreement: null, points: { overlap: 0, scores: 0 }, score: null, basis: null };
  if (shared.length < MIN_SHARED) return out;
  // overlap: shared / sqrt(yours × theirs), the geometric middle of "how much of your list" and "how much of theirs",
  // so a long list next to a short one isn't punished the way shared / everything would. Square-rooted because
  // even close friends share well under half their lists.
  out.overlap = shared.length / Math.sqrt(A.size * B.size);
  const fit = Math.sqrt(out.overlap);
  const both = shared.filter(id => A.get(id) > 0 && B.get(id) > 0);
  out.scored = both.length;
  if (both.length < MIN_SCORED) {
    out.basis = 'overlap';
    out.points.overlap = Math.round(100 * fit);
    out.score = out.points.overlap;
    return out;
  }
  const allow = Math.max(step(a.format), step(b.format)) / 2;
  const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
  out.apart = mean(both.map(id => Math.abs(A.get(id) - B.get(id)))); // as scored
  out.gap = mean(both.map(id => Math.max(0, Math.abs(A.get(id) - B.get(id)) - allow))); // after the allowance
  out.lean = mean(both.map(id => A.get(id) - B.get(id))); // > 0: a scores higher (for the breakdown only)
  out.agreement = Math.max(0, 1 - out.gap / FAR);
  out.basis = 'both';
  out.points = { overlap: Math.round(50 * fit), scores: Math.round(50 * out.agreement) };
  out.score = out.points.overlap + out.points.scores;
  return out;
}

// ---- ride together ----------------------------------------------------------
// Shows on both Planning lists, best first: ones that are out now before ones that aren't, then AniList's
// average score, then popularity.
export function rideTogether(mine, friends) {
  const theirs = new Set(friends.filter(e => e.status === 'PLANNING').map(e => e.media.id));
  const out = d => (d.status === 'NOT_YET_RELEASED' ? 1 : 0);
  return mine.filter(e => e.status === 'PLANNING' && theirs.has(e.media.id)).map(e => e.media)
    .sort((x, y) => out(x) - out(y) || (y.averageScore || 0) - (x.averageScore || 0) || (y.popularity || 0) - (x.popularity || 0) || x.id - y.id);
}

// ---- markers ------------------------------------------------------------------
// Shape says who rode it, at a glance and without color: a ring is you (your usual marker), a rounded square is
// your friend, and a pill, the metro's transfer-station mark, is both of you.
export const WHO = { both: 'You both rode', me: 'You rode', friend: 'rode' };
export function riderMarker(s, x, y, color, pulse = false) {
  const r = 9;
  if (s.who === 'both') return `${pulse ? `<circle cx="${x}" cy="${y}" r="${r + 6}" class="pulse" fill="${color}"/>` : ''}<rect x="${x - r - 6}" y="${y - r}" width="${2 * r + 12}" height="${2 * r}" rx="${r}" fill="#fff" stroke="${color}" stroke-width="5"/><circle cx="${x - 5}" cy="${y}" r="2.6" fill="${color}"/><circle cx="${x + 5}" cy="${y}" r="2.6" fill="${color}"/>`;
  if (s.who === 'friend') return `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" rx="4" fill="#fff" stroke="${color}" stroke-width="5"/>`;
  return marker(s.state, x, y, color, pulse);
}
