import { gql, me, title, saveEntries } from './api.js';
import { header, $, esc, countdown, minutes, toast, fail } from './ui.js';
import { remaining, fit } from './fit.js';
import { chime, soundOn, setSound } from './chime.js';

header();
const page = $('#page');
const M = 'id title{english romaji} episodes duration format status averageScore coverImage{large color} nextAiringEpisode{episode airingAt}';
let user, riding = [], planning = [], budget = 0;

const entries = d => [...new Map(d.lists.flatMap(l => l.entries).map(e => [e.media.id, e])).values()]; // custom lists repeat entries

async function boot() {
  user = await me();
  if (!user) return welcome();
  // fresh: MAL-Sync and other apps update AniList while you watch, so home always asks again
  const d = await gql(`query($u:Int){
    riding: MediaListCollection(userId:$u,type:ANIME,status_in:[CURRENT,REPEATING]){ lists{ entries{ status progress media{ ${M} } } } }
    planning: MediaListCollection(userId:$u,type:ANIME,status:PLANNING){ lists{ entries{ progress media{ ${M} } } } }
  }`, { u: user.id }, { fresh: true });
  riding = entries(d.riding);
  planning = entries(d.planning);
  render();
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Riding the last train' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function render() {
  const rows = riding.map(e => ({ e, r: remaining(e) }));
  const ready = rows.filter(x => x.r.left > 0 || !x.r.airing)
    .sort((a, b) => b.r.last - a.r.last || a.r.minutes - b.r.minutes);
  const waiting = rows.filter(x => x.r.left === 0 && x.r.airing)
    .sort((a, b) => a.e.media.nextAiringEpisode.airingAt - b.e.media.nextAiringEpisode.airingAt);
  const today = waiting.filter(x => x.e.media.nextAiringEpisode.airingAt - Date.now() / 1000 < 86400).length;
  const left = ready.reduce((a, x) => a + x.r.minutes, 0);

  page.innerHTML = `
    <section class="home-hero">
      <p class="hint" style="margin:0">${greeting()},</p>
      <h1>${esc(user.name)}</h1>
      <p class="home-sum">${riding.length ? `${ready.length} ready to watch${left ? ` (${minutes(left)} of episodes)` : ''} · ${waiting.length} waiting for new episodes${today ? `, ${today} arriving today` : ''}` : 'Nothing on your Watching list yet.'}</p>
    </section>

    ${ready.length ? `<section>
      <div class="section-head"><h2>Ready to watch</h2><button class="tag sound" id="sound" aria-pressed="${soundOn()}">${soundOn() ? 'Chimes on' : 'Chimes off'}</button></div>
      <div class="rides">${ready.map(ride).join('')}</div></section>` : ''}

    ${waiting.length ? `<section>
      <div class="section-head"><h2>Waiting at the platform</h2><a href="departures.html">Full board</a></div>
      <p class="hint">You're caught up. These are the next episodes on their way.</p>
      <div class="rides">${waiting.map(ride).join('')}</div></section>` : ''}

    ${!riding.length ? `<section><p class="empty">Start something from <a href="foryou.html">For you</a> or <a href="search.html">Discover</a>, and it will show up here.</p></section>` : ''}

    <section>
      <div class="section-head"><h2>Got some time?</h2></div>
      <p class="hint">Pick how long you have. Animetro fills it from what you're watching (closest to finishing first), then the best-rated shows on your Planning list.</p>
      <div class="fit-chips">
        ${[[30, '30 min'], [60, '1 hour'], [120, '2 hours'], [180, 'Movie night, 3h'], [420, 'Long flight, 7h']].map(([m, l]) => `<button class="tag" data-fit="${m}" aria-pressed="${budget === m}">${l}</button>`).join('')}
        <label class="fit-custom"><input type="number" min="10" max="2000" step="5" id="fit-min" placeholder="Minutes" value="${budget && ![30, 60, 120, 180, 420].includes(budget) ? budget : ''}"><span>min</span></label>
      </div>
      <div id="fit"></div>
    </section>`;

  $('#sound')?.addEventListener('click', e => {
    setSound(!soundOn());
    e.target.textContent = soundOn() ? 'Chimes on' : 'Chimes off';
    e.target.setAttribute('aria-pressed', soundOn());
    if (soundOn()) chime('done');
  });
  if (budget) showFit();
}

function ride({ e, r }) {
  const m = e.media, total = m.episodes, next = m.nextAiringEpisode;
  const pct = total ? Math.min(100, (e.progress / total) * 100) : r.out ? (e.progress / r.out) * 100 : 0;
  const status = r.last ? '<b class="last-ep">Last episode!</b>'
    : r.left > 1 ? `${r.left} episode${r.left === 1 ? '' : 's'} ${r.airing ? 'ready' : 'left'} · ${minutes(r.minutes)}`
    : r.left === 1 && r.out === 1 ? `One sitting · ${minutes(r.minutes)}`
    : r.left === 1 ? `1 episode ready · ${minutes(r.minutes)}`
    : r.airing ? 'Caught up'
    : 'Every episode watched';
  const canPlus = user.canWrite && (r.left > 0 || (!r.airing && total && e.progress < total));
  return `
    <div class="ride${r.last ? ' is-last' : ''}" style="--c:${m.coverImage.color || 'var(--platform)'}" data-id="${m.id}">
      <a class="ride-cover" href="anime.html?id=${m.id}"><img src="${m.coverImage.large}" alt="" loading="lazy"></a>
      <div class="ride-body">
        <a class="ride-title" href="line.html?id=${m.id}">${esc(title(m))}</a>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <p class="ride-status">Ep ${e.progress}${total ? ` / ${total}` : ''} · ${status}</p>
        ${next ? `<p class="ride-next">Ep ${next.episode} airs in <b data-at="${next.airingAt}">${countdown(next.airingAt - Date.now() / 1000)}</b></p>` : ''}
        ${!r.left && !r.airing && user.canWrite && e.status !== 'COMPLETED' ? '<button class="tag add" data-complete>Mark completed</button>' : ''}
      </div>
      ${canPlus ? `<button class="ride-plus" data-plus aria-label="Watched episode ${e.progress + 1}">+1</button>` : ''}
    </div>`;
}

page.addEventListener('click', async ev => {
  const card = ev.target.closest('.ride');
  const plus = ev.target.closest('[data-plus]'), done = ev.target.closest('[data-complete]');
  if (card && (plus || done)) {
    const e = riding.find(x => x.media.id === +card.dataset.id), m = e.media;
    const progress = done ? e.progress : e.progress + 1;
    const finished = done || (!m.nextAiringEpisode && m.episodes && progress >= m.episodes);
    (plus || done).disabled = true;
    try {
      await saveEntries([{ mediaId: m.id, progress, ...(finished ? { status: 'COMPLETED' } : {}) }]);
      e.progress = progress;
      if (finished) {
        chime('done');
        toast(`End of the line! ${title(m)} completed.`);
        card.classList.add('arrived');
        setTimeout(() => { riding = riding.filter(x => x !== e); render(); }, 900);
      } else {
        chime('tick');
        toast(`Episode ${progress} logged`);
        render();
      }
    } catch (err) { toast(err.message); (plus || done).disabled = false; }
    return;
  }
  const chip = ev.target.closest('[data-fit]');
  if (chip) { budget = +chip.dataset.fit; $('#fit-min').value = ''; markChips(); showFit(); }
});
page.addEventListener('input', ev => {
  if (ev.target.id !== 'fit-min') return;
  budget = Math.min(2000, +ev.target.value || 0);
  markChips();
  showFit();
});
const markChips = () => document.querySelectorAll('[data-fit]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.fit === budget)));

function showFit() {
  const el = $('#fit');
  if (!el || budget < 10) { if (el) el.innerHTML = ''; return; }
  const { picks, used } = fit(budget, riding, planning);
  if (!picks.length) { el.innerHTML = `<p class="hint">Nothing fits in ${minutes(budget)}. Even one episode runs longer.</p>`; return; }
  el.innerHTML = `
    <ol class="fit-list">${picks.map(p => `
      <li style="--c:${p.media.coverImage.color || 'var(--platform)'}">
        <img src="${p.media.coverImage.large}" alt="" loading="lazy">
        <div><a href="anime.html?id=${p.media.id}"><b>${esc(title(p.media))}</b></a>
          <small>${p.media.format === 'MOVIE' ? 'The movie' : p.eps === 1 ? `Episode ${p.from}` : `Episodes ${p.from} to ${p.to}`}${p.finishes ? ', and that finishes it' : p.fresh ? ', a new start' : ''}</small></div>
        <span>${minutes(p.minutes)}</span>
      </li>`).join('')}</ol>
    <p class="hint">Fills ${minutes(used)} of ${minutes(budget)}.${budget - used >= 10 ? ` ${minutes(budget - used)} left over for snacks.` : ''}</p>`;
}

function welcome() {
  page.innerHTML = `
    <section class="home-hero">
      <h1>All aboard</h1>
      <p class="home-sum">Connect AniList and this page becomes your platform: what you're watching, how many episodes are left, and when the next one arrives.</p>
      <p style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn" href="pass.html">Connect AniList</a><a class="btn ghost" href="search.html">Find a series</a></p>
    </section>`;
}

setInterval(() => document.querySelectorAll('[data-at]').forEach(el => (el.textContent = countdown(el.dataset.at - Date.now() / 1000))), 1000);
boot().catch(e => fail(page, e));
