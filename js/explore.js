import { gql, CARD, TICKETS } from './api.js';
import { header, $, esc, qs, cards, fail } from './ui.js';

header();
const form = $('#filters');
const state = Object.fromEntries(qs());
let tags = (state.tags || '').split(',').filter(Boolean);
let page = 1, seq = 0;

const Q = `query($page:Int,$search:String,$genre_in:[String],$tag_in:[String],$genre_not_in:[String],$tag_not_in:[String],
  $format:MediaFormat,$season:MediaSeason,$seasonYear:Int,$status:MediaStatus,$score:Int,$sort:[MediaSort]){
  Page(page:$page,perPage:30){ pageInfo{hasNextPage}
    media(type:ANIME,isAdult:false,search:$search,genre_in:$genre_in,tag_in:$tag_in,genre_not_in:$genre_not_in,tag_not_in:$tag_not_in,
      format:$format,season:$season,seasonYear:$seasonYear,status:$status,averageScore_greater:$score,sort:$sort){ ${CARD} } } }`;

async function setup() {
  const d = await gql(`{ GenreCollection MediaTagCollection{ name category isAdult } }`);
  const genres = d.GenreCollection.filter(g => g !== 'Hentai');
  const chosen = (state.genres || '').split(',');
  $('#genres').innerHTML = genres.map(g => `<label><input type="checkbox" name="genre" value="${esc(g)}"${chosen.includes(g) ? ' checked' : ''}><span>${esc(g)}</span></label>`).join('');
  $('#tag-list').innerHTML = d.MediaTagCollection.filter(t => !t.isAdult).map(t => `<option value="${esc(t.name)}">`).join('');
  const valid = new Set(d.MediaTagCollection.map(t => t.name));
  $('#tag-input').addEventListener('change', e => {
    const v = e.target.value.trim();
    if (valid.has(v) && !tags.includes(v)) { tags.push(v); renderTags(); search(); }
    e.target.value = '';
  });
  $('#tickets').innerHTML = Object.entries(TICKETS).map(([k, t]) => `<label><input type="radio" name="ticket" value="${k}"${(state.ticket || 'mature') === k ? ' checked' : ''}><span>${t.label}</span></label>`).join('');
  for (const k of ['q', 'format', 'status', 'season', 'year', 'score', 'sort']) if (state[k] && form.elements[k]) form.elements[k].value = state[k];
  renderTags();
  search();
}

function renderTags() {
  $('#tags').innerHTML = tags.map(t => `<label><input type="checkbox" checked data-tag="${esc(t)}"><span>${esc(t)} ✕</span></label>`).join('');
}
$('#tags').addEventListener('change', e => { tags = tags.filter(t => t !== e.target.dataset.tag); renderTags(); search(); });

function read() {
  const f = new FormData(form);
  const ticket = TICKETS[f.get('ticket') || 'mature'];
  const genres = f.getAll('genre');
  const score = +f.get('score');
  $('#score-val').textContent = score ? `${score}%+` : 'any';
  $('#ticket-note').textContent = ticket.note + '. Estimated from tags; AniList has no official age rating.';
  const url = new URLSearchParams();
  const put = (k, v) => v && url.set(k, v);
  put('q', f.get('q')); put('genres', genres.join(',')); put('tags', tags.join(','));
  put('format', f.get('format')); put('status', f.get('status')); put('season', f.get('season'));
  put('year', f.get('year')); put('score', score || ''); put('sort', f.get('sort'));
  if (f.get('ticket') !== 'mature') put('ticket', f.get('ticket'));
  history.replaceState(null, '', url.size ? `?${url}` : location.pathname);
  const active = [...url.keys()].filter(k => k !== 'sort').length;
  $('#toggle').textContent = active ? `Filters (${active})` : 'Filters';
  const or = v => v || undefined;
  return {
    search: or(f.get('q')),
    genre_in: or(genres.length && genres), tag_in: or(tags.length && tags),
    genre_not_in: or(ticket.genre_not_in.length && ticket.genre_not_in), tag_not_in: or(ticket.tag_not_in.length && ticket.tag_not_in),
    format: or(f.get('format')), status: or(f.get('status')), season: or(f.get('season')), seasonYear: or(+f.get('year')),
    score: or(score), sort: f.get('q') ? ['SEARCH_MATCH', f.get('sort')] : [f.get('sort')],
  };
}

async function search(more = false) {
  const my = ++seq;
  page = more ? page + 1 : 1;
  const vars = read();
  if (!more) $('#results').style.opacity = .4;
  $('#more').disabled = true;
  try {
    const d = await gql(Q, { ...vars, page });
    if (my !== seq) return;
    const { media, pageInfo } = d.Page;
    await cards($('#results'), media, { append: more });
    if (!more && !media.length) $('#results').innerHTML = '<p class="empty">Nothing matches every filter. Try removing a genre or tag.</p>';
    $('#more').hidden = !pageInfo.hasNextPage;
  } catch (e) { fail($('#results'), e); }
  $('#results').style.opacity = 1;
  $('#more').disabled = false;
}

let timer;
form.addEventListener('input', e => {
  if (e.target.id === 'tag-input' || e.target.dataset.tag) return;
  clearTimeout(timer);
  // ponytail: 600ms debounce keeps us under AniList's 30 req/min while sliding
  timer = setTimeout(search, e.target.type === 'search' || e.target.type === 'range' || e.target.type === 'number' ? 600 : 150);
});
form.addEventListener('submit', e => e.preventDefault());
$('#reset').onclick = () => { form.reset(); tags = []; renderTags(); search(); };
$('#more').onclick = () => search(true);
$('#toggle').onclick = () => form.classList.toggle('open');
new IntersectionObserver(([e]) => e.isIntersecting && !$('#more').hidden && !$('#more').disabled && search(true), { rootMargin: '400px' }).observe($('#more'));

setup().catch(e => fail($('#results'), e));
