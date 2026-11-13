// A tiny stand-in browser for the page scripts' paging tests (history.js, explore.js). Import it before any
// app module: it swaps api.js for a stub whose network calls go to globalThis.__gql / __listStatus, and gives
// the scripts just enough DOM to run. Uses module.registerHooks (Node 22.15+); `supported` says if it is there.
import './setup.mjs';
import * as mod from 'node:module';

export const supported = typeof mod.registerHooks === 'function';

const API = `
export const gql = (...a) => globalThis.__gql(...a);
export const listStatus = ids => globalThis.__listStatus(ids);
export const me = async () => globalThis.__me;
export const title = m => m.title.english;
export const rankSearch = () => [];
export const CARD = 'id';
export const prefs = { adult: () => false, blur: () => false };
export const adultArg = () => false;
export const TICKETS = { mature: { label: 'All', note: 'n', genre_not_in: [], tag_not_in: [] } };
export const tickets = () => Object.entries(TICKETS);
export const ticketAdult = () => false;
export const seenIds = async () => [];`;
const THEMES = 'export const mode = () => "dark", setMode = () => {}, tellApp = () => {};';
const asUrl = src => `data:text/javascript,${encodeURIComponent(src)}`;

if (supported) {
  mod.registerHooks({
    resolve(spec, ctx, next) {
      if (/(^|\/)api\.js$/.test(spec)) return { url: asUrl(API), shortCircuit: true };
      if (/(^|\/)themes\.js$/.test(spec)) return { url: asUrl(THEMES), shortCircuit: true };
      return next(spec, ctx);
    },
  });
}

class El {
  constructor() {
    Object.assign(this, { innerHTML: '', textContent: '', className: '', style: {}, disabled: false, hidden: false, elements: {}, dataset: {} });
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  addEventListener() {}
  setAttribute() {}
  getAttribute() { return ''; }
  insertAdjacentHTML(_, html) { this.innerHTML += html; }
  prepend() {}
  append() {}
  after() {}
  reset() {}
  querySelector(s) { return document.querySelector(s); }
}

const els = new Map();
globalThis.document = {
  // every id the scripts ask for exists; the toast only once ui.js has made it
  querySelector: s => { if (!els.has(s) && s !== '.toast') els.set(s, new El()); return els.get(s) ?? null; },
  createElement: () => new El(),
  body: Object.assign(new El(), { append: e => e.className === 'toast' && els.set('.toast', e) }),
};
globalThis.addEventListener = () => {};
globalThis.history = { replaceState() {} };
globalThis.IntersectionObserver = class { observe() {} };
globalThis.FormData = class { get() { return null; } getAll() { return []; } };

export const $ = s => document.querySelector(s);
export const toastText = () => $('.toast')?.textContent ?? '';
// let pending promise chains (and the scripts' awaits) run to the end
export const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)); };
export const deferred = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };
