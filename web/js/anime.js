import { gql, me, title, plainText, listStatus, saveEntries, CARD, prefs, inApp, store } from './api.js';
import { header, $, esc, qs, FORMAT, STATUS, minutes, countdown, cards, toast, fail, adultGate, nsfw, safeUrl, safeColor, cover, tint } from './ui.js';
import { siteLinks } from './streams.js';
import { chime } from './chime.js';
import { finishOdds } from './odds.js';
import { finishes } from './fit.js';
import { kitsuId, kitsuRange, rows, epState, episodeTotal, PAGE } from './episodes.js';

header();
const id = +qs().get('id');
const cap = s => (s ? s[0] + s.slice(1).toLowerCase().replace(/_/g, ' ') : '');
const date = d => (d?.year ? new Date(d.year, (d.month || 1) - 1, d.day || 1).toLocaleDateString(undefined, { year: 'numeric', month: d.month ? 'short' : undefined, day: d.day ? 'numeric' : undefined }) : '');

const Q = `query($id:Int){ Media(id:$id,type:ANIME){
  id idMal title{english romaji native} synonyms format status episodes duration season seasonYear source countryOfOrigin
  startDate{year month day} endDate{year month day} averageScore meanScore popularity favourites genres isAdult
  description bannerImage coverImage{extraLarge color} siteUrl hashtag
  studios(isMain:true){nodes{name}}
  trailer{id site}
  nextAiringEpisode{episode airingAt}
  airingSchedule(notYetAired:true,perPage:25){nodes{episode airingAt}}
  tags{name rank isMediaSpoiler}
  rankings{rank type allTime context year season}
  externalLinks{site url type color icon}
  stats{scoreDistribution{score amount}}
  characters(sort:[ROLE,RELEVANCE],perPage:12){edges{role node{name{full} image{medium}} voiceActors(language:JAPANESE){name{full} image{medium}}}}
  recommendations(perPage:14,sort:RATING_DESC){nodes{rating mediaRecommendation{${CARD}}}}
  relations{edges{relationType(version:2)}}
}}`;

let media, entry, user;

async function boot() {
  if (!id) { location.href = 'index.html'; return; }
  [media, user] = await Promise.all([gql(Q, { id }).then(d => d.Media), me()]);
  const m = media;
  if (m.isAdult && !prefs.adult()) {
    $('#page').innerHTML = `<section class="fy-hero"><span class="roundel" style="border-color:var(--marunouchi)">18</span><h1 style="margin-top:16px">This stop is 18+</h1>
      <p class="hint" style="font-size:1rem">AniList marks this title as adult content. Animetro hides 18+ titles unless you turn them on.</p>
      <p style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" id="gate-open">Show 18+ titles</button><a class="btn ghost" href="search.html">Back to search</a></p></section>`;
    $('#gate-open').onclick = adultGate;
    return;
  }
  entry = (await listStatus([id])).get(id);
  document.title = `${title(m)} · Animetro`;
  if (tint(m, '')) document.documentElement.style.setProperty('--cover', tint(m, ''));

  const runtime = (m.episodes || 0) * (m.duration || 0);
  const tags = m.tags.filter(t => t.rank >= 60);
  const spoilers = tags.filter(t => t.isMediaSpoiler).length;
  const vibes = tags.filter(t => !t.isMediaSpoiler).slice(0, 7);
  const dist = m.stats.scoreDistribution;
  const maxAmt = Math.max(1, ...dist.map(d => d.amount));
  const ranks = m.rankings.filter(r => r.allTime || r.season).slice(0, 4);
  const streams = m.externalLinks.filter(l => l.type === 'STREAMING');
  const recs = m.recommendations.nodes.map(n => n.mediaRecommendation).filter(r => r && (!r.isAdult || prefs.adult()));
  const epTotal = episodeTotal(m), hasEps = epTotal > 1 || (epTotal === 1 && m.format !== 'MOVIE');
  const hasLine = m.relations.edges.some(e => ['PREQUEL', 'SEQUEL', 'SIDE_STORY', 'PARENT', 'SPIN_OFF', 'ALTERNATIVE', 'SUMMARY'].includes(e.relationType));

  $('#page').innerHTML = `
    <section class="anime-hero bleed" style="--banner:${safeUrl(m.bannerImage) && !nsfw(m) ? `url(${safeUrl(m.bannerImage)})` : 'none'}">
      <div class="anime-top${nsfw(m)}">
        <img class="cover" src="${cover(m, 'extraLarge')}" alt="">
        <div>
          <h1>${esc(title(m))}</h1>
          <p class="native">${esc([m.title.english && m.title.romaji, m.title.native].filter(Boolean).join('  /  '))}</p>
          <div class="facts">
            ${m.averageScore ? `<span class="tag">${m.averageScore}% score</span>` : ''}
            ${m.isAdult ? '<span class="tag" style="background:var(--marunouchi);color:#fff">18+</span>' : ''}
            <span class="tag">${FORMAT[m.format] || cap(m.format)}</span>
            ${m.episodes ? `<span class="tag">${m.episodes} episodes${m.duration ? ` of ${m.duration} min` : ''}</span>` : ''}
            ${m.season ? `<span class="tag">${cap(m.season)} ${m.seasonYear}</span>` : ''}
            <span class="tag">${cap(m.status)}</span>
            ${m.genres.map(g => `<a class="tag" href="explore.html?genres=${encodeURIComponent(g)}" style="text-decoration:none">${esc(g)}</a>`).join('')}
          </div>
          <div class="actions">
            ${hasLine ? `<a class="btn" href="line.html?id=${m.id}">See watch order</a>` : ''}
            <span id="list-ctl"></span>
          </div>
        </div>
      </div>
    </section>

    ${hasEps ? `<div class="tabs" role="tablist" aria-label="Sections">
      <button role="tab" id="tab-overview" aria-controls="panel-overview" data-tab="overview">Overview</button>
      <button role="tab" id="tab-episodes" aria-controls="panel-episodes" data-tab="episodes">Episodes <small>${epTotal}</small></button>
    </div>` : ''}

    <div id="panel-overview" role="tabpanel" aria-labelledby="tab-overview">
    <div class="anime-body">
      <div>
        <section style="margin-top:0">
          <p class="synopsis">${esc(plainText(m.description || 'No synopsis on AniList yet.'))}</p>
        </section>

        ${vibes.length ? `<section><h2>Vibe check</h2><p class="hint">How strongly AniList users say each tag applies.${spoilers ? ` <button class="spoiler-btn" id="spoil">Show ${spoilers} spoiler tag${spoilers > 1 ? 's' : ''}</button>` : ''}</p>
          <div class="vibes" id="vibes">${vibes.map(vibe).join('')}</div></section>` : ''}

        ${m.trailer?.site === 'youtube' ? `<section><h2>Trailer</h2><p></p>
          ${inApp // YouTube embeds refuse to play inside apps, so the app shows the thumbnail and opens YouTube
            ? `<a class="trailer trailer-link" href="https://www.youtube.com/watch?v=${esc(m.trailer.id)}" target="_blank" rel="noopener" style="background-image:url(https://i.ytimg.com/vi/${esc(m.trailer.id)}/hqdefault.jpg)"><span>▶ Watch on YouTube</span></a>`
            : `<iframe class="trailer" src="https://www.youtube-nocookie.com/embed/${esc(m.trailer.id)}" title="Trailer" loading="lazy" allowfullscreen></iframe>`}</section>` : ''}

        ${m.characters.edges.length ? `<section><h2>Cast</h2><p class="hint">Characters and their Japanese voice actors.</p>
          <div class="cast">${m.characters.edges.map(e => `
            <div class="cast-row">
              <div><img src="${safeUrl(e.node.image?.medium)}" alt="" loading="lazy"><span><b>${esc(e.node.name.full)}</b><small>${cap(e.role)}</small></span></div>
              ${e.voiceActors[0] ? `<div><img src="${safeUrl(e.voiceActors[0].image?.medium)}" alt="" loading="lazy"><span><b>${esc(e.voiceActors[0].name.full)}</b><small>Voice</small></span></div>` : ''}
            </div>`).join('')}</div></section>` : ''}
      </div>

      <aside class="side-box">
        <div id="odds" hidden></div>
        ${m.nextAiringEpisode ? `<div><small class="hint">Episode ${m.nextAiringEpisode.episode} airs in</small>
          <div class="countdown" data-at="${m.nextAiringEpisode.airingAt}">${countdown(m.nextAiringEpisode.airingAt - Date.now() / 1000)}</div></div>` : ''}
        ${watch(m, streams)}
        <dl>
          ${row('Studio', m.studios.nodes.map(s => s.name).join(', '))}
          ${row('Aired', [date(m.startDate), date(m.endDate)].filter(Boolean).join(' to '))}
          ${row('Total runtime', runtime ? minutes(runtime) : '')}
          ${row('Source', cap(m.source))}
          ${row('Popularity', m.popularity?.toLocaleString() + ' users')}
          ${row('Favourites', m.favourites?.toLocaleString())}
        </dl>
        ${ranks.length ? `<div>${ranks.map(r => `<div class="rank"><b>#${r.rank}</b><span>${cap(r.context)}${r.season ? ` (${cap(r.season)} ${r.year})` : r.year ? ` (${r.year})` : ''}</span></div>`).join('')}</div>` : ''}
        ${dist.length ? `<div><h3>Score spread</h3><p></p>
          <div class="dist">${dist.map(d => `<i style="height:${(d.amount / maxAmt) * 100}%" title="${d.score}: ${d.amount.toLocaleString()} users"></i>`).join('')}</div>
          <div class="dist-labels"><span>10</span><span>100</span></div></div>` : ''}
        <a class="btn ghost" href="${safeUrl(m.siteUrl) || `https://anilist.co/anime/${+m.id}`}" target="_blank" rel="noopener">Open on AniList</a>
      </aside>
    </div>

    ${recs.length ? `<section><div class="section-head"><h2>If you like this</h2></div><div id="recs" class="row"></div></section>` : ''}
    </div>
    ${hasEps ? `<div id="panel-episodes" role="tabpanel" aria-labelledby="tab-episodes" hidden></div>` : ''}`;

  if (recs.length) cards($('#recs'), recs);
  $('#spoil')?.addEventListener('click', e => {
    $('#vibes').innerHTML = tags.slice(0, 14).map(vibe).join('');
    e.target.remove();
  });
  renderListControls();
  if (hasEps) tab(qs().get('tab') === 'episodes' ? 'episodes' : 'overview', false);
  odds().catch(() => {}); // a nice-to-have: stay quiet if it fails
}

// "Will you finish it?" from your own finished/dropped history. Skipped once you've finished the show.
async function odds() {
  if (!user || entry?.status === 'COMPLETED' || entry?.status === 'REPEATING') return;
  const d = await gql(`query($u:Int){ MediaListCollection(userId:$u,type:ANIME,status_in:[COMPLETED,REPEATING,DROPPED,PAUSED,CURRENT]){
    lists{ entries{ status updatedAt media{ id episodes format genres status nextAiringEpisode{ episode } } } } } }`, { u: user.id });
  const seen = new Map(d.MediaListCollection.lists.flatMap(l => l.entries).filter(e => e.media.id !== media.id).map(e => [e.media.id, e]));
  const o = finishOdds([...seen.values()], media);
  if (!o) return;
  const el = $('#odds');
  el.hidden = false;
  el.className = 'odds-box';
  el.style.setProperty('--p', o.pct);
  el.innerHTML = `
    <h3>Will you finish it?</h3>
    <div class="odds-meter"><b>${o.pct}%</b><span>chance you'll ride this to the end</span></div>
    <div class="bar"><i style="width:${o.pct}%"></i></div>
    <p class="hint" style="margin:0">${o.reasons.length ? o.reasons.map(esc).join('. ') + '.' : 'About your usual.'} You finish ${o.base}% of what you start (from ${o.from} titles).</p>`;
}

// Official links from AniList first, then the free sites everythingmoe ranks (hentai sites for 18+ titles).
function watch(m, streams) {
  const sites = siteLinks(m), SHOW = 6;
  const tip = { direct: s => `Opens ${s.host} on this show`, search: s => `Search ${s.host} for “${s.q}”`, home: s => `Opens ${s.host} and copies “${s.q}” for its search box` };
  const site = s => `<a class="site" href="${esc(s.href)}" target="_blank" rel="noopener noreferrer"${s.kind === 'home' ? ` data-copy="${esc(s.q)}"` : ''} title="${esc(tip[s.kind](s))}">
      <img src="${esc(s.icon)}" alt="" loading="lazy">
      <span><b>${esc(s.name)}</b><small>${s.kind === 'direct' ? 'Opens this show' : s.kind === 'home' ? 'Copy & open' : esc(s.tags || 'Search')}</small></span></a>`;
  return `<div>
    <h3>Where to watch</h3>
    ${streams.length ? `<p class="hint">Official, from AniList. Availability depends on your region.</p><div class="stream">${streams.map(l => `
      <a href="${safeUrl(l.url) || '#'}" target="_blank" rel="noopener" style="--c:${safeColor(l.color)}">${safeUrl(l.icon) ? `<img src="${safeUrl(l.icon)}" alt="">` : ''}${esc(l.site)}</a>`).join('')}</div>` : ''}
    <p class="hint" style="margin:${streams.length ? '16px' : '6px'} 0 8px">${m.isAdult ? 'Hentai streaming' : 'Free streaming sites'}, ranked by <a href="https://everythingmoe.com/" target="_blank" rel="noopener">everythingmoe</a>. Most links search for “${esc(sites[0]?.q)}”.</p>
    <div class="sites">${sites.slice(0, SHOW).map(site).join('')}</div>
    ${sites.length > SHOW ? `<details class="more-sites"><summary>${sites.length - SHOW} more sites</summary><div class="sites">${sites.slice(SHOW).map(site).join('')}</div></details>` : ''}
    <p class="hint" style="margin:10px 0 0">Unlicensed and ad-supported. Whether they're legal depends on where you live.</p>
  </div>`;
}

function vibe(t) {
  return `<div class="vibe"><span>${esc(t.name)}${t.isMediaSpoiler ? ' (spoiler)' : ''}</span><div class="bar" style="--c:var(--line)"><i style="width:${t.rank}%"></i></div><span>${t.rank}</span></div>`;
}
function row(k, v) { return v && !String(v).startsWith('undefined') ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : ''; }

function renderListControls() {
  const el = $('#list-ctl');
  if (!user) { el.innerHTML = '<a class="btn ghost" href="pass.html">Connect AniList to track</a>'; return; }
  if (!user.canWrite) { el.innerHTML = entry ? `<span class="tag s-${entry.status}">${STATUS[entry.status]}, ep ${entry.progress}</span>` : ''; return; }
  // total = episodes out so far; only a known final count can complete the show
  const total = media.episodes || (media.nextAiringEpisode ? media.nextAiringEpisode.episode - 1 : 0), final = media.episodes || 0;
  el.innerHTML = `
    <select id="status" aria-label="List status">
      <option value="">Add to list…</option>
      ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${entry?.status === k ? ' selected' : ''}>${v}</option>`).join('')}
    </select>
    ${entry ? `<span class="stepper">Ep ${entry.progress}${total ? ` / ${total}` : ''}${!total || entry.progress < total ? ' <button id="plus" aria-label="Watched one more episode">+1</button>' : ''}</span>` : ''}`;
  $('#status').onchange = e => e.target.value && save({ status: e.target.value, ...(e.target.value === 'COMPLETED' && final ? { progress: final } : {}) });
  $('#plus') && ($('#plus').onclick = () => {
    const progress = entry.progress + 1;
    save({ progress, ...(finishes(progress, media) ? { status: 'COMPLETED' } : entry.status === 'PLANNING' ? { status: 'CURRENT' } : {}) });
  });
}

async function save(change) {
  try {
    const d = await saveEntries([{ mediaId: id, ...change }]);
    entry = d.m0;
    chime(entry.status === 'COMPLETED' && entry.progress ? 'done' : 'tick');
    toast(entry.status === 'COMPLETED' ? 'Completed. Where to next?' : `Saved: ${STATUS[entry.status]}, ep ${entry.progress}`);
    renderListControls();
    if (eps.rows) drawEps();
  } catch (e) { toast(e.message); }
}

// ---- Episodes tab ------------------------------------------------------------
const eps = { view: store.get('animetro.epView') === 'icons' ? 'icons' : 'list', from: null, rows: null, kid: undefined, streams: null, total: 0, note: '' };

function tab(name, remember = true) {
  document.querySelectorAll('[data-tab]').forEach(b => {
    const on = b.dataset.tab === name;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    $(`#panel-${b.dataset.tab}`).hidden = !on;
  });
  if (remember) { const p = qs(); name === 'episodes' ? p.set('tab', name) : p.delete('tab'); history.replaceState(null, '', `?${p}`); }
  if (name === 'episodes' && eps.from === null) loadEps(Math.floor((entry?.progress || 0) / PAGE) * PAGE); // open on the range with your next episode
}

async function loadEps(from) {
  eps.from = from;
  const panel = $('#panel-episodes');
  if (!eps.rows) panel.innerHTML = '<div class="loading"><div class="train" aria-hidden="true"><i></i><i></i><i></i></div><p>Fetching episodes…</p></div>';
  else $('#eps')?.setAttribute('aria-busy', 'true');
  let kitsu = [], count = 0;
  try {
    if (eps.kid === undefined) eps.kid = await kitsuId(media);
    if (eps.kid) ({ eps: kitsu, count } = await kitsuRange(eps.kid, from, episodeTotal(media) - from));
    eps.note = eps.kid ? 'Titles, pictures and summaries from <a href="https://kitsu.app" target="_blank" rel="noopener">Kitsu</a>.' : "Kitsu doesn't have this show, so only numbers and dates are shown.";
  } catch { eps.note = "Couldn't reach Kitsu for titles and pictures. Try again later."; }
  eps.streams ??= await gql('query($id:Int){Media(id:$id){streamingEpisodes{title thumbnail url site}}}', { id }).then(d => d.Media.streamingEpisodes).catch(() => []);
  eps.total = Math.max(eps.total, episodeTotal(media, count));
  const all = rows({ total: eps.total, kitsu, streams: eps.streams, schedule: media.airingSchedule.nodes });
  eps.rows = all.slice(from, from + PAGE);
  drawEps();
}

function drawEps() {
  const progress = entry?.progress || 0, canMark = user?.canWrite;
  eps.rows.forEach(r => (r.state = epState(r, progress)));
  const when = r => (r.state === 'upcoming' ? `airs in <span data-at="${r.at / 1000}">${countdown(r.at / 1000 - Date.now() / 1000)}</span>`
    : r.at ? new Date(r.at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
  const badge = r => (r.state === 'watched' ? '<span class="tag s-COMPLETED">✓ Watched</span>' : r.state === 'next' ? '<span class="tag next-up">Next up</span>' : r.state === 'upcoming' ? '<span class="tag soon">Upcoming</span>' : '');
  const mark = r => (canMark && r.n > progress && !r.upcoming ? `<button class="tag add" data-upto="${r.n}" title="Set your progress to episode ${r.n}">Watched up to here</button>` : '');
  const name = r => esc(r.title || `Episode ${r.n}`);
  const ranges = eps.total > PAGE ? Array.from({ length: Math.ceil(eps.total / PAGE) }, (_, i) => i * PAGE) : [];
  const blur = nsfw(media), aired = media.nextAiringEpisode ? media.nextAiringEpisode.episode - 1 : eps.total;

  $('#panel-episodes').innerHTML = `
    <div class="eps-tools">
      <div class="seg" role="group" aria-label="View as">
        <button data-epview="list" aria-pressed="${eps.view === 'list'}">List</button>
        <button data-epview="icons" aria-pressed="${eps.view === 'icons'}">Icons</button>
      </div>
      ${ranges.length ? `<div class="chips" role="radiogroup" aria-label="Episodes">${ranges.map(f =>
        `<label><input type="radio" name="eprange" value="${f}"${f === eps.from ? ' checked' : ''}><span>${f + 1}–${Math.min(f + PAGE, eps.total)}</span></label>`).join('')}</div>` : ''}
      <p class="hint" style="margin:0">${progress ? (progress >= aired ? "You're caught up. " : `You've watched ${progress} of ${aired}. `) : ''}${eps.note}</p>
    </div>
    ${eps.view === 'list'
      ? `<ol class="eps-list" id="eps" start="${eps.from + 1}">${eps.rows.map(r => `
        <li class="ep ${r.state}" id="ep-${r.n}">
          <span class="ep-n">${r.n}</span>
          <div class="ep-main">
            <b>${name(r)}</b>
            <small>${[r.native && esc(r.native), when(r), r.length && `${r.length} min`].filter(Boolean).join(' · ')}</small>
            ${r.summary ? `<details><summary>Summary</summary><p>${esc(r.summary)}</p></details>` : ''}
          </div>
          <div class="ep-side">${badge(r)}${r.watch && safeUrl(r.watch.url.replace(/^http:/, 'https:')) ? `<a class="tag" href="${safeUrl(r.watch.url.replace(/^http:/, 'https:'))}" target="_blank" rel="noopener">${esc(r.watch.site)} ↗</a>` : ''}${mark(r)}</div>
        </li>`).join('')}</ol>`
      : `<ol class="eps-grid" id="eps">${eps.rows.map(r => `
        <li class="ep-card ${r.state}" id="ep-${r.n}">
          <div class="ep-thumb${blur}">${safeUrl(r.thumb) ? `<img src="${safeUrl(r.thumb)}" alt="" loading="lazy">` : `<span class="ep-none">${r.n}</span>`}
            <span class="ep-n">EP ${r.n}</span>${r.state === 'watched' ? '<span class="ep-check" aria-label="Watched">✓</span>' : ''}</div>
          <b title="${name(r)}">${name(r)}</b>
          <small>${[when(r), r.length && `${r.length} min`].filter(Boolean).join(' · ') || '&nbsp;'}</small>
          <div class="ep-side">${badge(r)}${mark(r)}</div>
        </li>`).join('')}</ol>`}`;
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab]');
  if (t) return tab(t.dataset.tab);
  const v = e.target.closest('[data-epview]');
  if (v) { eps.view = v.dataset.epview; store.set('animetro.epView', eps.view); drawEps(); return; }
  const up = e.target.closest('[data-upto]');
  if (up) {
    const progress = +up.dataset.upto;
    save({ progress, ...(finishes(progress, media) ? { status: 'COMPLETED' } : !entry || entry.status === 'PLANNING' ? { status: 'CURRENT' } : {}) });
  }
});
document.addEventListener('change', e => { if (e.target.name === 'eprange') loadEps(+e.target.value); });
// arrow keys move between the two tabs
document.addEventListener('keydown', e => {
  const t = e.target.closest?.('[data-tab]');
  if (!t || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const next = t.dataset.tab === 'overview' ? 'episodes' : 'overview';
  tab(next); $(`#tab-${next}`).focus();
});

// Sites without a search URL: copy the title as the link opens, so it's ready to paste.
document.addEventListener('click', e => {
  const a = e.target.closest('[data-copy]');
  if (a) navigator.clipboard?.writeText(a.dataset.copy).then(() => toast(`Copied “${a.dataset.copy}”. Paste it in ${a.querySelector('b').textContent}'s search.`), () => {});
});
setInterval(() => document.querySelectorAll('[data-at]').forEach(el => (el.textContent = countdown(el.dataset.at - Date.now() / 1000))), 1000);
boot().catch(e => fail($('#page'), e));
