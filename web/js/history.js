import { gql, me, title, prefs } from './api.js';
import { header, $, esc, minutes, fail, toast, nsfw, cover, tint, safeColor, safeUrl } from './ui.js';
import { describe, dayKey, streak } from './journal.js';
import { review, yearBounds, yearLoader } from './year.js';
import { franchises, PALETTE } from './map.js';

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
  try {
    // fresh: MAL-Sync and other apps log new episodes all the time
    const d = await gql(Q, { u: user.id, p: pageNo + 1 }, { fresh: true });
    // only count the page once it has arrived, so a failed request is retried rather than skipped
    pageNo++;
    more = d.Page.pageInfo.hasNextPage;
    acts.push(...d.Page.activities.filter(a => a?.media && (!a.media.isAdult || prefs.adult())));
  } finally {
    loading = false;
  }
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
      <p class="album-link"><a class="btn ghost" href="tickets.html">Your ticket stubs</a><span class="hint">every show you've completed, by year</span></p>
    </section>
    <section>
      <div class="section-head"><h2>Ride calendar</h2><span class="hint" style="margin:0">Each square is a day; the stronger the color, the more you logged.</span></div>
      ${calendar(counts, today)}
    </section>
    <section class="yr" aria-labelledby="yr-h">
      <div class="section-head"><h2 id="yr-h">Year on the rails</h2><div class="chips" id="yr-years" role="radiogroup" aria-label="Year"></div></div>
      <div id="yr-body" aria-live="polite"></div>
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
  $('#yr-years').addEventListener('change', e => pickYear(+e.target.value));
  yearChips();
  yearBody();
  new IntersectionObserver(([e]) => e.isIntersecting && older(), { rootMargin: '400px' }).observe($('#more'));
  timeline();
}

async function older() {
  if (!more || loading) return;
  const btn = $('#more');
  btn.disabled = true;
  try {
    await loadPage();
    timeline();
  } catch (e) {
    // keep what is already on screen; the button stays so the rider can try again
    toast(`Older rides didn't load. ${e.message || e}`);
  } finally {
    btn.disabled = false;
    btn.hidden = !more;
  }
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

// ---- Year on the rails ----------------------------------------------------------
// A year in review from the year's whole activity feed, so the numbers are exact. Loaded only when the rider asks
// (a busy year is dozens of requests), kept in memory for this page only, a year at a time (year.js yearLoader).
const THIS_YEAR = new Date().getFullYear();
const FIRST_YEAR = 2013; // the year picker looks for activity back to here
const YQ = `query($u:Int,$p:Int,$a:Int,$b:Int){ Page(page:$p,perPage:50){ pageInfo{ hasNextPage }
  activities(userId:$u,type:ANIME_LIST,sort:ID_DESC,createdAt_greater:$a,createdAt_lesser:$b){ ... on ListActivity{ id status progress createdAt
    media{ id title{english romaji} coverImage{medium color} format episodes duration isAdult } } } } }`;
// the rider's list exactly as My map asks for it (same text, so My map's cached answer can serve here too)
const LIST_Q = `query($u:Int){ MediaListCollection(userId:$u,type:ANIME){ lists{ entries{ status progress updatedAt completedAt{year month day} startedAt{year month day} media{
    id title{english romaji} format status episodes duration popularity isAdult startDate{year month day} studios(isMain:true){ nodes{ name isAnimationStudio } }
    relations{ edges{ relationType(version:2) node{ id type format status duration popularity isAdult title{english romaji} startDate{year month day} } } } } } } } }`;
let pick = THIS_YEAR, years = [THIS_YEAR, THIS_YEAR - 1], started = false, extras = null, pause = null;
const loader = yearLoader(async (y, p) => {
  const { from, to } = yearBounds(y);
  // fresh and not remembered: the year lives in this page's memory only, not in the tab's query cache
  const d = await gql(YQ, { u: user.id, p, a: from - 1, b: to }, { fresh: true, remember: false });
  pause = null;
  return { acts: d.Page.activities.filter(a => a?.media && (!a.media.isAdult || prefs.adult())), more: d.Page.pageInfo.hasNextPage };
}, y => y === pick && yearBody());
// gql() waits out AniList's rate limit on its own; say so where the progress is, not just in the toast
addEventListener('ratelimit', e => {
  pause = Date.now() + e.detail * 1000;
  if (loader.get(pick)?.more && $('#yr-note')) $('#yr-note').textContent = pauseNote();
});
const pauseNote = () => `Pausing ${Math.max(1, Math.ceil((pause - Date.now()) / 1000))}s to stay under AniList's rate limit…`;

const shortDay = key => new Date(key + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const monthName = (i, style = 'short') => new Date(2000, i, 1).toLocaleDateString(undefined, { month: style });
const plural = (n, one, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function yearChips() {
  const el = $('#yr-years');
  if (el) el.innerHTML = years.map(y => `<label><input type="radio" name="yr" value="${y}"${y === pick ? ' checked' : ''}><span>${y}</span></label>`).join('');
}

function pickYear(y) {
  pick = y;
  if (started) loadYear(); else yearBody();
}

// Lines and studios come from the rider's list (My map's question, one request); the years with activity from one
// small request that asks each earlier year for a single activity. Both only once, with the first year loaded.
function loadYear() {
  if (!started) {
    started = true;
    extras = listData();
    activeYears();
  }
  const y = pick;
  // a failed page leaves the year's error on its state; the view shows it with a Try again button
  loader.load(y).then(() => y === pick && yearBody(), () => y === pick && yearBody());
  yearBody();
}

async function listData() {
  try {
    const d = await gql(LIST_Q, { u: user.id }, { remember: false });
    // 18+ titles (and 18+ neighbouring stops) stay out unless 18+ is on, as on My map
    const keep = m => !m.isAdult || prefs.adult();
    const entries = [...new Map(d.MediaListCollection.lists.flatMap(l => l.entries).map(e => [e.media.id, e])).values()]
      .filter(e => keep(e.media))
      .map(e => ({ ...e, media: { ...e.media, relations: { edges: (e.media.relations?.edges || []).filter(x => keep(x.node)) } } }));
    const lines = franchises(entries);
    lines.forEach((l, i) => (l.color = PALETTE[i % PALETTE.length])); // the colors My map gives them
    return { lines, entries };
  } catch (e) {
    return { lines: [], entries: [], error: e };
  }
}

async function activeYears() {
  const span = [];
  for (let y = FIRST_YEAR; y < THIS_YEAR - 1; y++) span.push(y);
  if (!span.length) return;
  const parts = span.map(y => {
    const { from, to } = yearBounds(y);
    return `y${y}: Page(perPage:1){ activities(userId:$u,type:ANIME_LIST,createdAt_greater:${from - 1},createdAt_lesser:${to}){ ... on ListActivity{ id } } }`;
  });
  try {
    const d = await gql(`query($u:Int){ ${parts.join(' ')} }`, { u: user.id }, { fresh: true, remember: false });
    years = [...new Set([...years, ...span.filter(y => d[`y${y}`]?.activities?.length)])].sort((a, b) => b - a);
    yearChips();
  } catch {} // the picker keeps this year and last year
}

function yearBody() {
  const el = $('#yr-body');
  if (!el) return;
  const s = loader.get(pick), y = pick, now = y === THIS_YEAR;
  if (!s) {
    el.innerHTML = `<div class="yr-intro">
      <p>${now ? 'Your year so far' : `Your ${y}`}, ride by ride: distance ridden, your busiest line, your longest streak, the studio districts you opened and every show you finished. Then share it as a poster.</p>
      <button class="btn" type="button" id="yr-go">Count my ${y}</button>
      <p class="hint">It reads every update you logged ${now ? 'this year' : `in ${y}`}, 50 at a time. AniList allows about 30 requests a minute, so a busy year takes a minute or two.</p>
    </div>`;
    $('#yr-go').onclick = loadYear;
    return;
  }
  if (s.error || s.more) {
    el.innerHTML = progress(y, s);
    if (s.error) $('#yr-retry').onclick = loadYear;
    return;
  }
  el.innerHTML = progress(y, s, 'Matching your shows to their lines…');
  extras.then(x => {
    if (pick !== y || loader.get(y) !== s) return;
    const r = review(s.acts, y, x);
    el.innerHTML = summary(r, x);
    $('#yr-share')?.addEventListener('click', () => sharePoster(r));
  });
}

// How far back into the year the pages have reached, as the train's distance along the bar.
function progress(y, s, done) {
  const { from, to } = yearBounds(y), end = Math.min(to, Date.now() / 1000);
  const oldest = s.acts.at(-1)?.createdAt;
  const pct = done ? 100 : oldest ? Math.max(3, Math.min(97, ((end - oldest) / (end - from)) * 100)) : 3;
  const note = s.error ? `That page didn't load. ${esc(s.error.message || s.error)}`
    : done || (pause > Date.now() ? pauseNote() : s.acts.length ? `Back to ${shortDay(dayKey(oldest))}` : `Boarding ${y}…`);
  return `<div class="yr-load">
    <div class="yr-track" role="progressbar" aria-label="Reading ${y}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><i style="width:${pct}%"></i></div>
    <p><b>${plural(s.pages, 'page')}</b> · <b>${plural(s.acts.length, 'log')}</b> so far <span class="hint" id="yr-note">${note}</span></p>
    ${s.error ? '<button class="btn ghost" type="button" id="yr-retry">Try again</button>' : ''}
  </div>`;
}

function summary(r, x) {
  const y = r.year, now = y === THIS_YEAR;
  if (!r.days) {
    return `<div class="yr-empty"><p>No episodes logged on AniList ${now ? 'yet this year' : `in ${y}`}.${r.logs ? ` Just ${plural(r.logs, 'list update')} (plans, drops and the like).` : ''}</p>
      ${years.length > 1 ? '<p class="hint">Pick another year above.</p>' : ''}</div>`;
  }
  const b = r.busiest, top = r.lines.slice(0, 5), most = top[0]?.eps || 1;
  const color = l => safeColor(l.color, 'var(--platform)');
  const st = r.streak;
  const maxMonth = Math.max(1, ...r.months.map(m => m.eps));
  const covers = r.completed.slice(0, 36);
  // b is null in a year with completions but no episodes logged
  return `<article class="yr-card" style="--c:${b ? color(b) : 'var(--platform)'}">
    <header class="yr-top">
      <div>
        <p class="yr-kicker"><span lang="ja">年間乗車記録</span> · ${now ? `${shortDay(`${y}-01-01`)} – ${shortDay(dayKey(Date.now() / 1000))}` : 'the whole year'}</p>
        <h3 class="yr-title">${y} <span>on the rails</span></h3>
      </div>
      <button class="btn" type="button" id="yr-share">Share poster</button>
    </header>
    <div class="sync-sum yr-sum">
      <div><b>${r.eps.toLocaleString()}</b><span>episodes ridden</span></div>
      <div><b>${minutes(r.minutes)}</b><span>on board</span></div>
      <div><b>${plural(st.days, 'day')}</b><span>longest streak</span><small>${st.days > 1 ? `${shortDay(st.from)} – ${shortDay(st.to)}` : shortDay(st.from)}</small></div>
      <div><b>${r.days}</b><span>days you rode</span></div>
      <div><b>${r.completed.length}</b><span>shows completed</span></div>
      <div><b>${x.error ? '–' : r.districts.length}</b><span>new districts</span></div>
    </div>
    ${r.bulk ? `<p class="hint yr-bulk">${plural(r.bulk.shows, 'show was', 'shows were')} marked completed in one go on ${shortDay(r.bulk.day)}, most likely an import or a sync. They count, as AniList logged them.</p>` : ''}
    <div class="yr-grid">
      <section class="yr-panel">
        <h4>Busiest line</h4>
        ${b ? `<a class="yr-busiest" href="line.html?id=${b.id}"><span class="roundel" aria-hidden="true">${(b.name.match(/[A-Za-z]/)?.[0] || 'A').toUpperCase()}</span><b>${esc(b.name)}</b></a>
        <p class="hint">${plural(b.eps, 'episode')} · ${minutes(b.minutes)}${b.shows > 1 ? ` · ${b.shows} stations` : ''}</p>`
          : `<p class="hint">No episodes logged ${now ? 'yet this year' : `in ${y}`}, only completions, so no line was busiest.</p>`}
        ${top.length > 1 ? `<ol class="yr-lines">${top.map(l => `<li style="--c:${color(l)};--w:${(l.eps / most) * 100}%"><a href="line.html?id=${l.id}">${esc(l.name)}</a><i></i><b>${l.eps}</b></li>`).join('')}</ol>` : ''}
      </section>
      <section class="yr-panel">
        <h4>The year as a line</h4>
        <ol class="yr-months">${r.months.map((m, i) => `<li class="${m.eps ? 'on' : ''}${i === r.busiestMonth ? ' peak' : ''}" title="${monthName(i, 'long')}: ${plural(m.eps, 'episode')}, ${plural(m.days, 'day')}">
          <div class="yr-bar"><b>${m.eps || ''}</b><i style="--h:${(m.eps / maxMonth) * 100}%"></i></div><em></em><span>${monthName(i, 'narrow')}</span></li>`).join('')}</ol>
        ${r.busiestMonth != null ? `<p class="hint">Busiest month: <b>${monthName(r.busiestMonth, 'long')}</b>, ${plural(r.months[r.busiestMonth].eps, 'episode')}</p>` : ''}
      </section>
      <section class="yr-panel">
        <h4>New districts opened</h4>
        ${x.error ? `<p class="hint">Your list didn't load (${esc(x.error.message || x.error)}), so studios and lines can't be told.</p>`
          : r.districts.length ? `<ul class="yr-districts">${r.districts.slice(0, 8).map(d => `<li><b>${esc(d.name)}</b><span>${shortDay(d.day)}, <a href="anime.html?id=${d.media.id}">${esc(title(d.media))}</a></span></li>`).join('')}</ul>
            ${r.districts.length > 8 ? `<p class="hint">and ${r.districts.length - 8} more</p>` : ''}`
          : '<p class="hint">Every studio you rode this year was one you knew already.</p>'}
      </section>
      <section class="yr-panel">
        <h4>Completed</h4>
        ${r.completed.length ? `<div class="yr-covers">${covers.map(c => `<a class="${nsfw(c.media).trim()}" href="anime.html?id=${c.media.id}" title="${esc(title(c.media))}, ${shortDay(c.day)}"><img src="${cover(c.media, 'medium')}" alt="${esc(title(c.media))}" loading="lazy"></a>`).join('')}${r.completed.length > covers.length ? `<span>+${r.completed.length - covers.length}</span>` : ''}</div>
          <p class="hint"><a href="tickets.html">Your ticket stubs</a>, by the finish dates on your list</p>`
          : `<p class="hint">Nothing finished ${now ? 'yet this year' : `in ${y}`}.</p>`}
      </section>
    </div>
    <p class="yr-ends"><span>First ride: <b>${shortDay(r.first.day)}</b>, ${esc(r.first.verb)} <a href="anime.html?id=${r.first.media.id}">${esc(title(r.first.media))}</a></span>
      <span>${now ? 'Latest' : 'Last'} ride: <b>${shortDay(r.last.day)}</b>, ${esc(r.last.verb)} <a href="anime.html?id=${r.last.media.id}">${esc(title(r.last.media))}</a></span></p>
  </article>`;
}

async function sharePoster(r) {
  const { yearCard, showCard } = await import('./share.js'); // only when asked: the drawing code isn't needed otherwise
  const now = r.year === THIS_YEAR, b = r.busiest;
  // covers only where the page would show them unblurred
  const pics = r.completed.filter(c => !(c.media.isAdult && prefs.blur())).map(c => safeUrl(c.media.coverImage?.medium) ? c.media.coverImage.medium : null).filter(Boolean);
  showCard(() => yearCard({
    year: r.year, rider: user.name, avatar: safeUrl(user.avatar?.large) ? user.avatar.large : null,
    span: now ? `${shortDay(`${r.year}-01-01`)} – ${shortDay(dayKey(Date.now() / 1000))}` : 'The whole year',
    eps: r.eps, time: minutes(r.minutes), days: r.days,
    streak: { days: r.streak.days, text: r.streak.days > 1 ? `${shortDay(r.streak.from)} – ${shortDay(r.streak.to)}` : shortDay(r.streak.from) },
    busiest: b && { name: b.name, color: safeColor(b.color, '#ffd23f'), eps: b.eps, time: minutes(b.minutes) },
    months: r.months.map(m => m.eps), busiestMonth: r.busiestMonth, monthNames: r.months.map((_, i) => monthName(i)),
    completed: r.completed.length, covers: pics.slice(0, 12),
    districts: r.districts.map(d => d.name),
  }), `${user.name}-${r.year}-on-the-rails.png`);
}

boot().catch(e => fail(page, e));
