// Ticket stubs: every show you've completed as a ticket stub, grouped by the year you arrived. The stubs come from
// your AniList list (see stubs.js); nothing is stored.
import { gql, me, title, prefs } from './api.js';
import { header, $, esc, fail, cover, tint, nsfw, minutes, FORMAT, safeUrl } from './ui.js';
import { stubs, album, serial, ordinal } from './stubs.js';
import { stubCard, showCard } from './share.js';

header();
const page = $('#page');
const FIRST = 24; // stubs shown per group before "Show more"
const byId = new Map();

const Q = `query($u:Int){ User(id:$u){ mediaListOptions{ scoreFormat } }
  list: MediaListCollection(userId:$u,type:ANIME,status_in:[COMPLETED,REPEATING]){ lists{ entries{
    status score repeat progress updatedAt startedAt{year month day} completedAt{year month day}
    media{ id title{english romaji} format episodes duration isAdult coverImage{large color} } } } } }`;

async function boot() {
  const user = await me();
  if (!user) {
    page.innerHTML = `<section class="fy-hero"><h1>Ticket stubs</h1>
      <p class="hint" style="font-size:1rem;max-width:56ch">Every show you finish becomes a ticket stub you can keep and share, sorted by the year you arrived. Connect AniList (a username is enough) to punch yours.</p>
      <a class="btn" href="pass.html">Connect AniList</a></section>`;
    return;
  }
  const d = await gql(Q, { u: user.id });
  const list = stubs(d.list.lists.flatMap(l => l.entries), { format: d.User.mediaListOptions?.scoreFormat, adult: prefs.adult() });
  list.forEach(s => byId.set(s.id, s));
  render(user, list);
}

function render(user, list) {
  const groups = album(list);
  const total = list.reduce((t, s) => t + (s.ride.minutes || 0), 0);
  const rewatched = list.filter(s => s.rewatch.count || s.rewatch.now).length;
  const dated = groups.filter(g => g.year != null);
  page.innerHTML = `
    <section class="fy-hero">
      <p class="hint" style="margin:0">${esc(user.name)}'s collection</p>
      <h1>Ticket stubs</h1>
      <p class="hint album-lead">Every show you've completed, punched and kept. Stubs are numbered in the order you finished them; share any one as a picture.</p>
      <div class="sync-sum map-sum">
        <div><b>${list.length.toLocaleString()}</b><span>stubs collected</span></div>
        <div><b>${minutes(total)}</b><span>ridden</span></div>
        <div><b>${dated.length}</b><span>${dated.length === 1 ? 'year' : 'years'} on the line</span></div>
        <div><b>${rewatched}</b><span>${rewatched === 1 ? 'show' : 'shows'} ridden again</span></div>
      </div>
      ${groups.length > 1 ? `<nav class="album-years" aria-label="Jump to a year">${groups.map(g =>
        `<a href="#y-${g.year ?? 'undated'}">${g.year ?? 'Undated'}<small>${g.stubs.length}</small></a>`).join('')}</nav>` : ''}
    </section>
    ${groups.map(g => `
    <section class="album-year" id="y-${g.year ?? 'undated'}" aria-labelledby="h-${g.year ?? 'undated'}">
      <div class="section-head"><h2 id="h-${g.year ?? 'undated'}">${esc(g.label)}</h2>
        <span class="hint" style="margin:0">${g.stubs.length} ${g.stubs.length === 1 ? 'stub' : 'stubs'}${g.minutes ? ` · ${minutes(g.minutes)} ridden` : ''}${g.year == null ? ' · AniList has no finish date for these' : ''}</span></div>
      <div class="stubs">${g.stubs.slice(0, FIRST).map(stub).join('')}</div>
      ${g.stubs.length > FIRST ? `<div class="more"><button class="btn ghost" type="button" data-more="${g.year ?? ''}">Show all ${g.stubs.length}</button></div>` : ''}
    </section>`).join('') || `<section><p class="empty">No completed shows on your list yet. Finish one and its stub turns up here.</p></section>`}`;

  page.addEventListener('click', e => {
    const share = e.target.closest('[data-share]');
    if (share) return shareStub(user, byId.get(+share.dataset.share));
    const more = e.target.closest('[data-more]');
    if (more) {
      const g = groups.find(x => String(x.year ?? '') === more.dataset.more);
      more.closest('section').querySelector('.stubs').insertAdjacentHTML('beforeend', g.stubs.slice(FIRST).map(stub).join(''));
      more.parentElement.remove();
    }
  });
}

const kindOf = s => [FORMAT[s.media.format], s.route.single ? '' : s.route.stops ? `${s.route.stops} stops` : ''].filter(Boolean).join(' · ');
// the stamp prints 再 ("again") and how many times; the words are for screen readers and on hover
const rewatchOf = s => (s.rewatch.now ? ['Now', 'Riding it again now'] : s.rewatch.count
  ? [s.rewatch.count > 1 ? `×${s.rewatch.count}` : 'Again', `Rewatched ${s.rewatch.count === 1 ? 'once' : `${s.rewatch.count} times`}`] : null);
const rideOf = s => (s.ride.minutes ? `${s.ride.estimated ? '~' : ''}${minutes(s.ride.minutes)}` : '');

function stub(s) {
  const m = s.media, name = title(m), kind = kindOf(s), rewatch = rewatchOf(s);
  return `
    <article class="stub${nsfw(m)}" style="--cover:${tint(m, 'var(--platform)')}" aria-label="${esc(`Stub ${s.no}: ${name}`)}"><div class="stub-paper">
      <div class="stub-main">
        <p class="stub-top"><span class="stub-brand">Animetro</span><span>${esc(kind)}</span><span class="stub-no">No. ${serial(s.no)}</span></p>
        <h3><a href="anime.html?id=${m.id}">${esc(name)}</a></h3>
        <div class="stub-route${s.route.single ? ' single' : ''}">
          <span><small>From</small><b>${esc(s.route.origin)}</b></span>
          <i aria-hidden="true"></i>
          <span><small>To</small><b>${esc(s.route.terminus)}</b></span>
        </div>
        <dl class="stub-facts">
          <div><dt>Boarded</dt><dd>${s.boarded ? esc(s.boarded.text) : '—'}</dd></div>
          <div><dt>Arrived</dt><dd>${s.arrived ? esc(s.arrived.text) : '—'}</dd></div>
          <div><dt>Ride time</dt><dd>${rideOf(s) || '—'}${s.days ? `<small> in ${s.days} ${s.days === 1 ? 'day' : 'days'}</small>` : ''}</dd></div>
        </dl>
        ${rewatch ? `<span class="stub-stamp" title="${rewatch[1]}"><b lang="ja" aria-hidden="true">再</b><span aria-hidden="true">${rewatch[0]}</span><span class="sr-only">${rewatch[1]}</span></span>` : ''}
      </div>
      <div class="stub-tail">
        <a class="stub-cover" href="anime.html?id=${m.id}" tabindex="-1"><img src="${cover(m)}" alt="" loading="lazy"></a>
        <p class="stub-score"><small>Your score</small>${s.score
          ? `<b aria-hidden="true">${esc(s.score.text)}</b>${s.score.out ? `<span aria-hidden="true">${s.score.out}</span>` : ''}<span class="sr-only">${esc(s.score.label)}</span>`
          : '<b class="none" aria-hidden="true">—</b><span>not rated</span>'}</p>
        <button class="stub-share" type="button" data-share="${m.id}" aria-label="${esc(`Share the stub for ${name}`)}">Share</button>
      </div>
    </div></article>`;
}

// The stub as a picture. An 18+ cover stays off the picture while 18+ covers are blurred.
function shareStub(user, s) {
  if (!s) return;
  const m = s.media, name = title(m), hide = m.isAdult && prefs.blur();
  showCard(() => stubCard({
    no: serial(s.no), nth: ordinal(s.no), name, color: tint(m, '#ffd23f'), cover: hide ? null : safeUrl(m.coverImage?.large) ? m.coverImage.large : '', adult: m.isAdult,
    kind: kindOf(s), origin: s.route.origin, terminus: s.route.terminus, single: s.route.single,
    boarded: s.boarded?.text, arrived: s.arrived?.text, ride: rideOf(s), days: s.days, score: s.score,
    rewatch: rewatchOf(s)?.[0] ?? null, rider: user.name,
  }), `${name}-stub-${serial(s.no)}.png`);
}

boot().catch(e => fail(page, e));
