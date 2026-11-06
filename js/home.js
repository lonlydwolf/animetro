import { gql, me, title, CARD, prefs, adultArg } from './api.js';
import { header, searchBox, $, esc, cards, countdown, fail } from './ui.js';

header();
searchBox($('#q'), m => (location.href = `line.html?id=${m.id}`));

// Mood "lines": each one is a preset for the Explore page.
const MOODS = [
  ['ginza', 'G', 'Hype', 'Big fights, bigger speeches', 'genres=Action&tags=Shounen&sort=POPULARITY_DESC'],
  ['marunouchi', 'M', 'Heartbreak', 'Bring tissues', 'genres=Drama&tags=Tragedy&sort=SCORE_DESC'],
  ['tozai', 'T', 'Cozy', 'Low stakes, warm tea', 'tags=Iyashikei&sort=SCORE_DESC'],
  ['chiyoda', 'C', 'Mind games', 'You will pause to think', 'genres=Psychological&sort=SCORE_DESC'],
  ['yurakucho', 'Y', 'Laugh track', 'Pure comedy', 'genres=Comedy&sort=SCORE_DESC'],
  ['hanzomon', 'Z', 'Butterflies', 'Romance, slow or fast', 'genres=Romance&sort=POPULARITY_DESC'],
  ['namboku', 'N', 'Other worlds', 'Isekai and beyond', 'tags=Isekai&sort=POPULARITY_DESC'],
  ['fukutoshin', 'F', 'Night shift', 'Horror and dread', 'genres=Horror&sort=SCORE_DESC'],
  ['hibiya', 'H', 'Underdogs', 'Sports, sweat, comebacks', 'genres=Sports&sort=SCORE_DESC'],
  ...(prefs.adult() ? [['marunouchi', 'L', 'Last train', 'Hentai and 18+, after dark', 'ticket=adult&sort=POPULARITY_DESC']] : []),
];
$('#moods').innerHTML = MOODS.map(([c, l, name, blurb, q]) => `
  <a class="mood" href="explore.html?${q}" style="--c:var(--${c})">
    <span class="roundel" aria-hidden="true">${l}</span>
    <span><b>${name}</b><small>${blurb}</small></span>
  </a>`).join('');

const now = Math.floor(Date.now() / 1000);
gql(`query($now:Int,$a:Boolean){
  trending: Page(perPage:14){ media(type:ANIME,sort:TRENDING_DESC,isAdult:$a){ ${CARD} } }
  soon: Page(perPage:40){ airingSchedules(airingAt_greater:$now,sort:TIME){ episode airingAt media{ id isAdult popularity episodes title{english romaji} coverImage{medium color} } } }
}`, { now, a: adultArg() }).then(async d => {
  await cards($('#trending'), d.trending.media);
  const soon = d.soon.airingSchedules.filter(a => (!a.media.isAdult || prefs.adult()) && a.media.popularity > 8000).slice(0, 4);
  $('#soon').innerHTML = soon.map(a => `
    <a class="journey" href="anime.html?id=${a.media.id}" style="--c:${a.media.coverImage.color || 'var(--led)'}">
      <img src="${a.media.coverImage.medium}" alt="" loading="lazy">
      <div><b>${esc(title(a.media))}</b>
        <small>Episode ${a.episode}${a.media.episodes ? ` of ${a.media.episodes}` : ''}</small>
        <div class="countdown" data-at="${a.airingAt}">${countdown(a.airingAt - Date.now() / 1000)}</div></div>
    </a>`).join('') || '<p class="empty">Nothing popular airing in the next few hours.</p>';
}).catch(e => fail($('#trending'), e));

setInterval(() => document.querySelectorAll('[data-at]').forEach(el => (el.textContent = countdown(el.dataset.at - Date.now() / 1000))), 1000);

// Continue watching, if a pass is connected.
me().then(async u => {
  if (!u) return;
  const d = await gql(`query($u:Int){ Page(perPage:6){ mediaList(userId:$u,type:ANIME,status:CURRENT,sort:UPDATED_TIME_DESC){
    progress media{ id episodes title{english romaji} coverImage{medium color} nextAiringEpisode{episode} } } } }`, { u: u.id });
  const list = d.Page.mediaList;
  if (!list.length) return;
  $('#continue').hidden = false;
  $('#journeys').innerHTML = list.map(({ progress, media: m }) => {
    const total = m.episodes || (m.nextAiringEpisode ? m.nextAiringEpisode.episode - 1 : 0);
    const pct = total ? Math.min(100, (progress / total) * 100) : 0;
    return `
      <a class="journey" href="line.html?id=${m.id}" style="--c:${m.coverImage.color || 'var(--platform)'}">
        <img src="${m.coverImage.medium}" alt="" loading="lazy">
        <div><b>${esc(title(m))}</b>
          <div class="bar"><i style="width:${pct}%"></i></div>
          <small>Episode ${progress}${total ? ` of ${total}` : ''}${m.nextAiringEpisode ? ', still airing' : ''}</small></div>
      </a>`;
  }).join('');
}).catch(() => {});
