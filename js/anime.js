import { gql, me, title, plainText, listStatus, saveEntries, CARD, prefs } from './api.js';
import { header, $, esc, qs, FORMAT, STATUS, minutes, countdown, cards, toast, fail, adultGate, nsfw } from './ui.js';

header();
const id = +qs().get('id');
const cap = s => (s ? s[0] + s.slice(1).toLowerCase().replace(/_/g, ' ') : '');
const date = d => (d?.year ? new Date(d.year, (d.month || 1) - 1, d.day || 1).toLocaleDateString(undefined, { year: 'numeric', month: d.month ? 'short' : undefined, day: d.day ? 'numeric' : undefined }) : '');

const Q = `query($id:Int){ Media(id:$id,type:ANIME){
  id title{english romaji native} synonyms format status episodes duration season seasonYear source countryOfOrigin
  startDate{year month day} endDate{year month day} averageScore meanScore popularity favourites genres isAdult
  description bannerImage coverImage{extraLarge color} siteUrl hashtag
  studios(isMain:true){nodes{name}}
  trailer{id site}
  nextAiringEpisode{episode airingAt}
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
      <p style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" id="gate-open">Show 18+ titles</button><a class="btn ghost" href="index.html">Back to search</a></p></section>`;
    $('#gate-open').onclick = adultGate;
    return;
  }
  entry = (await listStatus([id])).get(id);
  document.title = `${title(m)} · Animetro`;
  document.documentElement.style.setProperty('--line', m.coverImage.color || '#ffd23f');

  const runtime = (m.episodes || 0) * (m.duration || 0);
  const tags = m.tags.filter(t => t.rank >= 60);
  const spoilers = tags.filter(t => t.isMediaSpoiler).length;
  const vibes = tags.filter(t => !t.isMediaSpoiler).slice(0, 7);
  const dist = m.stats.scoreDistribution;
  const maxAmt = Math.max(1, ...dist.map(d => d.amount));
  const ranks = m.rankings.filter(r => r.allTime || r.season).slice(0, 4);
  const streams = m.externalLinks.filter(l => l.type === 'STREAMING');
  const recs = m.recommendations.nodes.map(n => n.mediaRecommendation).filter(r => r && (!r.isAdult || prefs.adult()));
  const hasLine = m.relations.edges.some(e => ['PREQUEL', 'SEQUEL', 'SIDE_STORY', 'PARENT', 'SPIN_OFF', 'ALTERNATIVE', 'SUMMARY'].includes(e.relationType));

  $('#page').innerHTML = `
    <section class="anime-hero bleed" style="--banner:${m.bannerImage && !nsfw(m) ? `url(${m.bannerImage})` : 'none'}">
      <div class="anime-top${nsfw(m)}">
        <img class="cover" src="${m.coverImage.extraLarge}" alt="">
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
            ${m.genres.map(g => `<a class="tag" href="explore.html?genres=${encodeURIComponent(g)}" style="text-decoration:none">${g}</a>`).join('')}
          </div>
          <div class="actions">
            ${hasLine ? `<a class="btn" href="line.html?id=${m.id}">See watch order</a>` : ''}
            <span id="list-ctl"></span>
          </div>
        </div>
      </div>
    </section>

    <div class="anime-body">
      <div>
        <section style="margin-top:0">
          <p class="synopsis">${esc(plainText(m.description || 'No synopsis on AniList yet.'))}</p>
        </section>

        ${vibes.length ? `<section><h2>Vibe check</h2><p class="hint">How strongly AniList users say each tag applies.${spoilers ? ` <button class="spoiler-btn" id="spoil">Show ${spoilers} spoiler tag${spoilers > 1 ? 's' : ''}</button>` : ''}</p>
          <div class="vibes" id="vibes">${vibes.map(vibe).join('')}</div></section>` : ''}

        ${m.trailer?.site === 'youtube' ? `<section><h2>Trailer</h2><p></p>
          <iframe class="trailer" src="https://www.youtube-nocookie.com/embed/${esc(m.trailer.id)}" title="Trailer" loading="lazy" allowfullscreen></iframe></section>` : ''}

        ${m.characters.edges.length ? `<section><h2>Cast</h2><p class="hint">Characters and their Japanese voice actors.</p>
          <div class="cast">${m.characters.edges.map(e => `
            <div class="cast-row">
              <div><img src="${e.node.image.medium}" alt="" loading="lazy"><span><b>${esc(e.node.name.full)}</b><small>${cap(e.role)}</small></span></div>
              ${e.voiceActors[0] ? `<div><img src="${e.voiceActors[0].image.medium}" alt="" loading="lazy"><span><b>${esc(e.voiceActors[0].name.full)}</b><small>Voice</small></span></div>` : ''}
            </div>`).join('')}</div></section>` : ''}
      </div>

      <aside class="side-box">
        ${m.nextAiringEpisode ? `<div><small class="hint">Episode ${m.nextAiringEpisode.episode} airs in</small>
          <div class="countdown" data-at="${m.nextAiringEpisode.airingAt}">${countdown(m.nextAiringEpisode.airingAt - Date.now() / 1000)}</div></div>` : ''}
        ${streams.length ? `<div><h3>Where to watch</h3><p class="hint">Availability depends on your region.</p><div class="stream">${streams.map(l => `
          <a href="${esc(l.url)}" target="_blank" rel="noopener" style="--c:${l.color || 'var(--rail)'}">${l.icon ? `<img src="${esc(l.icon)}" alt="">` : ''}${esc(l.site)}</a>`).join('')}</div></div>` : ''}
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
        <a class="btn ghost" href="${m.siteUrl}" target="_blank" rel="noopener">Open on AniList</a>
      </aside>
    </div>

    ${recs.length ? `<section><div class="section-head"><h2>If you like this</h2></div><div id="recs" class="row"></div></section>` : ''}`;

  if (recs.length) cards($('#recs'), recs);
  $('#spoil')?.addEventListener('click', e => {
    $('#vibes').innerHTML = tags.slice(0, 14).map(vibe).join('');
    e.target.remove();
  });
  renderListControls();
}

function vibe(t) {
  return `<div class="vibe"><span>${esc(t.name)}${t.isMediaSpoiler ? ' (spoiler)' : ''}</span><div class="bar" style="--c:var(--line)"><i style="width:${t.rank}%"></i></div><span>${t.rank}</span></div>`;
}
function row(k, v) { return v && !String(v).startsWith('undefined') ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : ''; }

function renderListControls() {
  const el = $('#list-ctl');
  if (!user) { el.innerHTML = '<a class="btn ghost" href="pass.html">Connect AniList to track</a>'; return; }
  if (!user.canWrite) { el.innerHTML = entry ? `<span class="tag s-${entry.status}">${STATUS[entry.status]}, ep ${entry.progress}</span>` : ''; return; }
  const total = media.episodes || (media.nextAiringEpisode ? media.nextAiringEpisode.episode - 1 : 0);
  el.innerHTML = `
    <select id="status" aria-label="List status">
      <option value="">Add to list…</option>
      ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${entry?.status === k ? ' selected' : ''}>${v}</option>`).join('')}
    </select>
    ${entry ? `<span class="stepper">Ep ${entry.progress}${total ? ` / ${total}` : ''}${!total || entry.progress < total ? ' <button id="plus" aria-label="Watched one more episode">+1</button>' : ''}</span>` : ''}`;
  $('#status').onchange = e => e.target.value && save({ status: e.target.value, ...(e.target.value === 'COMPLETED' && total ? { progress: total } : {}) });
  $('#plus') && ($('#plus').onclick = () => {
    const progress = entry.progress + 1;
    save({ progress, ...(total && progress >= total ? { status: 'COMPLETED' } : entry.status === 'PLANNING' ? { status: 'CURRENT' } : {}) });
  });
}

async function save(change) {
  try {
    const d = await saveEntries([{ mediaId: id, ...change }]);
    entry = d.m0;
    toast(entry.status === 'COMPLETED' ? 'Completed. Where to next?' : `Saved: ${STATUS[entry.status]}, ep ${entry.progress}`);
    renderListControls();
  } catch (e) { toast(e.message); }
}

setInterval(() => document.querySelectorAll('[data-at]').forEach(el => (el.textContent = countdown(el.dataset.at - Date.now() / 1000))), 1000);
boot().catch(e => fail($('#page'), e));
