// "My metro map": every franchise you've touched as a line, every season/movie/OVA a station.
// Grouping, layout geometry and the SVG for one line. No DOM or network, so test/check.mjs can run it.
import { title } from './api.js';
import { esc } from './ui.js';
import { service } from './order.js';

// Links that make two entries the same franchise line. Summaries, spin-offs and alternate versions don't.
const LINK = new Set(['PREQUEL', 'SEQUEL', 'PARENT', 'SIDE_STORY']);
const TOUCHED = new Set(['COMPLETED', 'REPEATING', 'CURRENT', 'PAUSED', 'DROPPED']);
export const PALETTE = ['#f39700', '#e60012', '#00a7db', '#00a650', '#9b7cb6', '#00ada9', '#d7c447', '#bb641d', '#e85298', '#9caeb7', '#6cbb5a', '#3a7bd5'];

const dateKey = m => { const s = m.startDate || {}; return (s.year ?? 9999) * 10000 + (s.month ?? 12) * 100 + (s.day ?? 31); };

// What a station looks like, from your list status (null = not on your list).
export function stationState(s) {
  if (s.list === 'COMPLETED' || s.list === 'REPEATING') return 'done';
  if (s.list === 'CURRENT') return 'here';
  if (s.list === 'PAUSED') return 'paused';
  if (s.list === 'DROPPED') return 'dropped';
  if (s.status === 'NOT_YET_RELEASED') return 'soon';
  if (s.list === 'PLANNING') return 'planned';
  return 'unridden';
}

// entries: AniList list entries with media.relations. Each entry's direct franchise neighbours that aren't
// on your list come along as unridden stations, so a line shows the stop you haven't reached yet.
export function franchises(entries, now = new Date()) {
  const node = new Map();
  for (const e of entries) node.set(e.media.id, { ...e.media, list: e.status, progress: e.progress });
  for (const e of entries) for (const ed of e.media.relations?.edges || []) {
    const n = ed.node;
    if (n.type === 'ANIME' && n.format !== 'MUSIC' && LINK.has(ed.relationType) && !node.has(n.id)) node.set(n.id, { ...n, list: null });
  }
  // union-find over the franchise links
  const parent = new Map([...node.keys()].map(id => [id, id]));
  const find = id => { while (parent.get(id) !== id) { parent.set(id, parent.get(parent.get(id))); id = parent.get(id); } return id; };
  for (const e of entries) for (const ed of e.media.relations?.edges || []) {
    if (LINK.has(ed.relationType) && node.has(ed.node.id)) parent.set(find(e.media.id), find(ed.node.id));
  }
  const groups = new Map();
  for (const id of node.keys()) { const r = find(id); groups.set(r, [...(groups.get(r) || []), node.get(id)]); }

  const lines = [];
  for (const stations of groups.values()) {
    if (!stations.some(s => TOUCHED.has(s.list))) continue; // only franchises you've actually ridden
    stations.sort((a, b) => dateKey(a) - dateKey(b) || a.id - b.id);
    const onList = stations.filter(s => s.list);
    const anchor = onList.reduce((a, b) => ((b.popularity || 0) > (a.popularity || 0) ? b : a), onList[0]);
    stations.forEach(s => (s.state = stationState(s)));
    grade(stations, now);
    lines.push({
      id: anchor.id, anchor, stations, ...tally(stations),
      // the animation studio, not a producer/publisher like Aniplex that AniList also marks as main
      studio: (anchor.studios?.nodes || []).find(n => n.isAnimationStudio)?.name || null,
    });
  }
  // biggest lines first, then name
  return lines.sort((a, b) => b.total - a.total || b.done - a.done || a.id - b.id);
}

function tally(stations) {
  const done = stations.filter(s => s.state === 'done').length;
  const out = stations.filter(s => s.state !== 'soon').length;
  return { done, total: stations.length, complete: done === out && out > 0, riding: stations.some(s => s.state === 'here') };
}

// Express/Rapid/Local for each station, the same rule as the line page (order.js service()): main story is the
// prequel/sequel chain through the line's most popular series, everything else is judged by how many of its fans watched it.
const SERIES = new Set(['TV', 'TV_SHORT', 'ONA']), MAIN = new Set([...SERIES, 'MOVIE']);
function grade(stations, now) {
  const pop = arr => arr.reduce((a, b) => ((b.popularity || 0) > (a?.popularity ?? -1) ? b : a), null);
  const anchor = pop(stations.filter(s => SERIES.has(s.format))) || pop(stations);
  const next = new Map(stations.map(s => [s.id, []]));
  for (const s of stations) for (const e of s.relations?.edges || []) {
    if ((e.relationType === 'SEQUEL' || e.relationType === 'PREQUEL') && next.has(e.node.id)) { next.get(s.id).push(e.node.id); next.get(e.node.id).push(s.id); }
  }
  const chain = new Set([anchor.id]);
  for (const q = [anchor.id]; q.length;) for (const id of next.get(q.pop())) if (!chain.has(id)) { chain.add(id); q.push(id); }
  for (const s of stations) {
    s.role = chain.has(s.id) && (MAIN.has(s.format) || !s.format) ? 'main' : 'side';
    s.svc = service(s, anchor, now).level;
  }
}

// One line as a train service sees it: express | rapid | local.
export function ride(l, svc) {
  if (svc === 'local') return l;
  const stations = l.stations.filter(s => s.svc === 'express' || (svc === 'rapid' && s.svc === 'rapid'));
  return { ...l, stations, ...tally(stations) };
}

// Studios with 2+ lines become districts; everything else lands in "Other lines".
export function districts(lines) {
  const by = new Map();
  for (const l of lines) { const k = l.studio || ''; by.set(k, [...(by.get(k) || []), l]); }
  const big = [...by].filter(([k, ls]) => k && ls.length > 1).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const rest = [...by].filter(([k, ls]) => !k || ls.length < 2).flatMap(([, ls]) => ls);
  return [...big.map(([name, ls]) => ({ name, lines: ls })), ...(rest.length ? [{ name: null, lines: rest }] : [])];
}

// Snake layout: stations left to right, U-turn, right to left... within `width`.
// Returns station points and an SVG path that runs through them with rounded U-turns.
export function snake(n, width, { gap = 64, pad = 44, row = 128, top = 92 } = {}) {
  const per = Math.max(2, Math.floor((width - pad * 2) / gap) + 1);
  const pts = Array.from({ length: n }, (_, i) => {
    const r = Math.floor(i / per), k = i % per, x = pad + (r % 2 ? per - 1 - k : k) * gap;
    return { x, y: top + r * row, row: r };
  });
  let d = pts.length ? `M${pts[0].x} ${pts[0].y}` : '';
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (a.row === b.row) d += ` L${b.x} ${b.y}`;
    else { const bulge = a.row % 2 ? -row * .42 : row * .42; d += ` C${a.x + bulge} ${a.y} ${b.x + bulge} ${b.y} ${b.x} ${b.y}`; }
  }
  const rows = pts.length ? pts.at(-1).row + 1 : 0;
  return { pts, d, height: top + (rows - 1) * row + 46, per };
}

export const STATE = {
  done: 'Ridden', here: 'You are here', paused: 'Paused', dropped: 'Dropped',
  planned: 'On your Planning list', unridden: 'Not ridden yet', soon: 'Under construction',
};

export function lineSvg(l, width, svc = 'rapid') {
  const { pts, d, height } = snake(l.total, width);
  const letter = (title(l.anchor).match(/[A-Za-z]/)?.[0] || 'A').toUpperCase();
  const here = l.stations.findIndex(s => s.state === 'here');
  return `
    <article class="mline" style="--c:${l.color}">
      <a class="mline-head" href="line.html?id=${l.anchor.id}&stops=${svc}">
        <span class="roundel" aria-hidden="true">${letter}</span>
        <b>${esc(title(l.anchor))}</b>
        <span class="hint" style="margin:0">${l.done} of ${l.total} ridden${l.complete ? ' · end to end' : ''}</span>
      </a>
      <svg class="mline-map" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(title(l.anchor))}: ${l.done} of ${l.total} stations ridden">
        <path d="${d}" class="track" />
        <path d="${d}" class="track-color" stroke="${l.color}" />
        ${pts.map((p, i) => {
          const s = l.stations[i], name = title(s);
          return `<a href="anime.html?id=${s.id}">
            <title>${esc(name)} (${s.format ? s.format.replace('_', ' ') : ''}${s.startDate?.year ? `, ${s.startDate.year}` : ''}): ${STATE[s.state]}</title>
            ${marker(s.state, p.x, p.y, l.color, i === here)}
            <text x="${p.x + 6}" y="${p.y - 16}" transform="rotate(-32 ${p.x + 6} ${p.y - 16})" class="st-name${s.state === 'unridden' || s.state === 'soon' ? ' dim' : ''}">${esc(name.length > 20 ? name.slice(0, 19) + '…' : name)}</text>
            <text x="${p.x}" y="${p.y + 27}" class="st-code">${letter}${String(i + 1).padStart(2, '0')}</text>
          </a>`;
        }).join('')}
      </svg>
    </article>`;
}

// Station markers: Tokyo-Metro style rings, filled in as you ride.
export function marker(state, x, y, color, pulse = false) {
  const r = 9;
  switch (state) {
    case 'done': return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="${color}" stroke-width="5"/>`;
    case 'here': return `${pulse ? `<circle cx="${x}" cy="${y}" r="${r + 6}" class="pulse" fill="${color}"/>` : ''}<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="${color}" stroke-width="5"/><circle cx="${x}" cy="${y}" r="3.5" fill="${color}"/>`;
    case 'paused': return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="${color}" stroke-width="5"/><rect x="${x - 3}" y="${y - 3.5}" width="2" height="7" fill="${color}"/><rect x="${x + 1}" y="${y - 3.5}" width="2" height="7" fill="${color}"/>`;
    case 'dropped': return `<circle cx="${x}" cy="${y}" r="${r}" fill="#2d3768" stroke="#9aa3c7" stroke-width="3"/><path d="M${x - 4} ${y - 4} L${x + 4} ${y + 4} M${x + 4} ${y - 4} L${x - 4} ${y + 4}" stroke="#9aa3c7" stroke-width="2.4"/>`;
    case 'planned': return `<circle cx="${x}" cy="${y}" r="${r}" fill="#131833" stroke="${color}" stroke-width="3" stroke-dasharray="4 3"/>`;
    case 'soon': return `<circle cx="${x}" cy="${y}" r="${r}" fill="#131833" stroke="#9aa3c7" stroke-width="2.5" stroke-dasharray="2 3"/>`;
    default: return `<circle cx="${x}" cy="${y}" r="${r}" fill="#131833" stroke="#5b6594" stroke-width="3.5"/>`;
  }
}
