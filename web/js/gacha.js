import { gql, me, title, CARD, TICKETS, tickets, ticketAdult, prefs, seenIds } from './api.js';
import { countPages } from './probe.js';
import { header, $, esc, FORMAT, toast, nsfw, cover } from './ui.js';
import { planBoard } from './plan.js';

header();
const GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Horror', 'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'];
const COLORS = ['ginza', 'marunouchi', 'tozai', 'chiyoda', 'yurakucho', 'hanzomon', 'namboku', 'fukutoshin', 'hibiya'];
$('#genre').innerHTML += [...GENRES, ...(prefs.adult() ? ['Hentai'] : [])].map(g => `<option>${g}</option>`).join('');
$('#ticket').innerHTML = tickets().map(([k, t]) => `<option value="${k}"${k === 'teen' ? ' selected' : ''}>${t.label}: ${t.note.toLowerCase()}</option>`).join('');
$('#dome').innerHTML = Array.from({ length: 16 }, (_, i) =>
  `<span class="capsule" style="--c:var(--${COLORS[i % COLORS.length]});left:${12 + ((i * 53) % 200)}px;top:${110 + ((i * 37) % 120)}px;transform:rotate(${i * 47}deg)"></span>`).join('');

const rarity = m =>
  m.averageScore >= 80 && m.popularity < 60000 ? 'SSR' : m.averageScore >= 78 ? 'SR' : m.averageScore >= 68 ? 'R' : 'N';

const totals = new Map(); // filter key -> how many shows match (memory only)
const board = planBoard(); // what we know about your list, per show; every card of a show paints from it
let user;
me().then(u => { user = u; $('#fresh-wrap').hidden = !u; }, () => {}); // unknown for now: the first pull asks again

async function filters() {
  const t = TICKETS[$('#ticket').value];
  const [a, b] = ($('#era').value || '').split('-').map(Number);
  const adult = $('#genre').value === 'Hentai' ? true : ticketAdult(t);
  return {
    adult,
    pop: adult ? 300 : 2500, // 18+ titles have far fewer viewers
    not: $('#fresh').checked ? await seenIds() : undefined,
    genre: $('#genre').value || undefined,
    gnot: t.genre_not_in.length ? t.genre_not_in : undefined,
    tnot: t.tag_not_in.length ? t.tag_not_in : undefined,
    from: a ? a * 10000 : undefined,
    to: b ? b * 10000 : undefined,
  };
}
const ARGS = 'type:ANIME,isAdult:$adult,id_not_in:$not,popularity_greater:$pop,genre:$genre,genre_not_in:$gnot,tag_not_in:$tnot,startDate_greater:$from,startDate_lesser:$to';
const VARS = '$adult:Boolean,$not:[Int],$pop:Int,$genre:String,$gnot:[String],$tnot:[String],$from:FuzzyDateInt,$to:FuzzyDateInt';

// How many shows match, exactly (see probe.js): every match can then be pulled.
function count(f) {
  return countPages(async positions => {
    const parts = positions.map((p, i) => `p${i}: Page(page:${p},perPage:1){ media(${ARGS},sort:ID){id} }`);
    const d = await gql(`query(${VARS}){ ${parts.join(' ')} }`, f);
    return positions.filter((_, i) => d[`p${i}`]?.media.length);
  });
}

async function pull(n) {
  const f = await filters(), key = JSON.stringify({ ...f, not: !!f.not });
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
            <a href="anime.html?id=${m.id}" class="${nsfw(m)}"><img src="${cover(m)}" alt=""></a>
            <div class="info">
              <b>${esc(title(m))}</b>
              <small>${[FORMAT[m.format], m.seasonYear, m.averageScore && `${m.averageScore}%`].filter(Boolean).join('  ')}</small>
              <div class="links">
                <a class="tag" href="line.html?id=${m.id}" style="text-decoration:none">Watch order</a>
                <span data-slot="${m.id}" style="display:contents">${board.slot(m.id, user?.canWrite)}</span>
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
    // your list status for these shows, so a result already on your list shows that instead of + Planning
    const pulled = pull(n).then(async list => {
      user = await me().catch(() => user); // who you are couldn't be read: the board shows unknown, the pull still lands
      await board.learn(list.map(m => m.id));
      return list;
    });
    const [list] = await Promise.all([pulled, new Promise(r => setTimeout(r, 1000))]);
    reveal(list);
    list.forEach(m => paint(m.id)); // earlier pulls of the same shows catch up too
  } catch (e) { toast(e.message); }
  $('#knob').classList.remove('turn');
  $('#dome').classList.remove('shake');
  buttons.forEach(b => (b.disabled = false));
}

$('#one').onclick = $('#knob').onclick = () => go(1);
$('#ten').onclick = () => go(10);
const paint = id => $('#pulls').querySelectorAll(`[data-slot="${id}"]`).forEach(el => (el.innerHTML = board.slot(id, user?.canWrite)));
const SAID = {
  added: 'Added to Planning',
  listed: "It's already on your list, so nothing was changed.",
  unknown: "Couldn't confirm it isn't on your list, so nothing was changed. Check again in a moment.",
};
$('#pulls').addEventListener('click', async e => {
  const r = e.target.closest('[data-recheck]'), b = e.target.closest('[data-plan]');
  if (!(r || b) || (r || b).disabled) return;
  const id = +(r ? r.dataset.recheck : b.dataset.plan);
  if (r) {
    r.disabled = true;
    const s = await board.recheck(id);
    if (s === 'stale') return; // a newer check for this show paints instead
    paint(id);
    if (s === 'unknown') toast("Still couldn't check your list. Try again in a moment.");
    return;
  }
  // the card is only a hint: add() looks the show up again and saves only if it's really not on your list
  const adding = board.add(id);
  paint(id); // every + Planning for this show greys out while it checks
  try { const s = await adding; if (SAID[s]) toast(SAID[s]); } catch (err) { toast(err.message); }
  paint(id);
});
