// Liveries (themes). The colors live in css/style.css as [data-theme] blocks, each with a light mode; js/boot.js
// puts the saved choice on <html> before the page paints. This module changes them and draws the picker.
import { store } from './api.js';

// [id, name, name of its light mode when it has its own]
export const LIVERIES = [
  ['Animetro', [['last-train', 'Last Train', 'Morning Commute']]],
  ['Anime', [['unit-01', 'Evangelion Unit-01'], ['spirited-away', 'Spirited Away'], ['your-name', 'Your Name'], ['akira', 'Akira'],
    ['cowboy-bebop', 'Cowboy Bebop'], ['demon-slayer', 'Demon Slayer'], ['jujutsu-kaisen', 'Jujutsu Kaisen'], ['one-piece', 'One Piece'],
    ['sailor-moon', 'Sailor Moon'], ['frieren', 'Frieren']]],
  ['Catppuccin', [['mocha', 'Mocha', 'Latte'], ['macchiato', 'Macchiato', 'Latte'], ['frappe', 'Frappé', 'Latte']]],
  ['Editor classics', [['dracula', 'Dracula', 'Alucard'], ['nord', 'Nord'], ['tokyo-night', 'Tokyo Night', 'Tokyo Day'],
    ['gruvbox', 'Gruvbox'], ['rose-pine', 'Rosé Pine', 'Rosé Pine Dawn'], ['solarized', 'Solarized']]],
];
const IDS = new Set(LIVERIES.flatMap(([, ls]) => ls.map(l => l[0])));
const root = () => document.documentElement;

export const livery = () => (IDS.has(root().dataset.theme) ? root().dataset.theme : 'last-train');
export const mode = () => (root().dataset.mode === 'light' ? 'light' : 'dark');

export function setLivery(id) {
  if (!IDS.has(id)) return;
  root().dataset.theme = id;
  store.set('animetro.theme', id === 'last-train' ? null : id);
  changed();
}

export function setMode(m) {
  root().dataset.mode = m;
  store.set('animetro.mode', m);
  changed();
}

// Tell the page that the colors changed, and the Mac app's window, so its title bar and background match.
function changed() {
  dispatchEvent(new Event('livery'));
  tellApp();
}
export function tellApp() {
  const bg = getComputedStyle(root()).getPropertyValue('--night').trim();
  window.webkit?.messageHandlers?.animetro?.postMessage({ type: 'look', mode: mode(), bg });
}

// The picker on My pass (names are fixed strings above, so no escaping needed). Each swatch shows the livery's dark half and light half, drawn by the livery's own CSS.
export function picker(el) {
  const half = (id, m) => `<span class="lv-half" data-theme="${id}" data-mode="${m}"><i class="lv-card"><i></i><i></i></i><i class="lv-btn"></i></span>`;
  const draw = () => {
    const cur = livery(), lit = mode() === 'light', focused = el.contains(document.activeElement);
    el.innerHTML = `
      <div class="section-head"><h2>Livery</h2><span class="hint" style="margin:0">Paint the whole app. ${lit ? 'Light' : 'Dark'} mode now; switch with the ${lit ? '☾' : '☀'} button at the top of any page.</span></div>
      ${LIVERIES.map(([group, list]) => `
        <h3 class="lv-group">${group}</h3>
        <div class="liveries" role="group" aria-label="${group}">${list.map(([id, name, light]) => `
          <button class="livery" aria-pressed="${id === cur}" data-livery="${id}">
            <span class="lv-swatch">${half(id, 'dark')}${half(id, 'light')}</span>
            <b>${name}</b>
            ${light ? `<small>Light mode: ${light}</small>` : ''}
          </button>`).join('')}</div>`).join('')}`;
    if (focused) el.querySelector('[aria-pressed="true"]').focus();
  };
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-livery]');
    if (b) setLivery(b.dataset.livery);
  });
  addEventListener('livery', draw);
  draw();
}
