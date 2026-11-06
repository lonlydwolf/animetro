import { gql, title, listStatus, me, saveEntries, rankSearch } from './api.js';
import { header, $, esc, qs, FORMAT, STATUS, minutes, toast, countdown, fail } from './ui.js';
import { crawl, classify, storyOrder, byDate, ROLE } from './order.js';

header();

const FIELDS = `id title{english romaji} format status episodes duration season seasonYear startDate{year month day}
  averageScore popularity isAdult coverImage{large color} bannerImage nextAiringEpisode{episode timeUntilAiring}
  relations{edges{relationType(version:2) node{id type}}}`;

const view = { order: qs().get('order') || 'release', express: qs().get('stops') === 'express', perDay: 3 };
let data; // { stops, transfers, anchor, list, user, capped }

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
  if (view.express) stops = stops.filter(m => m.role === 'main');
  const letter = (title(anchor).match(/[A-Za-z]/)?.[0] || 'A').toUpperCase();
  const counted = stops.filter(m => m.role !== 'recap');
  const totalEps = counted.reduce((s, m) => s + epCount(m), 0);
  const leftEps = counted.reduce((s, m) => s + epCount(m) - seen(m, list), 0);
  const leftMin = counted.reduce((s, m) => s + (epCount(m) - seen(m, list)) * epLength(m), 0);
  const totalMin = counted.reduce((s, m) => s + epCount(m) * epLength(m), 0);
  const hereIdx = list.size ? stops.findIndex(m => m.role !== 'recap' && m.status !== 'NOT_YET_RELEASED' && seen(m, list) < epCount(m)) : -1;
  const visited = totalMin - leftMin;

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
          <a href="anime.html?id=${m.id}" class="stop-link">
            <img src="${m.coverImage.large}" alt="" loading="lazy">
            <span>
              <b>${esc(title(m))}</b>
              ${m.title.english && m.title.english !== m.title.romaji ? `<small class="romaji">${esc(m.title.romaji)}</small>` : ''}
              <span class="meta">${meta.map(esc).join('<i></i>')}</span>
            </span>
          </a>
          <div class="tags">
            ${m.role !== 'main' ? `<span class="tag role">${ROLE[m.role]}</span>` : ''}
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

  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === (b.dataset.view === 'order' ? view.order : view.express ? 'express' : 'all'))));
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

// ---- boot ----------------------------------------------------------------
async function boot() {
  let id = +qs().get('id');
  if (!id && qs().get('q')) {
    const d = await gql(`query($s:String){Page(perPage:10){media(search:$s,type:ANIME,sort:SEARCH_MATCH,isAdult:false){id popularity title{english romaji}}}}`, { s: qs().get('q') });
    id = rankSearch(d.Page.media, qs().get('q'))[0]?.id;
    if (!id) throw new Error(`No series called "${qs().get('q')}" found. Try the English or Japanese title.`);
    history.replaceState(null, '', `line.html?id=${id}`);
  }
  if (!id) { location.href = 'index.html'; return; }
  const fetchMany = ids => gql(`query($ids:[Int]){Page(perPage:50){media(id_in:$ids,type:ANIME){${FIELDS}}}}`, { ids }).then(d => d.Page.media);
  const graph = await crawl(id, fetchMany, n => ($('#found').textContent = `${n} stop${n === 1 ? '' : 's'} found`));
  const { stops, transfers, anchor } = classify(id, graph);
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
    if (b.dataset.view === 'order') view.order = b.dataset.value; else view.express = b.dataset.value === 'express';
    const p = qs();
    p.set('order', view.order); p.set('stops', view.express ? 'express' : 'all');
    history.replaceState(null, '', `?${p}`);
    render();
  }
  const add = e.target.closest('[data-plan]');
  if (add) plan([+add.dataset.plan]);
  if (e.target.closest('#share')) {
    navigator.clipboard.writeText(location.href).then(() => toast('Link copied. Send it to a friend who keeps asking.'));
  }
});
$('#perday').addEventListener('input', e => { view.perDay = +e.target.value; render(); });

boot().catch(err => { $('#loading')?.remove(); $('#map').hidden = false; fail($('#stops'), err); });
