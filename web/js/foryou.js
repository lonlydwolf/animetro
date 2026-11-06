import { gql, me, title, CARD, myList, adultArg, prefs } from './api.js';
import { header, $, esc, card, fail, STATUS } from './ui.js';
import { taste, match } from './score.js';

header();
const page = $('#page');
const MEDIA = `${CARD} tags{name rank category}`;
const SHOWS = new Set(['TV', 'TV_SHORT', 'MOVIE', 'ONA', 'OVA']); // discovery skips specials, music videos and promos
const SEEN = new Set(['COMPLETED', 'CURRENT', 'REPEATING', 'PAUSED', 'DROPPED']);
const okAdult = m => !m.isAdult || prefs.adult();

async function boot() {
  const user = await me();
  if (!user) {
    page.innerHTML = `<section class="fy-hero"><h1>Picks need a pass</h1>
      <p class="hint" style="font-size:1rem;max-width:56ch">Connect your AniList (a username is enough) and this page reads what you've watched to find what to watch next: sequels you skipped, shows that fit your taste, and hidden gems.</p>
      <a class="btn" href="pass.html">Connect AniList</a></section>`;
    return;
  }

  // 1 request for everything about you, plus your list as an id -> status map.
  const [d, list] = await Promise.all([gql(`query($u:Int){
    User(id:$u){ statistics{ anime{ count meanScore genres(limit:30,sort:COUNT_DESC){ genre count meanScore } tags(limit:60,sort:COUNT_DESC){ count meanScore tag{ name category } } } } }
    loved: Page(perPage:10){ mediaList(userId:$u,type:ANIME,status:COMPLETED,sort:[SCORE_DESC,UPDATED_TIME_DESC]){ score media{ id title{english romaji}
      recommendations(perPage:10,sort:RATING_DESC){ nodes{ rating mediaRecommendation{ ${MEDIA} } } } } } }
    done: MediaListCollection(userId:$u,type:ANIME,status:COMPLETED){ lists{ entries{ media{ id title{english romaji}
      relations{ edges{ relationType(version:2) node{ id type status format } } } } } } }
    plan: MediaListCollection(userId:$u,type:ANIME,status:PLANNING){ lists{ entries{ media{ ${MEDIA} } } } }
  }`, { u: user.id }), myList()]);

  const t = taste(d.User.statistics.anime);
  const scored = d.User.statistics.anime.meanScore > 0;
  const topTags = [...t.tags.keys()].slice(0, 6);
  const seen = id => SEEN.has(list.get(id));

  // Sequels to things you finished that you haven't started yet.
  const after = new Map();
  for (const { media: m } of d.done.lists.flatMap(l => l.entries)) {
    for (const e of m.relations.edges) {
      const x = e.node;
      if (e.relationType === 'SEQUEL' && x.type === 'ANIME' && x.format !== 'MUSIC' && x.status !== 'NOT_YET_RELEASED' && !seen(x.id) && !after.has(x.id)) after.set(x.id, title(m));
    }
  }

  // tag_in means "has ALL these tags", so ask once per taste tag (aliased, one request) and merge.
  const T = topTags.slice(0, 5);
  const ids = [...after.keys()].slice(0, 50);
  const per = (alias, extra) => T.map((_, i) => `${alias}${i}: Page(perPage:30){ media(type:ANIME,tag:$t${i},id_not_in:$not,isAdult:$adult,${extra},sort:SCORE_DESC){ ${MEDIA} relations{ edges{ relationType(version:2) } } } }`).join('\n');
  // unused GraphQL variables are an error, so only declare the tag ones when there are tags
  const e = await gql(`query($ids:[Int]${T.length ? ',$not:[Int],$adult:Boolean' : ''}${T.map((_, i) => `,$t${i}:String`).join('')}){
    ${per('line', 'popularity_greater:15000')}
    ${per('gem', 'popularity_greater:1000,popularity_lesser:15000,averageScore_greater:70')}
    next: Page(perPage:50){ media(id_in:$ids,type:ANIME){ ${MEDIA} } }
  }`, { not: [...list.keys()], ids: ids.length ? ids : [0], adult: adultArg(), ...Object.fromEntries(T.map((k, i) => [`t${i}`, k])) });
  // ids:[0] because id_in:[] would mean "no filter"
  // Discovery only suggests where a story starts: no season 3s, and no specials hanging off another show.
  const merged = alias => Object.entries(e).filter(([k]) => k.startsWith(alias)).flatMap(([, v]) => v.media)
    .filter(m => SHOWS.has(m.format) && !m.relations.edges.some(x => x.relationType === 'PREQUEL' || x.relationType === 'PARENT'));

  const shown = new Set(); // each show appears in one section only
  const ranked = (arr, n) => [...new Map(arr.filter(m => okAdult(m) && !shown.has(m.id)).map(m => [m.id, m])).values()]
    .map(m => ({ m, r: match(m, t) })).sort((a, b) => b.r.pct - a.r.pct).slice(0, n).map(x => (shown.add(x.m.id), x));
  const pill = r => `<span class="match" style="--m:${r.pct}"><b>${r.pct}% match</b>${r.why.length ? `<i>${esc(r.why.join(', '))}</i>` : ''}</span>`;
  const grid = items => `<div class="grid">${items.join('')}</div>`;
  const section = (h, hint, items) => items.length ? `<section><div class="section-head"><h2>${h}</h2></div><p class="hint">${hint}</p>${grid(items)}</section>` : '';
  const entry = id => (list.has(id) ? { status: list.get(id) } : undefined);

  const nextStops = ranked(e.next.media, 12).map(({ m, r }) =>
    card(m, entry(m.id), `<span class="because">After ${esc(after.get(m.id))}</span>${pill(r)}`));
  const line = ranked(merged('line'), 18).map(({ m, r }) => card(m, undefined, pill(r)));
  const gems = ranked(merged('gem'), 12).map(({ m, r }) => card(m, undefined, pill(r)));

  // Fans of your highest-rated shows also loved...
  const pool = new Map();
  d.loved.mediaList.forEach(({ score, media }, i) => {
    const weight = (score || 70 - i) / 10;
    for (const n of media.recommendations.nodes) {
      const r = n.mediaRecommendation;
      if (!r || !okAdult(r) || n.rating <= 0 || list.has(r.id) || shown.has(r.id)) continue;
      const p = pool.get(r.id) || { m: r, score: 0, because: [] };
      p.score += weight * Math.log2(n.rating + 1);
      p.because.push(title(media));
      pool.set(r.id, p);
    }
  });
  const fans = [...pool.values()].sort((a, b) => b.score - a.score).slice(0, 12).map(p =>
    card(p.m, undefined, `<span class="because">Fans of ${esc(p.because[0])}${p.because.length > 1 ? ` and ${p.because.length - 1} more` : ''}</span>${pill(match(p.m, t))}`));

  const plan = ranked(d.plan.lists.flatMap(l => l.entries).map(x => x.media), 12).map(({ m, r }) => card(m, entry(m.id), pill(r)));

  page.innerHTML = `
    <section class="fy-hero">
      <p class="hint" style="margin:0">Picked for</p>
      <h1>${esc(user.name)}</h1>
      ${topTags.length ? `<p class="fy-taste">Your ticket is punched for
        ${[...t.tags.keys()].slice(0, 8).map(k => `<a class="tag" href="explore.html?tags=${encodeURIComponent(k)}&fresh=1">${esc(k)}</a>`).join('')}</p>
        <p class="hint">Read from the tags on everything you've watched, weighted by ${scored ? 'how you scored them' : 'how much you watch them'}. Nothing below is on your list yet${list.size ? '' : ' (your list looks empty)'}.</p>`
      : `<p class="hint">AniList hasn't built stats for this profile yet. Watch and score a few shows and this page fills up.</p>`}
    </section>
    ${section('Next stops', `Sequels to shows you finished but never started. ${after.size > 50 ? 'Showing the best of ' + after.size + '.' : ''}`, nextStops)}
    ${section('Your taste line', `Popular, well-rated shows that match the tags you ${scored ? 'rate highest' : 'watch most'}.`, line)}
    ${section('Hidden gems for you', 'Under 15,000 viewers, scored 70%+, and on your wavelength.', gems)}
    ${section('Fans of your favourites also loved', `Recommended by people who loved the shows you ${scored ? 'scored highest' : 'finished most recently'}.`, fans)}
    ${section('Your Planning list, best first', `Your ${STATUS.PLANNING} list, sorted by how well each show fits your taste.`, plan)}
    ${[nextStops, line, gems, fans, plan].every(a => !a.length) ? '<p class="empty">Nothing to suggest yet. Complete and score a few shows on AniList first.</p>' : ''}`;
}

boot().catch(err => fail(page, err));
