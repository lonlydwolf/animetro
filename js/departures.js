import { gql, me, title, listStatus, prefs } from './api.js';
import { header, $, esc, countdown } from './ui.js';

header();
const startOfDay = off => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + off); return d; };
let day = 0, rows = [], list = new Map();

$('#days').innerHTML = Array.from({ length: 7 }, (_, i) => {
  const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : startOfDay(i).toLocaleDateString(undefined, { weekday: 'long' });
  return `<button data-day="${i}" aria-pressed="${i === 0}">${label}</button>`;
}).join('');

async function load() {
  $('#rows').innerHTML = '<tr><td colspan="5">Loading board…</td></tr>';
  const from = startOfDay(day) / 1000, to = startOfDay(day + 1) / 1000;
  rows = [];
  // A day has ~30-60 airings; fetch both pages in one request.
  const page = n => `p${n}: Page(page:${n},perPage:50){ pageInfo{hasNextPage} airingSchedules(airingAt_greater:$from,airingAt_lesser:$to,sort:TIME){
    episode airingAt media{ id isAdult popularity episodes format title{english romaji} coverImage{medium} } } }`;
  const d = await gql(`query($from:Int,$to:Int){ ${page(1)} ${page(2)} }`, { from, to });
  rows = [...d.p1.airingSchedules, ...d.p2.airingSchedules].filter(a => !a.media.isAdult || prefs.adult());
  list = await listStatus(rows.map(a => a.media.id));
  render();
}

function render() {
  const niche = $('#niche').checked, mine = $('#mine').checked;
  const shown = rows.filter(a => (niche || a.media.popularity >= 3000 || list.has(a.media.id)) && (!mine || list.has(a.media.id)));
  $('#board-count').textContent = `${shown.length} departures`;
  $('#rows').innerHTML = shown.map(a => `
    <tr data-id="${a.media.id}" data-at="${a.airingAt}" class="${list.has(a.media.id) ? 'mine' : ''}">
      <td>${new Date(a.airingAt * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</td>
      <td class="dest"><a href="anime.html?id=${a.media.id}"><img src="${a.media.coverImage.medium}" alt="" loading="lazy">${esc(title(a.media))}</a></td>
      <td>${a.episode}${a.media.episodes ? `/${a.media.episodes}` : ''}${a.episode === a.media.episodes ? ' FINAL' : a.episode === 1 ? ' NEW' : ''}</td>
      <td class="left"></td><td class="st"></td>
    </tr>`).join('') || `<tr><td colspan="5">${mine ? 'None of your shows air this day.' : 'No departures.'}</td></tr>`;
  tick();
}

function tick() {
  const now = Date.now() / 1000;
  $('#clock').textContent = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  document.querySelectorAll('#rows tr[data-at]').forEach(tr => {
    const left = tr.dataset.at - now;
    tr.classList.toggle('gone', left < 0);
    tr.querySelector('.left').textContent = left < 0 ? '' : countdown(left);
    const st = tr.querySelector('.st');
    const [text, cls] = left < 0 ? ['Departed', 'st-gone'] : left < 1800 ? ['Boarding', 'st-boarding'] : ['On time', ''];
    if (st.textContent !== text) { st.textContent = text; st.className = 'st ' + cls; }
  });
}

$('#days').addEventListener('click', e => {
  const b = e.target.closest('[data-day]');
  if (!b) return;
  day = +b.dataset.day;
  document.querySelectorAll('#days button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  load().catch(err => ($('#rows').innerHTML = `<tr><td colspan="5">${esc(err.message)}</td></tr>`));
});
$('#rows').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-id]');
  if (tr && !e.target.closest('a')) location.href = `anime.html?id=${tr.dataset.id}`;
});
$('#niche').onchange = $('#mine').onchange = render;
me().then(u => { if (u) $('#mine-wrap').hidden = false; });

setInterval(tick, 1000);
load().catch(err => ($('#rows').innerHTML = `<tr><td colspan="5">${esc(err.message)}</td></tr>`));
