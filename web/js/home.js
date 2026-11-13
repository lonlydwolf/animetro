import { gql, me, title, saveEntries, prefs } from './api.js';
import { header, $, esc, countdown, minutes, toast, fail, cover, tint, nsfw } from './ui.js';
import { remaining, fit, finishes, logged } from './fit.js';
import { chime, soundOn, setSound } from './chime.js';
import { recapOn, setRecap, ago } from './recap.js';
import { holdFocus, refocus } from './focus.js';
import { refreshes } from './refresh.js';

header();
const page = $('#page');
const M = 'id title{english romaji} episodes duration format status averageScore isAdult coverImage{large color} nextAiringEpisode{episode airingAt}';
let user, riding = [], planning = [], paused = [], budget = 0;
const pending = new Set(); // shows with a save on its way; their buttons stay off across redraws
let saves = 0; // +1 saves started; a refresh that overlaps one is dropped, its data may predate the save

// custom lists repeat entries; 18+ titles stay hidden unless 18+ is on
const entries = d => [...new Map(d.lists.flatMap(l => l.entries).map(e => [e.media.id, e])).values()].filter(e => !e.media.isAdult || prefs.adult());

async function boot() {
  user = await me();
  if (!user) return welcome();
  apply(await load());
  render();
}

// fresh: MAL-Sync and other apps update AniList while you watch, so home always asks again
async function load() {
  const d = await gql(`query($u:Int){
    riding: MediaListCollection(userId:$u,type:ANIME,status_in:[CURRENT,REPEATING]){ lists{ entries{ status progress media{ ${M} } } } }
    planning: MediaListCollection(userId:$u,type:ANIME,status:PLANNING){ lists{ entries{ progress media{ ${M} } } } }
    paused: MediaListCollection(userId:$u,type:ANIME,status:PAUSED,sort:UPDATED_TIME_DESC){ lists{ entries{ progress updatedAt media{ ${M} } } } }
  }`, { u: user.id }, { fresh: true });
  return d;
}

function apply(d) {
  riding = entries(d.riding);
  planning = entries(d.planning);
  paused = entries(d.paused).sort((a, b) => b.updatedAt - a.updatedAt);
}

// Keeping Home current: ask AniList again after you've been away a while, or when a countdown reaches zero.
// The shown data stays up while it loads (no loading screen), and the redraw keeps your scroll, focus and typing.
const editing = () => { const a = document.activeElement; return page.contains(a) && (a.isContentEditable || a.matches('input, textarea, select')); };
const live = refreshes({
  load, show: d => { apply(d); redraw(); }, saves: () => saves, busy: () => !user || pending.size > 0, editing,
  ats: () => [...page.querySelectorAll('[data-at]')].map(el => +el.dataset.at),
});

function redraw() {
  const y = scrollY, f = page.contains(document.activeElement) ? document.activeElement : null, key = f && focusKey(f);
  const typed = [...page.querySelectorAll('input[id], textarea[id], select[id]')].map(el => [el.id, el.value]);
  render();
  for (const [id, v] of typed) { const el = document.getElementById(id); if (el && el.value !== v) el.value = v; } // what you typed, as you typed it
  if (key) page.querySelector(key)?.focus({ preventScroll: true });
  scrollTo(0, y);
}

const away = ev => { if (ev.type !== 'blur' || ev.target === window) live.hide(); };
const back = ev => { if (ev.type !== 'focus' || ev.target === window) live.back(); };
document.addEventListener('visibilitychange', ev => (document.hidden ? away : back)(ev));
window.addEventListener('blur', away);
window.addEventListener('focus', back);
// done typing: show what arrived meanwhile. Wait a tick: leaving a field fires change and focusout before focus lands
// on the next control, and redrawing then would replace the control focus is moving to.
const settle = () => setTimeout(live.settle);
page.addEventListener('focusout', settle);
page.addEventListener('change', settle);

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Riding the last train' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function render() {
  const rows = riding.map(e => ({ e, r: remaining(e) }));
  const ready = rows.filter(x => x.r.left > 0 || !x.r.airing)
    .sort((a, b) => b.r.last - a.r.last || a.r.minutes - b.r.minutes);
  // airing shows with nothing known to be out; ones AniList has no schedule for go last
  const at = x => x.e.media.nextAiringEpisode?.airingAt ?? Infinity;
  const waiting = rows.filter(x => x.r.left === 0 && x.r.airing).sort((a, b) => at(a) - at(b));
  const today = waiting.filter(x => at(x) - Date.now() / 1000 < 86400).length;
  const left = ready.reduce((a, x) => a + x.r.minutes, 0);

  page.innerHTML = `
    <section class="home-hero">
      <p class="hint" style="margin:0">${greeting()},</p>
      <h1>${esc(user.name)}</h1>
      <p class="head-pills" style="margin:10px 0 0">
        <button class="tag sound" id="recaps" aria-pressed="${recapOn()}" title="Recap where you stopped on shows you're watching, not just paused ones">${recapOn() ? 'Recaps on' : 'Recaps off'}</button>
        <button class="tag sound" id="sound" aria-pressed="${soundOn()}">${soundOn() ? 'Chimes on' : 'Chimes off'}</button></p>
      <p class="home-sum">${riding.length ? `${ready.length} ready to watch${left ? ` (${minutes(left)} of episodes)` : ''} · ${waiting.length} waiting for new episodes${today ? `, ${today} arriving today` : ''}` : 'Nothing on your Watching list yet.'}</p>
    </section>

    ${ready.length ? `<section>
      <div class="section-head"><h2>Ready to watch</h2></div>
      <div class="rides">${ready.map(ride).join('')}</div></section>` : ''}

    ${waiting.length ? `<section>
      <div class="section-head"><h2>Waiting at the platform</h2><a href="departures.html">Full board</a></div>
      <p class="hint">${waiting.some(x => x.r.unknown) ? 'These are the next episodes on their way. Shows with no schedule on AniList may have new ones out already.' : "You're caught up. These are the next episodes on their way."}</p>
      <div class="rides">${waiting.map(ride).join('')}</div></section>` : ''}

    ${paused.length ? `<section>
      <div class="section-head"><h2>Paused at the platform</h2><span class="hint" style="margin:0">${paused.length} waiting for you</span></div>
      <div class="paused">${paused.slice(0, 8).map(e => `
        <a class="paused-stop${nsfw(e.media)}" href="anime.html?id=${e.media.id}&recap=1" style="--c:${tint(e.media, 'var(--platform)')}">
          <img src="${cover(e.media)}" alt="" loading="lazy">
          <span><b>${esc(title(e.media))}</b><small>Stopped at ep ${e.progress}${e.updatedAt ? ` · ${ago(e.updatedAt)}` : ''}</small><em>Reboard ↩</em></span>
        </a>`).join('')}</div>
      ${paused.length > 8 ? `<p class="hint">${paused.length - 8} more on your Paused list.</p>` : ''}</section>` : ''}

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

  $('#recaps')?.addEventListener('click', () => {
    setRecap(!recapOn());
    render();
    toast(recapOn() ? 'Recaps on: shows you\'re watching get a recap of where you stopped.' : 'Recaps off: only paused shows get one.');
    $('#recaps')?.focus();
  });
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
    : r.unknown ? 'Airing · no schedule on AniList'
    : m.status === 'NOT_YET_RELEASED' ? 'Not aired yet'
    : r.airing ? 'Caught up'
    : 'Every episode watched';
  const canPlus = user.canWrite && (r.more || (!r.airing && total && e.progress < total));
  return `
    <div class="ride${r.last ? ' is-last' : ''}${nsfw(m)}" style="--c:${tint(m, 'var(--platform)')}" data-id="${m.id}">
      <a class="ride-cover" href="anime.html?id=${m.id}"><img src="${cover(m)}" alt="" loading="lazy"></a>
      <div class="ride-body">
        <a class="ride-title" href="line.html?id=${m.id}">${esc(title(m))}</a>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <p class="ride-status">Ep ${e.progress}${total ? ` / ${total}` : ''} · ${status}</p>
        ${next ? `<p class="ride-next">Ep ${next.episode} airs in <b data-at="${next.airingAt}">${countdown(next.airingAt - Date.now() / 1000)}</b></p>` : ''}
        ${!r.left && !r.airing && user.canWrite && e.status !== 'COMPLETED' ? `<button class="tag add" data-complete${pending.has(m.id) ? ' disabled' : ''}>Mark completed</button>` : ''}
        ${recapOn() && e.progress > 0 ? `<a class="ride-recap" href="anime.html?id=${m.id}&recap=1">Recap ↩</a>` : ''}
      </div>
      ${canPlus ? `<button class="ride-plus" data-plus aria-label="Watched episode ${e.progress + 1}"${pending.has(m.id) ? ' disabled' : ''}>+1</button>` : ''}
    </div>`;
}

// What to focus after a redraw: the same control, found again by what it is and which show it belongs to.
function focusKey(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const card = el.closest('.ride');
  const box = card ? `.ride[data-id="${card.dataset.id}"] ` : el.closest('.fit-list') ? '.fit-list ' : el.closest('.paused') ? '.paused ' : '';
  const attr = ['data-plus', 'data-complete', 'data-fit'].find(a => el.hasAttribute(a));
  if (attr) return `${box}[${attr}${el.getAttribute(attr) ? `="${CSS.escape(el.getAttribute(attr))}"` : ''}]`;
  if (el.matches('a[href]')) return `${box}a[href="${CSS.escape(el.getAttribute('href'))}"]`;
  return null;
}

page.addEventListener('click', async ev => {
  const card = ev.target.closest('.ride');
  const plus = ev.target.closest('[data-plus]'), done = ev.target.closest('[data-complete]');
  if (card && (plus || done)) {
    const e = riding.find(x => x.media.id === +card.dataset.id), m = e?.media;
    if (!e || pending.has(m.id)) return;
    const progress = logged(e.progress, m, !!done);
    if (progress == null) return; // +1 past the final episode
    pending.add(m.id);
    saves++;
    const finished = done || finishes(progress, m), button = plus || done, hold = holdFocus(document, page, button);
    let saved = false;
    button.disabled = true;
    try {
      await saveEntries([{ mediaId: m.id, progress, ...(finished ? { status: 'COMPLETED' } : {}) }]);
      e.progress = progress;
      if (finished) {
        hold.drop();
        chime('done');
        toast(`End of the line! ${title(m)} completed.`);
        card.classList.add('arrived');
        // the card stays locked through its exit: a second click here would log past the final episode
        setTimeout(() => { riding = riding.filter(x => x !== e); pending.delete(m.id); render(); }, 900);
        return;
      }
      chime('tick');
      toast(`Episode ${progress} logged`);
      saved = true;
    } catch (err) { toast(err.message); }
    // read focus just before the redraw; the clicked control falls back to the nearest one left on its card
    // (an airing show that just caught up loses its +1)
    const at = `.ride[data-id="${m.id}"]`;
    const to = hold.settle(focusKey, [`${at} ${plus ? '[data-plus]' : '[data-complete]'}`, `${at} [data-plus]`, `${at} [data-complete]`, `${at} .ride-title`]);
    pending.delete(m.id);
    if (saved) render();
    else document.querySelectorAll(`${at} [data-plus], ${at} [data-complete]`).forEach(b => b.removeAttribute('disabled'));
    refocus(page, to);
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
      <li class="${nsfw(p.media)}" style="--c:${tint(p.media, 'var(--platform)')}">
        <img src="${cover(p.media)}" alt="" loading="lazy">
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

setInterval(() => {
  document.querySelectorAll('[data-at]').forEach(el => (el.textContent = countdown(el.dataset.at - Date.now() / 1000)));
  if (!document.hidden) live.tick();
}, 1000);
// data-ready tells the Mac app's self-test whether the page really loaded
boot().then(() => (document.documentElement.dataset.ready = 'ok'))
  .catch(e => { fail(page, e); document.documentElement.dataset.ready = 'error'; });
