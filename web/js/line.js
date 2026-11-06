import { gql, title, listStatus, me, saveEntries, rankSearch, prefs, adultArg, inApp } from './api.js';
import { header, $, esc, qs, FORMAT, STATUS, minutes, toast, countdown, fail, nsfw } from './ui.js';
import { crawl, classify, storyOrder, byDate, ROLE, service } from './order.js';
import { lineCard, showCard } from './share.js';

header();

const FIELDS = `id title{english romaji} format status episodes duration season seasonYear startDate{year month day}
  averageScore popularity isAdult tags{name} coverImage{large color} bannerImage nextAiringEpisode{episode timeUntilAiring}
  relations{edges{relationType(version:2) node{id type}}}`;

// stops: express | rapid | local (old links said "all", which is local)
const SERVICES = ['express', 'rapid', 'local'];
const view = { order: qs().get('order') || 'release', service: SERVICES.includes(qs().get('stops')) ? qs().get('stops') : qs().get('stops') === 'all' ? 'local' : 'rapid', perDay: 3 };
let data; // { stops, transfers, anchor, list, user, capped }
let shown; // what render() last drew, for the share card

// ---- numbers -------------------------------------------------------------
const epCount = m => m.status === 'NOT_YET_RELEASED' ? 0 : m.episodes || (m.nextAiringEpisode ? m.nextAiringEpisode.episode - 1 : m.format === 'MOVIE' ? 1 : 0);
const epLength = m => m.duration || (m.format === 'MOVIE' ? 100 : 24);
const seen = (m, list) => {
  const e = list.get(m.id);
  if (!e) return 0;
  return e.status === 'COMPLETED' || e.status === 'REPEATING' ? epCount(m) : Math.min(e.progress || 0, epCount(m));
};

// ---- render --------------------------------------------------------------
function render() {
  const { anchor, list, user } = data;
  let stops = view.order === 'story' ? storyOrder(data.stops) : [...data.stops].sort(byDate);
  const every = stops.length;
  if (view.service !== 'local') stops = stops.filter(m => m.svc.level === 'express' || (view.service === 'rapid' && m.svc.level === 'rapid'));
  const letter = (title(anchor).match(/[A-Za-z]/)?.[0] || 'A').toUpperCase();
  const counted = stops.filter(m => m.role !== 'recap');
  const totalEps = counted.reduce((s, m) => s + epCount(m), 0);
  const leftEps = counted.reduce((s, m) => s + epCount(m) - seen(m, list), 0);
  const leftMin = counted.reduce((s, m) => s + (epCount(m) - seen(m, list)) * epLength(m), 0);
  const totalMin = counted.reduce((s, m) => s + epCount(m) * epLength(m), 0);
  const hereIdx = list.size ? stops.findIndex(m => m.role !== 'recap' && m.status !== 'NOT_YET_RELEASED' && seen(m, list) < epCount(m)) : -1;
  const visited = totalMin - leftMin;
  shown = { stops, hereIdx, totalEps, totalMin, pct: list.size && totalMin ? Math.round((visited / totalMin) * 100) : null };

  $('#stops').innerHTML = stops.map((m, i) => {
    const e = list.get(m.id);
    const done = e && seen(m, list) >= epCount(m) && epCount(m) > 0;
    const air = m.status === 'RELEASING' && m.nextAiringEpisode
      ? `<span class="tag live">Ep ${m.nextAiringEpisode.episode} in ${countdown(m.nextAiringEpisode.timeUntilAiring)}</span>` : '';
    const soon = m.status === 'NOT_YET_RELEASED' ? `<span class="tag soon">Under construction${m.startDate.year ? `, opens ${m.startDate.year}` : ''}</span>` : '';
    const eps = epCount(m);
    const meta = [FORMAT[m.format], m.season ? `${m.season[0] + m.season.slice(1).toLowerCase()} ${m.seasonYear}` : m.startDate.year,
      eps && m.format !== 'MOVIE' ? `${eps} × ${epLength(m)}m` : m.format === 'MOVIE' && m.duration ? `${m.duration} min` : ''].filter(Boolean);
    return `
      <li class="stop role-${m.role}${done ? ' done' : ''}${i === hereIdx ? ' here' : ''}" style="--c:${m.coverImage.color || 'var(--line)'}">
        <span class="code" aria-hidden="true"><small>${letter}</small>${String(i + 1).padStart(2, '0')}</span>
        <span class="node" aria-hidden="true"></span>
        ${i === hereIdx ? '<span class="you">You are here</span>' : ''}
        <div class="stop-body">
          <a href="anime.html?id=${m.id}" class="stop-link${nsfw(m)}">
            <img src="${m.coverImage.large}" alt="" loading="lazy">
            <span>
              <b>${esc(title(m))}</b>
              ${m.title.english && m.title.english !== m.title.romaji ? `<small class="romaji">${esc(m.title.romaji)}</small>` : ''}
              <span class="meta">${meta.map(esc).join('<i></i>')}</span>
            </span>
          </a>
          <div class="tags">
            ${m.role !== 'main' || m.svc.level === 'local' ? `<span class="tag role${m.svc.level === 'local' ? ' skip' : ''}" title="${m.svc.level === 'local' ? 'Most people skip this stop' : 'An extra most fans watch'}">${
              m.role === 'recap' ? ROLE.recap : m.role === 'main' ? esc(m.svc.why[0].toUpperCase() + m.svc.why.slice(1)) : `${ROLE[m.role]} · ${esc(m.svc.why)}`}</span>` : ''}
            ${air}${soon}
            ${m.averageScore ? `<span class="tag">${m.averageScore}%</span>` : ''}
            ${e ? `<span class="tag s-${e.status}">${STATUS[e.status]}${e.status === 'CURRENT' ? ` ${e.progress}/${eps || '?'}` : ''}</span>`
              : user?.canWrite ? `<button class="tag add" data-plan="${m.id}">+ Planning</button>` : ''}
          </div>
        </div>
      </li>`;
  }).join('') || '<li class="empty">No stops match. Switch to All stops.</li>';

  const years = stops.map(m => m.startDate.year).filter(Boolean);
  const first = Math.min(...years), last = Math.max(...years);
  $('#summary').innerHTML = `
    <div class="stat"><b>${stops.length}</b><span>stops</span></div>
    <div class="stat"><b>${totalEps}</b><span>episodes</span></div>
    <div class="stat"><b>${minutes(totalMin)}</b><span>ride time</span></div>`;
  $('#years').textContent = `Watch order${years.length ? `, ${first}${last && last !== first ? ` to ${last}` : ''}` : ''}`;

  const days = Math.ceil(leftEps / view.perDay);
  const arrive = new Date(Date.now() + days * 864e5).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  $('#arrive').innerHTML = leftEps
    ? `${list.size ? `${leftEps} episodes left. ` : ''}At ${view.perDay} a day you arrive on <b>${arrive}</b>, ${days} day${days === 1 ? '' : 's'} from now.`
    : list.size ? 'You have ridden the whole line. Nice.' : '';
  $('#perday-val').textContent = view.perDay;

  $('#progress').hidden = !list.size;
  if (list.size) {
    const pct = totalMin ? Math.round((visited / totalMin) * 100) : 0;
    $('#progress').innerHTML = `
      <div class="bar"><i style="width:${pct}%"></i></div>
      <p>${esc(user.name)}: ${pct}% of the line ridden (${minutes(visited)}).</p>`;
  }
  const missing = stops.filter(m => m.role !== 'recap' && !list.get(m.id));
  $('#plan-all').hidden = !user?.canWrite || !missing.length;
  $('#plan-all').textContent = `Add ${missing.length} unwatched to Planning`;
  $('#plan-all').onclick = () => plan(missing.map(m => m.id));

  $('#transfers').hidden = !data.transfers.length;
  $('#transfer-list').innerHTML = [...data.transfers].sort(byDate).map(m => `
    <li><a href="line.html?id=${m.id}"><img src="${m.coverImage.large}" alt="" loading="lazy">
      <span><b>${esc(title(m))}</b><small>${m.role}, ${FORMAT[m.format] || ''} ${m.startDate.year || ''}</small></span></a></li>`).join('');

  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === (b.dataset.view === 'order' ? view.order : view.service))));
  const hidden = every - stops.length;
  $('#svc-note').innerHTML = { express: 'Express: only the main story, the TV seasons and movies that continue it.', rapid: 'Rapid: the main story plus the extras most fans watch.', local: 'Local: every stop. Extras most people skip are labelled.' }[view.service]
    + (hidden ? ` <b>${hidden} stop${hidden === 1 ? '' : 's'} skipped.</b>` : '');
  $('#capped').hidden = !data.capped;
}

async function plan(ids) {
  try {
    await saveEntries(ids.map(id => ({ mediaId: id, status: 'PLANNING' })));
    ids.forEach(id => data.list.set(id, { mediaId: id, status: 'PLANNING', progress: 0 }));
    toast(ids.length === 1 ? 'Added to Planning' : `Added ${ids.length} titles to Planning`);
    render();
  } catch (e) { toast(e.message); }
}

function shareCard() {
  const { anchor, list, user } = data;
  const { stops, hereIdx, totalEps, totalMin, pct } = shown;
  showCard(() => lineCard({
    name: title(anchor),
    color: getComputedStyle(document.documentElement).getPropertyValue('--line').trim() || '#ffd23f',
    banner: anchor.bannerImage || anchor.coverImage.large,
    stops: stops.map((m, i) => ({
      name: title(m),
      state: i === hereIdx ? 'here' : m.status === 'NOT_YET_RELEASED' ? 'soon' : seen(m, list) >= epCount(m) && epCount(m) > 0 ? 'done' : m.role === 'recap' ? 'recap' : 'todo',
    })),
    facts: [`${stops.length} stops`, `${totalEps} episodes`, `${minutes(totalMin)} ride time`, view.order === 'story' ? 'story order' : 'release order'],
    progress: pct, rider: user?.name,
  }), `${title(anchor).replace(/[^\w]+/g, '-').toLowerCase()}-watch-order.png`);
}

// ---- boot ----------------------------------------------------------------
async function boot() {
  let id = +qs().get('id');
  if (!id && qs().get('q')) {
    const d = await gql(`query($s:String,$a:Boolean){Page(perPage:10){media(search:$s,type:ANIME,sort:SEARCH_MATCH,isAdult:$a){id popularity title{english romaji}}}}`, { s: qs().get('q'), a: adultArg() });
    id = rankSearch(d.Page.media, qs().get('q'))[0]?.id;
    if (!id) throw new Error(`No series called "${qs().get('q')}" found. Try the English or Japanese title.`);
    history.replaceState(null, '', `line.html?id=${id}`);
  }
  if (!id) { location.href = 'search.html'; return; }
  const fetchMany = ids => gql(`query($ids:[Int]){Page(perPage:50){media(id_in:$ids,type:ANIME){${FIELDS}}}}`, { ids }).then(d => d.Page.media);
  const graph = await crawl(id, fetchMany, n => ($('#found').textContent = `${n} stop${n === 1 ? '' : 's'} found`));
  const { stops, transfers, anchor } = classify(id, graph, { adult: prefs.adult() });
  stops.forEach(m => (m.svc = service(m, anchor)));
  const [user, list] = await Promise.all([me(), listStatus([...stops, ...transfers].map(m => m.id))]);
  data = { stops, transfers, anchor, list, user, capped: graph.capped };

  const color = anchor.coverImage.color || '#ffd23f';
  document.documentElement.style.setProperty('--line', color);
  document.title = `${title(anchor)} watch order · Animetro`;
  $('#name').textContent = title(anchor);
  $('#hero').style.setProperty('--banner', anchor.bannerImage ? `url(${anchor.bannerImage})` : 'none');
  $('#loading').remove();
  $('#map').hidden = false;
  render();
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-view]');
  if (b) {
    if (b.dataset.view === 'order') view.order = b.dataset.value; else view.service = b.dataset.value;
    const p = qs();
    p.set('order', view.order); p.set('stops', view.service);
    history.replaceState(null, '', `?${p}`);
    render();
  }
  const add = e.target.closest('[data-plan]');
  if (add) plan([+add.dataset.plan]);
  if (e.target.closest('#card')) shareCard();
  if (e.target.closest('#share')) {
    // an animetro:// link only opens in the app, so the app shares the AniList page instead
    const link = inApp ? `https://anilist.co/anime/${data.anchor.id}` : location.href;
    navigator.clipboard.writeText(link).then(() => toast('Link copied. Send it to a friend who keeps asking.'), () => toast(link));
  }
});
$('#perday').addEventListener('input', e => { view.perDay = +e.target.value; render(); });

boot().catch(err => { $('#loading')?.remove(); $('#map').hidden = false; fail($('#stops'), err); });
