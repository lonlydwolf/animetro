import { gql, me, title, CARD, TICKETS, saveEntries } from './api.js';
import { header, $, esc, FORMAT, toast } from './ui.js';

header();
const GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Horror', 'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'];
const COLORS = ['ginza', 'marunouchi', 'tozai', 'chiyoda', 'yurakucho', 'hanzomon', 'namboku', 'fukutoshin', 'hibiya'];
$('#genre').innerHTML += GENRES.map(g => `<option>${g}</option>`).join('');
$('#ticket').innerHTML = Object.entries(TICKETS).map(([k, t]) => `<option value="${k}"${k === 'teen' ? ' selected' : ''}>${t.label}: ${t.note.toLowerCase()}</option>`).join('');
$('#dome').innerHTML = Array.from({ length: 16 }, (_, i) =>
  `<span class="capsule" style="--c:var(--${COLORS[i % COLORS.length]});left:${12 + ((i * 53) % 200)}px;top:${110 + ((i * 37) % 120)}px;transform:rotate(${i * 47}deg)"></span>`).join('');

const rarity = m =>
  m.averageScore >= 80 && m.popularity < 60000 ? 'SSR' : m.averageScore >= 78 ? 'SR' : m.averageScore >= 68 ? 'R' : 'N';

const totals = new Map(); // filter key -> how many shows match (memory only)
let user;
me().then(u => (user = u));

function filters() {
  const t = TICKETS[$('#ticket').value];
  const [a, b] = ($('#era').value || '').split('-').map(Number);
  return {
    genre: $('#genre').value || undefined,
    gnot: t.genre_not_in.length ? t.genre_not_in : undefined,
    tnot: t.tag_not_in.length ? t.tag_not_in : undefined,
    from: a ? a * 10000 : undefined,
    to: b ? b * 10000 : undefined,
  };
}
const ARGS = 'type:ANIME,isAdult:false,popularity_greater:2500,genre:$genre,genre_not_in:$gnot,tag_not_in:$tnot,startDate_greater:$from,startDate_lesser:$to';
const VARS = '$genre:String,$gnot:[String],$tnot:[String],$from:FuzzyDateInt,$to:FuzzyDateInt';

// AniList's pageInfo.total is stuck at 5000, so estimate the match count by probing
// which pages exist: first powers of two, then 16 steps between the last hit and the first miss.
async function count(f) {
  const probe = async positions => {
    const parts = positions.map((p, i) => `p${i}: Page(page:${p},perPage:1){ media(${ARGS},sort:ID){id} }`);
    const d = await gql(`query(${VARS}){ ${parts.join(' ')} }`, f);
    return positions.filter((_, i) => d[`p${i}`]?.media.length);
  };
  const pows = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 5000];
  const hit = (await probe(pows)).at(-1);
  if (!hit || hit === 5000) return hit || 0;
  const step = hit / 16;
  if (step < 1) return hit; // small sets were already probed densely enough
  const next = Math.min(hit * 2, 5000);
  const steps = Array.from({ length: 15 }, (_, i) => Math.round(hit + ((i + 1) * (next - hit)) / 16));
  return (await probe(steps)).at(-1) || hit;
}

async function pull(n) {
  const f = filters(), key = JSON.stringify(f);
  if (!totals.has(key)) totals.set(key, await count(f));
  const total = totals.get(key);
  if (!total) throw new Error('No shows match these settings. Loosen a filter.');
  // Random positions, all n pulls in one aliased request.
  const parts = Array.from({ length: n }, (_, i) => {
    const page = 1 + Math.floor(Math.random() * total);
    return `p${i}: Page(page:${page},perPage:1){ media(${ARGS},sort:ID){ ${CARD} } }`;
  });
  const d = await gql(`query(${VARS}){ ${parts.join(' ')} }`, f);
  const seen = new Set();
  return Object.values(d).map(p => p.media[0]).filter(m => m && !seen.has(m.id) && seen.add(m.id));
}

function reveal(list) {
  const html = list.map(m => {
    const r = rarity(m);
    return `
      <div class="pull r-${r}">
        <div class="pull-inner">
          <div class="pull-front">
            <span class="rar">${r}</span>
            <a href="anime.html?id=${m.id}"><img src="${m.coverImage.large}" alt=""></a>
            <div class="info">
              <b>${esc(title(m))}</b>
              <small>${[FORMAT[m.format], m.seasonYear, m.averageScore && `${m.averageScore}%`].filter(Boolean).join('  ')}</small>
              <div class="links">
                <a class="tag" href="line.html?id=${m.id}" style="text-decoration:none">Watch order</a>
                ${user?.canWrite ? `<button class="tag add" data-plan="${m.id}">+ Planning</button>` : ''}
              </div>
            </div>
          </div>
          <div class="pull-back">?</div>
        </div>
      </div>`;
  }).join('');
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const nodes = [...wrap.children];
  $('#pulls').prepend(...nodes);
  nodes.forEach((el, i) => setTimeout(() => el.classList.add('flip'), 150 + i * 180));
  const best = list.map(rarity);
  if (best.includes('SSR')) setTimeout(() => toast('SSR! A hidden gem most people have never heard of.'), 300 + nodes.length * 180);
}

async function go(n) {
  const buttons = [$('#one'), $('#ten'), $('#knob')];
  buttons.forEach(b => (b.disabled = true));
  $('#knob').classList.add('turn');
  $('#dome').classList.add('shake');
  try {
    const [list] = await Promise.all([pull(n), new Promise(r => setTimeout(r, 1000))]);
    reveal(list);
  } catch (e) { toast(e.message); }
  $('#knob').classList.remove('turn');
  $('#dome').classList.remove('shake');
  buttons.forEach(b => (b.disabled = false));
}

$('#one').onclick = $('#knob').onclick = () => go(1);
$('#ten').onclick = () => go(10);
$('#pulls').addEventListener('click', async e => {
  const b = e.target.closest('[data-plan]');
  if (!b) return;
  try { await saveEntries([{ mediaId: +b.dataset.plan, status: 'PLANNING' }]); b.outerHTML = '<span class="tag s-PLANNING">Planning</span>'; toast('Added to Planning'); }
  catch (err) { toast(err.message); }
});
