import { gql, me, title, prefs } from './api.js';
import { header, $, esc, minutes, fail, nsfw, cover, tint } from './ui.js';
import { describe, dayKey, streak } from './journal.js';

header();
const page = $('#page');
const WEEK = 7 * 86400;
let user, acts = [], pageNo = 0, more = true, loading = false, filter = 'all';

const Q = `query($u:Int,$p:Int){ Page(page:$p,perPage:50){ pageInfo{ hasNextPage }
  activities(userId:$u,type:ANIME_LIST,sort:ID_DESC){ ... on ListActivity{ id status progress createdAt
    media{ id title{english romaji} coverImage{medium color} format episodes duration isAdult } } } } }`;

async function loadPage() {
  if (!more || loading) return;
  loading = true;
  // fresh: MAL-Sync and other apps log new episodes all the time
  const d = await gql(Q, { u: user.id, p: ++pageNo }, { fresh: true });
  more = d.Page.pageInfo.hasNextPage;
  acts.push(...d.Page.activities.filter(a => a?.media && (!a.media.isAdult || prefs.adult())));
  loading = false;
}

async function boot() {
  user = await me();
  if (!user) {
    page.innerHTML = `<section class="fy-hero"><h1>Watch history</h1>
      <p class="hint" style="font-size:1rem;max-width:56ch">Every episode you log on AniList, by day, with a ride calendar. Connect AniList (a username is enough) to see yours.</p>
      <a class="btn" href="pass.html">Connect AniList</a></section>`;
    return;
  }
  const [h] = await Promise.all([
    gql(`query($u:Int){ User(id:$u){ stats{ activityHistory{ date amount } } } }`, { u: user.id }, { fresh: true }),
    loadPage(),
  ]);
  // enough pages to cover this week for the numbers at the top (at most 4 requests)
  while (more && pageNo < 4 && acts.at(-1)?.createdAt > Date.now() / 1000 - WEEK) await loadPage();
  render(h.User.stats.activityHistory || []);
}

function render(history) {
  const now = Date.now() / 1000, today = dayKey(now);
  const week = acts.filter(a => a.createdAt > now - WEEK).map(describe);
  const counts = new Map(history.map(x => [dayKey(x.date, 'UTC'), x.amount]));
  page.innerHTML = `
    <section class="fy-hero">
      <p class="hint" style="margin:0">Journey log</p>
      <h1>Watch history</h1>
      <div class="sync-sum map-sum">
        <div><b>${week.reduce((a, x) => a + x.eps, 0)}</b><span>episodes this week</span></div>
        <div><b>${minutes(week.reduce((a, x) => a + x.minutes, 0))}</b><span>watched this week</span></div>
        <div><b>${streak([...counts.keys()], today)}</b><span>day streak</span></div>
        <div><b>${counts.size}</b><span>active days, last 6 months</span></div>
      </div>
    </section>
    <section>
      <div class="section-head"><h2>Ride calendar</h2><span class="hint" style="margin:0">Each square is a day; brighter means more logged.</span></div>
      ${calendar(counts, today)}
    </section>
    <section>
      <div class="section-head"><h2>Timeline</h2>
        <div class="chips" id="filter">${[['all', 'Everything'], ['watched', 'Episodes'], ['completed', 'Completed'], ['list', 'Plans & drops']].map(([k, l]) =>
          `<label><input type="radio" name="f" value="${k}"${k === filter ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
      </div>
      <div id="log"></div>
      <div class="more"><button class="btn ghost" id="more" ${more ? '' : 'hidden'}>Load older</button></div>
    </section>`;
  $('#filter').addEventListener('change', e => { filter = e.target.value; timeline(); });
  $('#more').onclick = older;
  new IntersectionObserver(([e]) => e.isIntersecting && older(), { rootMargin: '400px' }).observe($('#more'));
  timeline();
}

async function older() {
  if (!more || loading) return;
  $('#more').disabled = true;
  try { await loadPage(); timeline(); } catch (e) { fail($('#log'), e); }
  $('#more').disabled = false;
  $('#more').hidden = !more;
}

// 26 weeks of days, Sunday at the top, like a commuter's punch card
function calendar(counts, today) {
  const end = new Date(today + 'T12:00:00'), start = new Date(end);
  start.setDate(start.getDate() - 7 * 25 - end.getDay());
  const lvl = n => (!n ? 0 : n < 3 ? 1 : n < 6 ? 2 : n < 10 ? 3 : 4);
  const cells = [], months = [];
  for (let d = new Date(start), i = 0; d <= end; d.setDate(d.getDate() + 1), i++) {
    const key = d.toLocaleDateString('en-CA'), n = counts.get(key) || 0;
    if (d.getDate() === 1) months.push(`<span style="grid-column:${Math.floor(i / 7) + 1}">${d.toLocaleDateString(undefined, { month: 'short' })}</span>`);
    cells.push(`<i class="l${lvl(n)}" style="grid-row:${d.getDay() + 1}" title="${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${n ? `${n} update${n === 1 ? '' : 's'}` : 'no rides'}"></i>`);
  }
  return `<div class="heat-wrap"><div class="heat-months">${months.join('')}</div><div class="heat">${cells.join('')}</div>
    <div class="heat-key"><span>Less</span><i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><span>More</span></div></div>`;
}

function timeline() {
  const rows = acts.map(a => ({ a, d: describe(a) })).filter(x => filter === 'all' || x.d.kind === filter);
  const days = new Map();
  for (const r of rows) { const k = dayKey(r.a.createdAt); days.set(k, [...(days.get(k) || []), r]); }
  const today = dayKey(Date.now() / 1000), yesterday = dayKey(Date.now() / 1000 - 86400);
  $('#log').innerHTML = [...days].map(([k, list]) => {
    const eps = list.reduce((a, x) => a + x.d.eps, 0), mins = list.reduce((a, x) => a + x.d.minutes, 0);
    const label = k === today ? 'Today' : k === yesterday ? 'Yesterday'
      : new Date(k + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: k.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric' });
    return `<div class="log-day">
      <h3>${label}${eps ? `<span>${eps} episode${eps === 1 ? '' : 's'} · ${minutes(mins)}</span>` : ''}</h3>
      <ol>${list.map(({ a, d }) => `
        <li class="log-row k-${d.kind}${nsfw(a.media)}" style="--c:${tint(a.media, 'var(--platform)')}">
          <time>${new Date(a.createdAt * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</time>
          <a href="anime.html?id=${a.media.id}" class="log-cover"><img src="${cover(a.media, 'medium')}" alt="" loading="lazy"></a>
          <p>${d.verb} <a href="anime.html?id=${a.media.id}"><b>${esc(title(a.media))}</b></a>${d.minutes ? `<small>${minutes(d.minutes)}</small>` : ''}</p>
        </li>`).join('')}</ol></div>`;
  }).join('') || `<p class="empty">${acts.length ? 'Nothing of this kind in what has loaded so far.' : 'No activity on AniList yet. Log an episode and it shows up here.'}</p>`;
}

boot().catch(e => fail(page, e));
