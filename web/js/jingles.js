// Opening jingles: a show's opening and ending themes, from AnimeThemes (animethemes.moe: free, no key, CORS open,
// 90 requests a minute). Off by default. While it's off, nothing is asked of AnimeThemes or loaded from it: the
// anime page and the quiz only call findThemes() once it's on, and findThemes() refuses to send anything while it's off.
// The network call is kept apart from the pure functions below it (themeList, pickSource, the quiz helpers), so
// tests/jingles.test.mjs runs those without a browser or the network, as episodes.js does with Kitsu.
import { store, title } from './api.js';

const API = 'https://graphql.animethemes.moe/';
const KEY = 'animetro.jingles'; // '1' while on, absent while off
export const jinglesOn = () => store.get(KEY) === '1';
export const setJingles = on => store.set(KEY, on ? '1' : null);
// Calls back with the new setting when another tab (or window of the app) switches it, so an open page can stop its
// audio and drop what it had queued: off in one tab means off in all of them. Returns a function that stops listening.
export function onJinglesChange(callback) {
  const heard = e => {
    if (e.storageArea && e.storageArea !== localStorage) return;
    if (e.key === KEY || e.key === null) callback(jinglesOn()); // null: all of this site's storage was cleared
  };
  addEventListener('storage', heard);
  return () => removeEventListener('storage', heard);
}

export const CLIP = 15; // seconds of an opening the quiz plays before you have to guess
const OGG = 'audio/ogg; codecs="opus"', WEBM = 'audio/webm; codecs="opus"';

// Everything the page shows about a theme, and the files to play it from: each video lists the audio file cut from it.
const FIELDS = `slug siteUrl animethemes$TYPE{ type sequence slug group{ name } song{ title{ romaji native } performances{ as alias artist{ name{ main } } } }
  animethemeentries{ version episodes videos{ nodes{ link resolution size audio{ link mimetype size } } } } }`;

export class JinglesOff extends Error {
  constructor() { super('Opening jingles are off, so AnimeThemes was not asked.'); this.name = 'JinglesOff'; }
}

// ---- network ------------------------------------------------------------------
// AnimeThemes allows 90 requests a minute. If it refuses one (429), or says none are left, nothing more is sent for
// a minute: the page says so instead of hammering it. (Its counter headers may not be readable cross-origin; then
// only a refusal pauses.)
let pausedUntil = 0;
const busy = () => new Error('AnimeThemes asked for a short break. Try again in a minute.');
const known = new Map(); // `${type}:${id}` -> promise of the answer, for this page only (a failed lookup is asked again)

// What AnimeThemes has for an AniList show: { slug, siteUrl, themes } (themes from themeList()), or null if it
// doesn't have the show. type 'OP' asks for openings only (the quiz). Rejects without sending anything while
// Opening jingles is off (on: false). fetch can be swapped for a test.
export function findThemes(id, { type = '', on = jinglesOn(), fetch: get = globalThis.fetch } = {}) {
  if (!on) return Promise.reject(new JinglesOff());
  if (!Number.isInteger(id) || id <= 0) return Promise.resolve(null);
  const k = `${type}:${id}`;
  if (!known.has(k)) {
    const p = ask(`query($id:[Int!]){ findAnimeByExternalSite(site: ANILIST, id: $id){ ${FIELDS.replace('$TYPE', type ? `(type: ${type === 'OP' ? 'OP' : 'ED'})` : '')} } }`, { id: [id] }, get)
      .then(d => {
        const anime = d.findAnimeByExternalSite?.[0];
        return anime ? { slug: anime.slug, siteUrl: anime.siteUrl, themes: themeList(anime) } : null;
      });
    known.set(k, p);
    p.catch(() => { if (known.get(k) === p) known.delete(k); });
  }
  return known.get(k);
}

async function ask(query, variables, get) {
  if (Date.now() < pausedUntil) throw busy();
  let res;
  try {
    res = await get(API, {
      method: 'POST', credentials: 'omit', // AnimeThemes sets a session cookie; Animetro never sends it one back
      signal: AbortSignal.timeout(15_000), // a look-up that hangs counts as unreachable instead of holding up the quiz
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
  } catch { throw new Error("Couldn't reach AnimeThemes. Check your connection and try again."); }
  const left = res.headers?.get?.('X-RateLimit-Remaining');
  if (res.status === 429 || (left != null && left.trim() !== '' && +left <= 0)) pausedUntil = Date.now() + 60_000;
  if (res.status === 429) throw busy();
  if (!res.ok) throw new Error(`AnimeThemes answered ${res.status}. Try again later.`);
  const json = await res.json().catch(() => ({}));
  if (!json.data) throw new Error(json.errors?.[0]?.message ? `AnimeThemes: ${json.errors[0].message}` : 'AnimeThemes sent an empty answer.');
  return json.data;
}

// ---- pure: themes ---------------------------------------------------------------
// Only AnimeThemes' own file servers, over https (the Content-Security-Policy allows only these two anyway).
const onHost = (u, host) => {
  try { const url = new URL(u); return url.protocol === 'https:' && url.hostname === host && !url.username ? url.href : ''; } catch { return ''; }
};
const ORDER = { OP: 0, ED: 1, IN: 2 };

// AnimeThemes' anime (findAnimeByExternalSite) -> its themes, openings first, then endings, then insert songs:
//   { key, type, n, label ('OP1'), group ('TV Version' or ''), song ('' when unknown), artists [names],
//     episodes ('1–16' or ''), audio { link, size } | null, video { link, resolution, size } | null }
// The files come from the first version with any (later versions are usually the same song re-cut); video is that
// version's smallest one, whose sound is the fallback where Ogg can't play.
export function themeList(anime) {
  const out = (anime?.animethemes || []).filter(t => t && ORDER[t.type] != null).map((t, i) => {
    const entries = (t.animethemeentries || []).filter(Boolean);
    const videos = entries.map(e => (e.videos?.nodes || []).filter(Boolean)).find(v => v.length) || [];
    const a = videos.map(v => v.audio).find(x => onHost(x?.link, 'a.animethemes.moe'));
    const v = videos.filter(x => onHost(x.link, 'v.animethemes.moe'))
      .sort((x, y) => (x.resolution ?? Infinity) - (y.resolution ?? Infinity) || (x.size || 0) - (y.size || 0))[0];
    const n = t.sequence || null, group = (t.group?.name || '').trim();
    // AnimeThemes' slug keeps the number when the sequence doesn't: a TV version of ED1 is 'ED1-TV'
    const label = String(t.slug || '').match(new RegExp(`^${t.type}\\d*`))?.[0] || `${t.type}${n ?? ''}`;
    return {
      key: `${label}${group ? `-${group}` : ''}-${i}`.replace(/[^\w-]+/g, '_'),
      type: t.type, n, label, group,
      song: (t.song?.title?.romaji || t.song?.title?.native || '').trim(),
      artists: [...new Set((t.song?.performances || []).map(artist).filter(Boolean))],
      episodes: episodeRange(entries.map(e => e.episodes)),
      audio: a ? { link: onHost(a.link, 'a.animethemes.moe'), size: a.size || 0 } : null,
      video: v ? { link: onHost(v.link, 'v.animethemes.moe'), resolution: v.resolution || null, size: v.size || 0 } : null,
    };
  });
  return out.sort((x, y) => ORDER[x.type] - ORDER[y.type] || (x.n ?? Infinity) - (y.n ?? Infinity)); // stable: AnimeThemes' order otherwise
}

// A performer as credited: the alias they sang under if any, and the character they sang as.
function artist(p) {
  const name = (p?.alias || p?.artist?.name?.main || '').trim();
  return name && (p.as ? `${name} (as ${p.as.trim()})` : name);
}

// Episode lists from every version ('1-14, 16', '17-27', '28') -> one range ('1–28'). Anything that isn't plain
// numbers ('OVA', 'BD 1-3') is shown as AnimeThemes wrote it.
export function episodeRange(list) {
  const given = [...new Set((list || []).filter(s => typeof s === 'string' && s.trim()).map(s => s.trim()))];
  const nums = new Set();
  for (const s of given) {
    for (const part of s.split(',')) {
      const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      const a = m && +m[1], b = m && +(m[2] ?? m[1]);
      if (!m || b < a || b - a > 5000) return given.join(', ');
      for (let n = a; n <= b; n++) nums.add(n);
    }
  }
  const sorted = [...nums].sort((x, y) => x - y), runs = [];
  for (const n of sorted) {
    const last = runs.at(-1);
    if (last && n === last[1] + 1) last[1] = n; else runs.push([n, n]);
  }
  return runs.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ');
}

// The file to play: the Ogg audio where the browser says it can play it, else the smallest WebM video (its sound
// plays in an <audio> element; the picture is never shown), else null. canPlay: an <audio>'s canPlayType.
export function pickSource(theme, canPlay) {
  if (theme?.audio && canPlay(OGG)) return { src: theme.audio.link, kind: 'ogg', size: theme.audio.size };
  if (theme?.video && (canPlay(WEBM) || canPlay('video/webm'))) return { src: theme.video.link, kind: 'webm', size: theme.video.size };
  return null;
}
// For when the Ogg file fails to play although canPlayType said it could: the same question, with Ogg ruled out.
export const withoutOgg = canPlay => t => (t.startsWith('audio/ogg') ? '' : canPlay(t));
// Whether a media error means this browser can't play the file (decode error, or format not supported), which the
// WebM fallback can fix, rather than a download that failed (aborted, network), which it can't.
export const unplayable = err => err?.code === 3 || err?.code === 4;

// Whether an <audio>'s duration (and so a seek bar or a total) can be trusted. AnimeThemes' Ogg files carry no
// length, and WebKit (Safari, the Mac app, every iOS browser) only estimates it, wrongly: a 1:30 opening shows as 2:40.
// Chrome and Firefox read the real length, and WebM files state it. kind: pickSource's 'ogg' or 'webm'.
export const isWebKit = ua => /AppleWebKit\//.test(ua || '') && !/(Chrome|Chromium|Edg|OPR)\//.test(ua);
export const lengthTrusted = (kind, ua = '') => kind !== 'ogg' || !isWebKit(ua);

// "OP1 · Yuusha by YOASOBI" style parts, for the page and the quiz's reveal.
export const songLine = t => [t.song ? `“${t.song}”` : 'Untitled', t.artists.length ? `by ${t.artists.join(', ')}` : ''].filter(Boolean).join(' ');

// ---- pure: the quiz -----------------------------------------------------------------
// The quiz's shows: everything on your list you've started or finished (not Planning), 18+ only when 18+ is on.
// entries: AniList list entries { status, media }. Returns { id, name, cover, color, isAdult } per show.
export function quizPool(entries, adult = false) {
  const seen = new Set();
  return (entries || []).filter(e => e?.media && e.status !== 'PLANNING' && (adult || !e.media.isAdult) && !seen.has(e.media.id) && seen.add(e.media.id))
    .map(({ media: m }) => ({ id: m.id, name: title(m), cover: m.coverImage?.large || '', color: m.coverImage?.color || '', isAdult: !!m.isAdult }));
}

// A rough franchise key: the first two words of the title. "Attack on Titan Season 3" and "Attack on Titan" share
// one, so a round never asks you to tell seasons of the same show apart by their music.
export function showKey(name) {
  const words = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9぀-ヿ一-鿿]+/g, ' ').trim().split(' ').filter(Boolean);
  if (words[0] === 'the' && words.length > 1) words.shift();
  return words.slice(0, 2).join(' ');
}

// Fisher–Yates on a copy. rand: () => [0, 1), injectable for tests.
export function shuffle(list, rand = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// The order the quiz tries shows in: your pool shuffled, one show per franchise.
export function quizOrder(pool, rand = Math.random) {
  const keys = new Set();
  return shuffle(pool, rand).filter(m => { const k = showKey(m.name); return !keys.has(k) && keys.add(k); });
}

// n choices for a round: the answer and n-1 other shows from the pool, each from a different franchise when the
// pool allows (else any other shows with different names), in random order.
export function quizChoices(answer, pool, rand = Math.random, n = 4) {
  const picks = [answer], keys = new Set([showKey(answer.name)]), others = shuffle(pool.filter(m => m.id !== answer.id), rand);
  for (const m of others) {
    if (picks.length >= n) break;
    const k = showKey(m.name);
    if (!keys.has(k)) { keys.add(k); picks.push(m); }
  }
  for (const m of others) {
    if (picks.length >= n) break;
    if (!picks.some(p => p.id === m.id || p.name === m.name)) picks.push(m);
  }
  return shuffle(picks, rand);
}

// The opening to play for a show: a random one of its openings that can be played here, or null.
export function pickOpening(themes, canPlay, rand = Math.random) {
  const ops = (themes || []).filter(t => t.type === 'OP' && pickSource(t, canPlay));
  return ops.length ? ops[Math.floor(rand() * ops.length)] : null;
}

// How far into the file a clip may reach. With a length that can be trusted: what has arrived (the clip is cued inside
// it), so it always fits. Without one: the first SURE_END seconds. TV-size openings run about 90 seconds and even most
// TV shorts' run 45 or more, so a clip fits whatever the real length is; for the rare one under 30, the quiz treats the
// song ending as the end of the clip.
export const SURE_END = 30;
export const clipEnd = (arrived, trusted) => (trusted ? arrived : Math.min(arrived, SURE_END));

// Where the clip starts: somewhere in the first 90 seconds (a TV-size opening) that leaves a whole clip to hear.
export function clipStart(duration, rand = Math.random, len = CLIP) {
  if (!Number.isFinite(duration) || duration <= len + 1) return 0;
  return Math.floor(rand() * (Math.min(duration, 90) - len));
}

// The end-of-round rank, from the same train tiers as the rider rank on My pass.
const RANKS = [
  [1, 'Galaxy Express', 'Perfect pitch. You know every departure melody on your line.'],
  [0.8, 'Shinkansen', 'Blink and you’d miss it: you named nearly every one.'],
  [0.6, 'Limited Express', 'Most stops called right. A few more laps and it’s a clean sweep.'],
  [0.4, 'Rapid', 'Some tunes stuck. Those openings you skipped are catching up with you.'],
  [0.2, 'Local', 'Stopping at every station. Maybe stop skipping the openings?'],
  [0, 'Platform Ticket', 'Everyone starts somewhere. Ride a few more lines and try again.'],
];
export function verdict(score, total) {
  const f = total ? score / total : 0;
  const [, name, line] = RANKS.find(([min]) => f >= min);
  return { name, line };
}
