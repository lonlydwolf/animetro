import { gql, me, title, prefs } from './api.js';
import { header, $, esc, fail, qs, safeUrl } from './ui.js';
import { franchises, districts, lineSvg, marker, ride, rewind, firstYear, STATE, PALETTE } from './map.js';
import { clean } from './carriage.js';

header();
const page = $('#page');
let lines = [], mine = [], filter = 'all';
// train service, the same toggle as the line page, kept in the address so a reload or shared link keeps it
const SERVICES = { express: 'Express', rapid: 'Rapid', local: 'Local' };
const NOTE = { express: 'Express: only the main story.', rapid: 'Rapid: the main story plus the extras most fans watch.', local: 'Local: every stop, extras most people skip included.' };
let svc = SERVICES[qs().get('stops')] ? qs().get('stops') : 'rapid';
// Map Rewind: null = now, else the year the map is rewound to
const NOW = new Date().getFullYear();
let year = null, playing = null;
// Shared carriage: a friend's map over yours. The friend lives only in the address (?with=name), never in storage.
// friend: null, or { name, state: 'loading' | 'error' | 'ready', msg, retry, user, entries, format }
let rider = null, friend = null, seq = 0;
// The same question for you and your friend: the whole list with each show's franchise neighbours, scores on
// AniList's 100-point scale whatever format the rider uses, and that format.
const LIST = `query($u:Int){ User(id:$u){ mediaListOptions{ scoreFormat } } MediaListCollection(userId:$u,type:ANIME){ lists{ entries{ status progress score(format:POINT_100) updatedAt completedAt{year month day} startedAt{year month day} media{
    id title{english romaji} format status episodes duration popularity averageScore isAdult startDate{year month day} studios(isMain:true){ nodes{ name isAnimationStudio } }
    relations{ edges{ relationType(version:2) node{ id type format status duration popularity isAdult title{english romaji} startDate{year month day} } } } } } } } }`;

async function boot() {
  const user = await me();
  if (!user) {
    page.innerHTML = `<section class="fy-hero"><h1>Your metro map</h1>
      <p class="hint" style="font-size:1rem;max-width:56ch">Every franchise you've watched, drawn as a metro line. Connect AniList (a username is enough) to draw yours.</p>
      <a class="btn" href="pass.html">Connect AniList</a></section>`;
    return;
  }
  const d = await gql(LIST, { u: user.id });
  if (!d.MediaListCollection) throw new Error("AniList didn't send your list. Try again.");
  // 18+ titles (and 18+ neighbouring stops) stay off the map unless 18+ is on
  mine = clean(d.MediaListCollection.lists.flatMap(l => l.entries), prefs.adult());
  rider = user;
  lines = franchises(mine);
  lines.forEach((l, i) => (l.color = PALETTE[i % PALETTE.length]));
  render(user);
  addEventListener('resize', debounce(() => draw(), 200));
  if (qs().get('with')) board(qs().get('with'));
}

// ---- shared carriage: loading a friend ----------------------------------
// A name as typed, or pasted from a profile address (anilist.co/user/Name/).
const nameOf = s => (s.trim().match(/anilist\.co\/user\/([^/?#\s]+)/i)?.[1] || s.trim().replace(/^@/, ''));
// keep ?with= (and ?stops=) in the address, so a reload or a shared link rides with the same friend
function address(name) {
  const p = qs();
  if (name) p.set('with', name); else p.delete('with');
  history.replaceState(null, '', String(p) ? `?${p}` : location.pathname);
}

async function board(typed) {
  const name = nameOf(typed), my = ++seq;
  const failed = (msg, keep = false) => { if (my !== seq) return; friend = { name, state: 'error', msg, retry: keep }; if (!keep) address(null); carriage(); };
  if (!/^[\w-]{1,40}$/.test(name)) return failed(`"${name}" can't be an AniList username: those are letters and numbers only.`);
  friend = { name, state: 'loading' };
  address(name);
  carriage();
  let user;
  try {
    user = (await gql(`query($n:String){ User(name:$n){ id name avatar{large} } }`, { n: name }, { remember: false })).User;
  } catch (e) {
    return e.status === 404 ? failed(`No AniList user called "${name}". Check the spelling.`) : failed(`Couldn't look up ${name}: ${e.message}`, true);
  }
  if (!user) return failed(`No AniList user called "${name}". Check the spelling.`);
  if (user.id === rider.id) return failed("That's you! Enter a friend's username to ride together.");
  let d;
  try {
    d = await gql(LIST, { u: user.id }, { remember: false }); // nothing of theirs is kept, not even in this tab's cache
  } catch (e) {
    return /private/i.test(e.message) || e.status === 404 || e.status === 403 ? failed(`${user.name}'s list is private, so there's nothing to ride along with.`)
      : failed(`Couldn't load ${user.name}'s map: ${e.message}`, true);
  }
  // AniList answers a private list with an error next to the user, rather than failing the whole request
  if (!d.MediaListCollection) return failed(`${user.name}'s list is private, so there's nothing to ride along with.`);
  if (my !== seq) return;
  friend = { name: user.name, state: 'ready', user, format: d.User?.mediaListOptions?.scoreFormat, entries: clean(d.MediaListCollection.lists.flatMap(l => l.entries), prefs.adult()) };
  address(user.name);
  carriage();
}

function leave() {
  ++seq;
  friend = null;
  address(null);
  carriage();
  $('#with')?.focus();
}

// The "Ride with a friend" box, and once a friend is aboard, who it is.
function carriage() {
  const el = $('#carriage');
  if (!el) return;
  const avatar = u => `<span class="car-face"${safeUrl(u?.avatar?.large) ? ` style="background-image:url('${safeUrl(u.avatar.large)}')"` : ''}></span>`;
  if (friend?.state === 'ready' || friend?.state === 'loading') {
    el.innerHTML = `<div class="carriage-card${friend.state === 'loading' ? ' loading-car' : ''}">
      <div class="coupled" aria-hidden="true">${avatar(rider)}<i></i>${avatar(friend.user)}</div>
      <p class="carriage-who"><b>${esc(rider.name)}</b> <span>×</span> <b>${esc(friend.name)}</b></p>
      <button class="btn ghost carriage-leave" type="button">Ride alone</button>
      <div class="carriage-body">${friend.state === 'loading' ? `<p class="hint" role="status">Fetching ${esc(friend.name)}'s map…</p>`
        : `<p class="hint" role="status">${friend.entries.length.toLocaleString()} shows on ${esc(friend.name)}'s list.</p>`}</div>
    </div>`;
    $('.carriage-leave', el).onclick = leave;
    return;
  }
  el.innerHTML = `<form class="carriage-form">
      <label for="with">Ride with a friend</label>
      <div class="inline-form"><input id="with" name="with" placeholder="Their AniList username" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(friend?.name || '')}" required>
        <button class="btn ghost">Ride together</button></div>
      ${friend?.state === 'error' ? `<p class="carriage-error" role="alert">${esc(friend.msg)}${friend.retry ? ' <button class="linkish" type="button" data-retry>Try again</button>' : ''}</p>`
        : '<p class="hint">See the lines you share, how well your tastes match, and what you could watch together.</p>'}
    </form>`;
  $('form', el).onsubmit = e => { e.preventDefault(); board(e.target.with.value); };
  $('[data-retry]', el)?.addEventListener('click', () => board(friend.name));
}

function render(user) {
  page.innerHTML = `
    <section class="fy-hero map-hero">
      <p class="hint" style="margin:0">${esc(user.name)}'s</p>
      <h1>Metro map</h1>
      <div class="sync-sum map-sum" id="sum"></div>
      <div class="carriage" id="carriage"></div>
      <div class="map-svc">
        <div class="seg" role="group" aria-label="Stops">${Object.entries(SERVICES).map(([k, l]) => `<button data-svc="${k}">${l}</button>`).join('')}</div>
        <p class="hint" id="svc-note"></p>
      </div>
      ${firstYear(lines) && firstYear(lines) < NOW ? `<div class="rewind">
        <button class="rw-play" id="rw-play" type="button" aria-label="Play your map through the years">▶</button>
        <label for="rw">Rewind</label>
        <input type="range" id="rw" min="${firstYear(lines)}" max="${NOW}" step="1" value="${NOW}" aria-valuetext="Now">
        <b id="rw-year" aria-live="polite">Now</b>
      </div>
      <p class="hint" id="rw-note"></p>` : ''}
      <div class="map-tools">
        <div class="chips" role="radiogroup" aria-label="Show">${[['all', 'All lines'], ['open', 'Unfinished'], ['complete', 'End to end']].map(([k, l]) =>
          `<label><input type="radio" name="f" value="${k}"${k === filter ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
        <div class="legend">${['done', 'here', 'planned', 'unridden', 'dropped', 'soon'].map(s => `<span><svg viewBox="0 0 24 24" width="18" height="18">${marker(s, 12, 12, '#00a7db')}</svg>${STATE[s]}</span>`).join('')}</div>
      </div>
    </section>
    <div id="map"></div>`;
  page.querySelector('.map-tools .chips').addEventListener('change', e => { filter = e.target.value; draw(); });
  $('#rw')?.addEventListener('input', e => { stop(); setYear(+e.target.value); });
  $('#rw-play')?.addEventListener('click', () => (playing ? stop() : play()));
  page.querySelector('.map-svc .seg').addEventListener('click', e => {
    const b = e.target.closest('[data-svc]');
    if (!b) return;
    svc = b.dataset.svc;
    const p = qs(); p.set('stops', svc); history.replaceState(null, '', `?${p}`);
    draw();
  });
  carriage();
  draw();
}

const keep = l => filter === 'all' || (filter === 'complete' ? l.complete : !l.complete);

function setYear(y) {
  year = y >= NOW ? null : y;
  const rw = $('#rw');
  rw.value = y;
  rw.setAttribute('aria-valuetext', year ? String(year) : 'Now');
  $('#rw-year').textContent = year || 'Now';
  draw();
}
// ▶ plays from the first year to now, a year a second
function play() {
  const rw = $('#rw');
  let y = year && year < NOW ? year : +rw.min;
  $('#rw-play').textContent = '❚❚';
  $('#rw-play').setAttribute('aria-label', 'Pause');
  setYear(y);
  playing = setInterval(() => { y++; setYear(y); if (y >= NOW) stop(); }, 1000);
}
function stop() {
  clearInterval(playing);
  playing = null;
  $('#rw-play') && ($('#rw-play').textContent = '▶', $('#rw-play').setAttribute('aria-label', 'Play your map through the years'));
}

function draw() {
  const el = $('#map');
  if (!el) return;
  const past = year ? rewind(lines, year) : null;
  const shown = (past ? past.lines : lines).map(l => ride(l, svc));
  if ($('#rw-note')) $('#rw-note').textContent = !past ? 'Slide back to watch your network grow, from your list\'s start and finish dates.'
    : `Your map at the end of ${year}.${past.approx ? ` ${past.approx} stop${past.approx === 1 ? ' has' : 's have'} no finish date on AniList, so ${past.approx === 1 ? 'its' : 'their'} start date (or the last time you changed the entry) stands in.` : ''}${past.siding ? ` ${past.siding} finished stop${past.siding === 1 ? '' : 's'} with no date at all wait${past.siding === 1 ? 's' : ''} in the siding until Now.` : ''}`;
  const full = shown.filter(l => l.total > 1);
  const stations = shown.reduce((a, l) => a + l.total, 0), ridden = shown.reduce((a, l) => a + l.done, 0);
  $('#sum').innerHTML = `
    <div><b>${full.length}</b><span>lines</span></div>
    <div><b>${ridden.toLocaleString()} / ${stations.toLocaleString()}</b><span>stations ridden</span></div>
    <div><b>${full.filter(l => l.complete).length}</b><span>lines ridden end to end</span></div>
    <div><b>${full.filter(l => l.riding).length}</b><span>lines you're on now</span></div>`;
  document.querySelectorAll('[data-svc]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.svc === svc)));
  $('#svc-note').textContent = NOTE[svc];
  const width = Math.min(el.clientWidth || 1100, 1140) - 2;
  const multi = shown.filter(l => l.total > 1 && keep(l)), single = shown.filter(l => l.total === 1 && keep(l));
  el.innerHTML = districts(multi).map(dist => `
    <section class="district">
      <div class="district-head"><span class="district-name">${dist.name ? esc(dist.name) : 'Other lines'}</span><span class="hint" style="margin:0">${dist.lines.length} line${dist.lines.length === 1 ? '' : 's'}${dist.name ? ', transfer between them here' : ''}</span></div>
      <div class="district-lines${dist.name ? ' transfer' : ''}">${dist.lines.map(l => lineSvg(l, width - 28, svc)).join('')}</div>
    </section>`).join('')
    + (single.length ? `<section class="district"><div class="district-head"><span class="district-name">One-stop lines</span><span class="hint" style="margin:0">Single-station lines</span></div>
      <div class="locals">${single.map(l => { const s = l.stations[0]; return `<a class="local" href="anime.html?id=${s.id}" style="--c:${l.color}" title="${esc(title(s))}: ${STATE[s.state]}"><svg viewBox="0 0 24 24" width="20" height="20">${marker(s.state, 12, 12, l.color)}</svg><span>${esc(title(s))}</span></a>`; }).join('')}</div></section>` : '')
    || '<p class="empty">No lines match this filter.</p>';
}

function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }

boot().catch(e => fail(page, e));
