// Unofficial streaming sites: everythingmoe.com's top-ranked anime and hentai streaming sites (live list, Nov 6 2026).
// Their lower-ranked sites are left out, as everythingmoe itself folds them away.
// These sites change domains often: everythingmoe.com keeps the live list, update the URLs here.
// [name, URL, tags]. The URL is one of:
//   a direct show page with {id} (the AniList ID; only sites that use AniList IDs),
//   a search page with {q} for the title (checked against each site),
//   or just the homepage, in which case Animetro copies the title for you to paste.
// Logos are bundled in img/sites/<host>.png (from everythingmoe's icons; their server is blocked on some networks).
export const ANIME_SITES = [
  ['Re:Anime', 'https://reanime.to/search?q={q}', 'Soft-sub, Dub, Download'],
  ['Anikoto', 'https://anikototv.to/search?keyword={q}', 'Soft-sub, Dub'],
  ['animepahe', 'https://animepahe.pw/', 'Hard-sub, Download'],
  ['Miruro', 'https://www.miruro.cx/search?query={q}', 'Soft-sub, Dub, Download'],
  ['Gotaku', 'https://gotaku.to/', 'Hard-sub, Dub'],
  ['MKissa', 'https://mkissa.to/search/anime?query={q}', 'Hard-sub, Dub, Download'],
  ['ani.pm', 'https://ani.pm/search?q={q}', 'Soft-sub, Dub'],
  ['AniZone', 'https://anizone.to/anime?search={q}', 'Soft-sub'],
  ['KickAssAnime', 'https://kaa.lt/search?q={q}', 'Soft-sub'],
  ['AniSnatch', 'https://anisnatch.to/search?query={q}', 'Soft-sub, Dub, Download'],
  ['Anime Nexus', 'https://anime.nexus/series?search={q}', 'Soft-sub'],
  ['aniwaves', 'https://aniwaves.ru/filter?keyword={q}', 'Hard-sub'],
  ['anv', 'https://anv.to/', 'Soft-sub'],
  ['AnimeOnsen', 'https://www.animeonsen.xyz/search/{q}', 'Soft-sub, Dub'],
  ['AnimeX', 'https://animex.one/anime/{id}', 'Soft-sub, Download'],
  ['Anify', 'https://anify.to/', 'Hard-sub'],
];

export const HENTAI_SITES = [
  ['hentai.tv', 'https://hentai.tv/search?q={q}'],
  ['Hentai.SH', 'https://hentai.sh/'],
  ['HentaiHaven', 'https://hentaihaven.xxx/search/?q={q}'],
  ['HStream.moe', 'https://hstream.moe/'],
  ['HentaiCity', 'https://www.hentaicity.com/search/video/{q}'],
  ['HentaiDB', 'https://hentaidb.xyz/'],
  ['Hentai Ocean', 'https://hentaiocean.com/'],
  ['Hanime.tv', 'https://hanime.tv/'],
  ['Hentaverse', 'https://hentaverse.com/search?search_query={q}'],
  ['HenVids', 'https://henvids.com/search?q={q}'],
  ['haho.moe', 'https://haho.moe/'],
  ['WatchHentai', 'https://watchhentai.net/?s={q}'],
  ['UnderHentai', 'https://www.underhentai.net/?s={q}'],
  ['Hentai.ht', 'https://hentai.ht/search/videos?search_query={q}'],
  ['HentaiStream', 'https://tube.hentaistream.com/?s={q}'],
  ['HentaiPlay', 'https://hentaiplay.net/?s={q}'],
  ['OnlyHentaiStuff', 'https://www.onlyhentaistuff.com/search/?q={q}'],
  ['Zhentube', 'https://zhentube.com/?s={q}'],
  ['Hanime1.me', 'https://hanime1.me/'],
  ['MyHentaiMovie', 'https://myhentaimovie.com/search?keyword={q}'],
];

// What to type into a site's search: the romaji title without its season subtitle
// ("Kimetsu no Yaiba: Yuukaku-hen" -> "Kimetsu no Yaiba"), so sites with strict search still find the show.
// Splitting on ": " (colon + space) keeps titles like "Re:Zero" whole.
export const searchTerm = m => (m.title.romaji || m.title.english || '').split(/:\s/)[0].trim();

export function siteLinks(m) {
  const q = searchTerm(m);
  return (m.isAdult ? HENTAI_SITES : ANIME_SITES).map(([name, url, tags = '']) => {
    const host = new URL(url).host.replace(/^www\./, '');
    return {
      name, tags, host, q,
      kind: url.includes('{id}') ? 'direct' : url.includes('{q}') ? 'search' : 'home',
      href: url.replace('{id}', m.id).replace('{q}', encodeURIComponent(q)),
      icon: `img/sites/${host}.png`,
    };
  });
}
