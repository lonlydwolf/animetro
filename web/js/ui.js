import { gql, me, UnknownUser, title, listStatus, rankSearch, CARD, prefs, adultArg } from './api.js';
import { mode, setMode, tellApp } from './themes.js';

export const $ = (s, el = document) => el.querySelector(s);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const qs = () => new URLSearchParams(location.search);

// Values from AniList that end up in attributes or CSS. Only plain https addresses and hex colors get through,
// so a malformed or hostile value can't break out of the attribute; missing values fall back quietly.
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; // 1x1 transparent GIF
export const safeUrl = u => (/^https:\/\/[^\s"'()<>\\]+$/i.test(u || '') ? esc(u) : '');
export const safeColor = (c, fallback = 'var(--rail)') => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : fallback);
export const cover = (m, size = 'large') => safeUrl(m?.coverImage?.[size] || m?.coverImage?.large || m?.coverImage?.medium) || BLANK;
export const tint = (m, fallback) => safeColor(m?.coverImage?.color, fallback);
// File names built from titles or usernames: letters, digits, dots and dashes only.
export const safeFilename = name => String(name || 'animetro').replace(/[^\w.-]+/g, '-').replace(/^[-.]+/, '').slice(0, 80) || 'animetro.png';

const NAV = [
  ['search.html', 'Discover'],
  ['explore.html', 'Explore'],
  ['foryou.html', 'For you'],
  ['map.html', 'My map'],
  ['history.html', 'History'],
  ['rate.html', 'Rate'],
  ['departures.html', 'Departures'],
  ['gacha.html', 'Gacha'],
];

export const STATUS = {
  CURRENT: 'Watching', PLANNING: 'Planning', COMPLETED: 'Completed',
  DROPPED: 'Dropped', PAUSED: 'Paused', REPEATING: 'Rewatching',
};
export const FORMAT = {
  TV: 'TV', TV_SHORT: 'TV short', MOVIE: 'Movie', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Music video',
};

// Header on every page: logo roundel, nav, quick search, and your pass.
const SUN = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1z" fill="currentColor"/></svg>';

export function header() {
  const page = location.pathname.split('/').pop() || 'index.html';
  const el = document.createElement('header');
  el.className = 'top';
  el.innerHTML = `
    <a class="brand" href="index.html" aria-label="Animetro home">
      <span class="roundel" aria-hidden="true">A</span><span class="brand-name">Animetro</span>
    </a>
    <nav>${NAV.map(([href, label]) => `<a href="${href}"${href === page ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
    ${page === 'search.html' ? '' : '<div class="top-search"><input type="search" placeholder="Find a series…" aria-label="Find a series"></div>'}
    <div class="top-end">
      <button class="mode-btn" type="button"></button>
      <button class="adult-pill" aria-pressed="${prefs.adult()}" title="18+ titles are ${prefs.adult() ? 'shown' : 'hidden'}. Click to change.">18+</button>
      <a class="pass-link" href="pass.html"${page === 'pass.html' ? ' aria-current="page"' : ''}><span class="pass-avatar"></span><span class="pass-name">My pass</span></a>
    </div>`;
  document.body.prepend(el);
  const input = $('.top-search input', el);
  if (input) searchBox(input, m => (location.href = `line.html?id=${m.id}`));
  $('.adult-pill', el).onclick = adultGate;
  // light/dark for the current livery, on every page
  const modeBtn = $('.mode-btn', el);
  const showMode = () => {
    const lit = mode() === 'light';
    modeBtn.innerHTML = lit ? MOON : SUN;
    modeBtn.setAttribute('aria-label', `Switch to ${lit ? 'dark' : 'light'} mode`);
    modeBtn.title = modeBtn.getAttribute('aria-label');
  };
  modeBtn.onclick = () => setMode(mode() === 'light' ? 'dark' : 'light');
  addEventListener('livery', showMode);
  showMode();
  tellApp();
  me().then(u => {
    if (!u) return;
    if (safeUrl(u.avatar?.large)) $('.pass-avatar', el).style.backgroundImage = `url("${u.avatar.large}")`;
    $('.pass-avatar', el).classList.add('on');
    $('.pass-name', el).textContent = u.name;
  }, () => {}); // who you are couldn't be read: the badge stays plain "My pass"; the page itself says why
  addEventListener('ratelimit', e => toast(`Pausing ${e.detail}s to stay under AniList's limit of 30 requests a minute…`));
}

// The 18+ switch. A native <dialog>; saving reloads so every query picks up the new setting.
export function adultGate() {
  let d = $('#gate');
  if (!d) {
    d = document.createElement('dialog');
    d.id = 'gate';
    d.className = 'gate';
    d.innerHTML = `
      <form method="dialog">
        <span class="roundel" aria-hidden="true">18</span>
        <h2>Late-night service</h2>
        <p>AniList marks hentai and other explicit anime as 18+. Animetro keeps them off the line unless you turn them on. Only do this if you're 18 or older and it's legal where you live.</p>
        <label class="check"><input type="checkbox" name="adult"> Show 18+ titles. I'm 18 or older.</label>
        <label class="check"><input type="checkbox" name="blur"> Blur 18+ covers until I hover over them</label>
        <div class="gate-actions"><button class="btn ghost" value="cancel">Cancel</button><button class="btn" value="save">Save</button></div>
      </form>`;
    document.body.append(d);
    d.addEventListener('close', () => {
      if (d.returnValue !== 'save') return;
      const f = $('form', d);
      prefs.set(f.adult.checked, f.blur.checked);
      location.reload();
    });
  }
  const f = $('form', d);
  f.adult.checked = prefs.adult();
  f.blur.checked = prefs.blur();
  d.returnValue = '';
  d.showModal();
}
export const nsfw = m => (m?.isAdult && prefs.blur() ? ' nsfw' : '');

// Typeahead that searches English + romaji titles. Debounced: we only get ~30 requests a minute.
// Enter picks the highlighted suggestion; with none (yet) it hands the typed text to `onQuery`, which by
// default opens line.html?q=, the page that finds the best match for a typed title.
export function searchBox(input, onPick, onQuery = q => (location.href = `line.html?q=${encodeURIComponent(q)}`)) {
  const box = document.createElement('div');
  box.className = 'suggest';
  box.setAttribute('role', 'listbox');
  input.after(box);
  input.setAttribute('autocomplete', 'off');
  // `itemsFor` is the text the suggestions were fetched for, so Enter never picks an answer to older text
  let timer, items = [], itemsFor = null, active = -1, seq = 0;

  const render = () => {
    box.innerHTML = items.map((m, i) => `
      <div class="suggest-row${i === active ? ' active' : ''}${nsfw(m)}" role="option" data-i="${i}">
        <img src="${cover(m, 'medium')}" alt="" loading="lazy">
        <div><b>${esc(title(m))}</b><small>${esc([m.isAdult ? '18+' : '', m.title?.english && m.title?.romaji !== m.title?.english ? m.title.romaji : '', FORMAT[m.format], m.startDate?.year].filter(Boolean).join(', '))}</small></div>
        <a class="suggest-info" href="anime.html?id=${+m.id}" title="Details">i</a>
      </div>`).join('');
    box.classList.toggle('open', items.length > 0);
  };
  const clear = () => { items = []; itemsFor = null; active = -1; render(); };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    // every keystroke (clearing too) gets a new ticket, so a slower earlier answer can't land afterwards
    const my = ++seq;
    // the old suggestions answer the old text: drop them now rather than when the new ones arrive
    clear();
    const s = input.value.trim();
    if (s.length < 2) return;
    timer = setTimeout(async () => {
      const d = await gql(`query($s:String,$a:Boolean){Page(perPage:10){media(search:$s,type:ANIME,sort:SEARCH_MATCH,isAdult:$a){id popularity isAdult title{english romaji} format startDate{year} coverImage{medium}}}}`, { s, a: adultArg() }).catch(() => null);
      if (my !== seq || !d || input.value.trim() !== s) return;
      items = rankSearch(d.Page.media, s).slice(0, 7); itemsFor = s; active = items.length ? 0 : -1; render();
    }, 350);
  });
  input.addEventListener('keydown', e => {
    // keys pressed while an IME is composing (Japanese, Chinese, Korean…) belong to the IME: Enter confirms the text
    if (e.isComposing || e.keyCode === 229) return;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length) {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      render();
    } else if (e.key === 'Enter') {
      const s = input.value.trim();
      if (!s) return;
      e.preventDefault();
      const pick = itemsFor === s && items[active];
      // whatever is still loading must not open a dropdown over the page we're leaving
      clearTimeout(timer); ++seq;
      if (pick) onPick(pick); else onQuery(s);
    } else if (e.key === 'Escape') { clearTimeout(timer); ++seq; clear(); }
  });
  box.addEventListener('mousedown', e => {
    if (e.target.closest('.suggest-info')) return;
    const row = e.target.closest('.suggest-row');
    if (row) { e.preventDefault(); onPick(items[row.dataset.i]); }
  });
  input.addEventListener('blur', () => setTimeout(() => box.classList.remove('open'), 150));
  input.addEventListener('focus', () => items.length && box.classList.add('open'));
}

// Poster card used in grids. `entry` is the rider's list entry, if any; `extra` is HTML under the title.
export function card(m, entry, extra = '') {
  const color = tint(m, '#4b5684');
  const meta = [FORMAT[m.format], m.seasonYear, m.episodes && m.format !== 'MOVIE' ? `${m.episodes} ep` : ''].filter(Boolean).join('  ');
  return `
    <a class="card${nsfw(m)}" href="anime.html?id=${m.id}" style="--c:${color}">
      <div class="poster">
        <img src="${cover(m)}" alt="" loading="lazy">
        ${m.averageScore ? `<span class="score">${m.averageScore}</span>` : ''}
        ${entry ? `<span class="ribbon s-${entry.status}">${STATUS[entry.status]}</span>` : ''}
        ${m.isAdult ? '<span class="adult-badge">18+</span>' : ''}
      </div>
      <b>${esc(title(m))}</b>
      <small>${esc(meta)}</small>${extra}
    </a>`;
}

// Fills `el` with cards once the rider's list status is known. Pass `current` to skip the write when the
// caller's request went stale during that wait; returns whether it wrote.
export async function cards(el, media, { append = false, current = () => true } = {}) {
  const list = await listStatus(media.map(m => m.id));
  if (!current()) return false;
  const html = media.map(m => card(m, list.get(m.id))).join('');
  if (append) el.insertAdjacentHTML('beforeend', html); else el.innerHTML = html;
  return true;
}

export function toast(msg) {
  let t = $('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 3500);
}

export const minutes = min => {
  if (!min) return '0m';
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = Math.round(min % 60);
  return [d && `${d}d`, h && `${h}h`, !d && m && `${m}m`].filter(Boolean).join(' ');
};

export function countdown(sec) {
  if (sec <= 0) return 'now';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

// Pages with public content (a show, a line) still render when who you are can't be read; this says why
// your list, progress and save buttons are missing.
export const listNote = err => `<span class="hint list-note" role="status">Couldn't load your list (${esc(String(err.message || err).replace(/\.$/, ''))}). <a href="pass.html">My pass</a></span>`;

// An unknown saved username can't be fixed by trying again, so that error points to where it can be.
export const fail = (el, err) => {
  el.innerHTML = `<p class="empty">${esc(err.message || err)}${err instanceof UnknownUser ? ' <a href="pass.html">Change it on My pass</a>' : ''}</p>`;
};

export { CARD };
