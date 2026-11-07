import { gql, me, title, prefs } from './api.js';
import { header, $, esc, fail, qs } from './ui.js';
import { franchises, districts, lineSvg, marker, ride, rewind, firstYear, STATE, PALETTE } from './map.js';

header();
const page = $('#page');
let lines = [], filter = 'all';
// train service, the same toggle as the line page, kept in the address so a reload or shared link keeps it
const SERVICES = { express: 'Express', rapid: 'Rapid', local: 'Local' };
const NOTE = { express: 'Express: only the main story.', rapid: 'Rapid: the main story plus the extras most fans watch.', local: 'Local: every stop, extras most people skip included.' };
let svc = SERVICES[qs().get('stops')] ? qs().get('stops') : 'rapid';
// Map Rewind: null = now, else the year the map is rewound to
const NOW = new Date().getFullYear();
let year = null, playing = null;

async function boot() {
  const user = await me();
  if (!user) {
    page.innerHTML = `<section class="fy-hero"><h1>Your metro map</h1>
      <p class="hint" style="font-size:1rem;max-width:56ch">Every franchise you've watched, drawn as a metro line. Connect AniList (a username is enough) to draw yours.</p>
      <a class="btn" href="pass.html">Connect AniList</a></section>`;
    return;
  }
  const d = await gql(`query($u:Int){ MediaListCollection(userId:$u,type:ANIME){ lists{ entries{ status progress updatedAt completedAt{year month day} startedAt{year month day} media{
    id title{english romaji} format status episodes duration popularity isAdult startDate{year month day} studios(isMain:true){ nodes{ name isAnimationStudio } }
    relations{ edges{ relationType(version:2) node{ id type format status duration popularity isAdult title{english romaji} startDate{year month day} } } } } } } } }`, { u: user.id });
  // 18+ titles (and 18+ neighbouring stops) stay off the map unless 18+ is on
  const keep = m => !m.isAdult || prefs.adult();
  const entries = [...new Map(d.MediaListCollection.lists.flatMap(l => l.entries).map(e => [e.media.id, e])).values()]
    .filter(e => keep(e.media))
    .map(e => ({ ...e, media: { ...e.media, relations: { edges: (e.media.relations?.edges || []).filter(x => keep(x.node)) } } }));
  lines = franchises(entries);
  lines.forEach((l, i) => (l.color = PALETTE[i % PALETTE.length]));
  render(user);
  addEventListener('resize', debounce(() => draw(), 200));
}

function render(user) {
  page.innerHTML = `
    <section class="fy-hero map-hero">
      <p class="hint" style="margin:0">${esc(user.name)}'s</p>
      <h1>Metro map</h1>
      <div class="sync-sum map-sum" id="sum"></div>
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
