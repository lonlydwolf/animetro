// Episode list for the anime page. AniList knows how many episodes there are, when the next ones air and
// (sometimes) Crunchyroll links; Kitsu (no key, CORS open) has a title, air date, length, picture and summary
// for nearly every episode. rows() merges them and has no DOM or network, so tests/episodes.test.mjs runs it.
const KITSU = 'https://kitsu.io/api/edge';
export const PAGE = 100; // episodes per range; Kitsu serves 20 a request, so a range is 5 parallel requests
const FIELDS = 'number,canonicalTitle,titles,airdate,length,thumbnail,description';

const json = url => fetch(url, { headers: { Accept: 'application/vnd.api+json' } }).then(r => (r.ok ? r.json() : Promise.reject(new Error(`Kitsu ${r.status}`))));

// Kitsu's id for an AniList show, through its id mappings (AniList first, then MyAnimeList). null if Kitsu doesn't have it.
export async function kitsuId(m) {
  for (const [site, id] of [['anilist/anime', m.id], ['myanimelist/anime', m.idMal]]) {
    if (!id) continue;
    const d = await json(`${KITSU}/mappings?filter[externalSite]=${site}&filter[externalId]=${id}&include=item&fields[anime]=id`);
    const hit = d.included?.find(i => i.type === 'anime');
    if (hit) return hit.id;
  }
  return null;
}

// Up to `n` episodes from position `from` (n <= PAGE), plus how many Kitsu has in total.
export async function kitsuRange(kid, from, n = PAGE) {
  const pages = await Promise.all(Array.from({ length: Math.ceil(Math.min(n || PAGE, PAGE) / 20) }, (_, i) =>
    json(`${KITSU}/anime/${encodeURIComponent(kid)}/episodes?page[limit]=20&page[offset]=${from + i * 20}&sort=number&fields[episodes]=${FIELDS}`)));
  return { count: pages[0].meta?.count || 0, eps: pages.flatMap(p => p.data.map(e => e.attributes)) };
}

const day = s => (s ? new Date(`${s}T12:00:00`) : null); // Kitsu dates are plain days; noon keeps them on the same day everywhere

// One row per episode, 1..total.
//   total: how many episodes to list; kitsu: Kitsu episode attributes; streams: AniList streamingEpisodes;
//   schedule: AniList airingSchedule nodes ({ episode, airingAt }).
export function rows({ total, kitsu = [], streams = [], schedule = [], now = Date.now() }) {
  const k = new Map(kitsu.filter(e => e.number).map(e => [e.number, e]));
  const s = new Map();
  for (const st of streams) {
    const n = +st.title?.match(/^Episode (\d+)/i)?.[1];
    if (n && !s.has(n)) s.set(n, st);
  }
  const air = new Map(schedule.map(a => [a.episode, a.airingAt]));
  return Array.from({ length: total }, (_, i) => {
    const n = i + 1, e = k.get(n), st = s.get(n);
    const t = e?.titles || {};
    const at = air.get(n) ? air.get(n) * 1000 : day(e?.airdate)?.getTime() || null;
    const upcoming = !!at && at > now;
    return {
      n,
      title: t.en_us || t.en || e?.canonicalTitle || st?.title.replace(/^Episode \d+\s*[-:]\s*/i, '') || '',
      native: t.ja_jp || '',
      at, upcoming,
      length: e?.length || null,
      thumb: e?.thumbnail?.original || st?.thumbnail || null,
      summary: e?.description || '',
      watch: st ? { url: st.url, site: st.site } : null,
    };
  });
}

// Where an episode stands for you, from your progress.
export const epState = (r, progress) => (r.n <= progress ? 'watched' : r.upcoming ? 'upcoming' : r.n === progress + 1 ? 'next' : '');

// How many episodes the list should have: the final count if AniList knows it, else everything aired or scheduled
// on AniList. Kitsu's count only when AniList has neither: it keeps empty placeholders for episodes far ahead.
export function episodeTotal(m, kitsuCount = 0) {
  if (m.episodes) return m.episodes;
  const scheduled = Math.max(0, ...(m.airingSchedule?.nodes || []).map(a => a.episode));
  return Math.max(scheduled, m.nextAiringEpisode ? m.nextAiringEpisode.episode - 1 : 0) || kitsuCount;
}
