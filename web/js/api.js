// Everything comes live from AniList. The only things kept in the browser are
// your login token / username (localStorage) and a per-tab copy of your profile
// (sessionStorage) so each page doesn't spend a request asking "who am I?".
const API = 'https://graphql.anilist.co';
const KEY = { token: 'animetro.token', client: 'animetro.client', user: 'animetro.user', me: 'animetro.me', adult: 'animetro.adult', blur: 'animetro.blur', state: 'animetro.loginState' };

export const store = {
  get: (k, s = localStorage) => { try { return s.getItem(k); } catch { return null; } },
  set: (k, v, s = localStorage) => { try { v == null ? s.removeItem(k) : s.setItem(k, v); } catch {} },
};

// AniList implicit-grant login lands back here with #access_token=...&state=...
// Only a login this app started is accepted: the state must match the one-time value loginUrl() made,
// so a crafted link can't quietly swap in someone else's account.
export let loginRejected = false;
const hash = new URLSearchParams(location.hash.slice(1));
if (hash.get('access_token')) {
  const expected = store.get(KEY.state);
  store.set(KEY.state, null);
  if (expected && hash.get('state') === expected) {
    store.set(KEY.token, hash.get('access_token'));
    store.set(KEY.user, null);
    store.set(KEY.me, null, sessionStorage);
  } else loginRejected = true;
  history.replaceState(null, '', location.pathname + location.search); // never leave a token in the address bar
}
export const token = () => store.get(KEY.token);
// Running inside the macOS app (pages load from animetro://) rather than a browser.
export const inApp = location.protocol === 'animetro:';

// 18+ titles stay hidden until the rider opts in (header "18+" button).
export const prefs = {
  adult: () => store.get(KEY.adult) === '1',
  blur: () => store.get(KEY.blur) !== '0',
  set(adult, blur) { store.set(KEY.adult, adult ? '1' : null); store.set(KEY.blur, blur ? null : '0'); },
};
// GraphQL isAdult argument: false hides 18+, undefined (omitted) allows everything.
export const adultArg = () => (prefs.adult() ? undefined : false);
// One AniList client for the whole app. Register it once at anilist.co/settings/developer with the redirect
// URL <site>pass.html and fill both in: every visitor on that site then gets a one-click "Log in with AniList".
// Anywhere else (like localhost) riders can still paste their own client ID.
const APP = { clientId: '', site: '' }; // e.g. { clientId: '12345', site: 'https://you.github.io/animetro/' }
export const builtInLogin = () => !!APP.clientId && location.href.startsWith(APP.site);
export const clientId = () => (builtInLogin() ? APP.clientId : store.get(KEY.client) || '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- rate limit ----------------------------------------------------------
// AniList tells us how many requests are left this minute (X-RateLimit-Remaining, currently 30/min).
// Near zero we pause until the window resets instead of getting refused.
let left = Infinity, resetAt = 0;
const MARGIN = 3; // leave room for requests already in flight
async function gate() {
  if (left > MARGIN || Date.now() >= resetAt) return;
  const wait = resetAt - Date.now();
  dispatchEvent(new CustomEvent('ratelimit', { detail: Math.ceil(wait / 1000) }));
  await sleep(wait);
  left = Infinity;
}
function track(res) {
  const n = res.headers.get('X-RateLimit-Remaining');
  if (n == null) return;
  left = +n;
  const reset = +res.headers.get('X-RateLimit-Reset');
  // ponytail: AniList only sends Reset when you're out, so otherwise assume a full minute
  if (left <= MARGIN && Date.now() >= resetAt) resetAt = reset ? reset * 1000 : Date.now() + 60_000;
}

// ---- short-lived cache ------------------------------------------------------
// Same question within 5 minutes in this tab = same answer, no request. Lives in sessionStorage,
// so it's gone when the tab closes. Any list change (mutation) wipes it.
const TTL = 5 * 60_000, PREFIX = 'animetro.q.';
const digest = str => { let h = 5381; for (let i = 0; i < str.length; i++) h = (h * 33) ^ str.charCodeAt(i); return (h >>> 0).toString(36); };
const cache = {
  get(k) {
    try {
      const v = JSON.parse(sessionStorage.getItem(PREFIX + k));
      return v && Date.now() - v.t < TTL ? v.d : null;
    } catch { return null; }
  },
  set(k, d) {
    const v = JSON.stringify({ t: Date.now(), d });
    if (v.length > 1_000_000) return; // huge lists aren't worth the space
    try { sessionStorage.setItem(PREFIX + k, v); } catch { cache.clear(); try { sessionStorage.setItem(PREFIX + k, v); } catch {} }
  },
  clear() { try { for (let i = sessionStorage.length; i--;) { const k = sessionStorage.key(i); if (k.startsWith(PREFIX)) sessionStorage.removeItem(k); } } catch {} },
};

// Your token only goes with questions about you (your lists, stats, saving). Public lookups go out
// anonymous: a logged-in request makes AniList apply your account's "18+ content" setting and hide
// adult titles, and Animetro's own 18+ switch should decide that instead.
const PERSONAL = /\b(Viewer|mutation|mediaList|MediaListCollection|User)\b/;

// fresh: don't answer from the cache. remember: false = don't put the answer in it either.
export async function gql(query, variables = {}, { fresh = false, remember = true, tries = 3 } = {}) {
  const mutation = /^\s*mutation/.test(query);
  const personal = PERSONAL.test(query);
  const key = digest(query + JSON.stringify(variables) + (personal ? token() || store.get(KEY.user) || '' : ''));
  const hit = !mutation && !fresh && cache.get(key);
  if (hit) return hit;
  if (mutation && meFor !== undefined && meFor !== account()) { // see the storage listener below
    location.reload();
    throw new Error('Your AniList login changed in another tab. Reloading…');
  }

  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token() && personal) headers.Authorization = 'Bearer ' + token();
  await gate();
  let res;
  try {
    res = await fetch(API, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
  } catch {
    throw new Error("Couldn't reach AniList. Check your connection and try again.");
  }
  track(res);
  if (res.status === 429 && tries) {
    const wait = Math.min(+res.headers.get('Retry-After') || 15, 65);
    dispatchEvent(new CustomEvent('ratelimit', { detail: wait }));
    await sleep(wait * 1000);
    return gql(query, variables, { fresh, remember, tries: tries - 1 });
  }
  const json = await res.json().catch(() => ({}));
  if (json.errors?.some(e => e.status === 401 || /invalid token/i.test(e.message))) {
    logout();
    location.reload();
  }
  const empty = !json.data || Object.values(json.data).every(v => v == null);
  if (json.errors && empty) throw Object.assign(new Error(json.errors[0].message), { status: json.errors[0].status });
  if (!json.data) throw new Error('AniList returned an empty response.');
  if (mutation) cache.clear(); else if (!json.errors && remember) cache.set(key, json.data);
  return json.data;
}

// ---- who's riding -------------------------------------------------------
const ME_FIELDS = 'id name avatar{large} bannerImage siteUrl options{profileColor}';
// The saved username has no AniList account (AniList answered 404). Its own type so a page can tell
// "that user doesn't exist" apart from "couldn't reach AniList"; the message already says which name.
export class UnknownUser extends Error {
  constructor(name) { super(`No AniList user called "${name}".`); this.name = 'UnknownUser'; this.username = name; }
}

// The cached profile is stamped with the account it belongs to: a fingerprint of the token (never the token
// itself) or the username. Log in as someone else and the stamp no longer matches, so it's fetched again.
const account = () => (token() ? 't:' + digest(token()) : store.get(KEY.user) ? 'u:' + store.get(KEY.user) : '');
let mePromise, meFor; // meFor: the account this page's identity (and so its list and save buttons) was built for
// null only means nobody is logged in (no token, no username). Anything else that stops us knowing who you
// are (offline, AniList down, an unknown username) rejects, so pages show the error rather than the
// "Connect AniList" screen. A rejection isn't remembered: the next call asks again.
export function me() {
  if (!mePromise) {
    const p = (mePromise = whoAmI((meFor = account())));
    p.catch(() => { if (mePromise === p) mePromise = null; });
  }
  return mePromise;
}
async function whoAmI(who) {
  if (!who) return null;
  try {
    const cached = JSON.parse(store.get(KEY.me, sessionStorage));
    if (cached?.who === who) return cached.user;
  } catch {}
  // Identity has its own cache (KEY.me, written only on success). Through the query cache, an empty answer
  // would be replayed for 5 minutes and a retry could never recover.
  const ask = { fresh: true, remember: false };
  let user = null;
  if (token()) {
    user = (await gql(`{Viewer{${ME_FIELDS}}}`, {}, ask)).Viewer;
    if (!user) throw new Error("AniList didn't send your profile. Try again.");
    user.canWrite = true;
  } else if (store.get(KEY.user)) {
    const name = store.get(KEY.user);
    const notFound = e => { throw e.status === 404 ? new UnknownUser(name) : e; };
    user = (await gql(`query($n:String){User(name:$n){${ME_FIELDS}}}`, { n: name }, ask).catch(notFound)).User;
    if (!user) throw new UnknownUser(name);
    user.canWrite = false;
  }
  if (account() === who) store.set(KEY.me, JSON.stringify({ who, user }), sessionStorage);
  return user;
}

// Another tab logged in, logged out or switched account. Everything on this page (name, list, save buttons)
// belongs to the old account while saves would go out under the new token, so start over.
// (gql refuses a save in the moment before this event arrives.)
addEventListener('storage', e => {
  if (e.storageArea !== localStorage || (e.key !== null && e.key !== KEY.token && e.key !== KEY.user)) return;
  store.set(KEY.me, null, sessionStorage);
  mePromise = meFor = undefined;
  location.reload();
});

export function useUsername(name) {
  store.set(KEY.user, name.trim());
  store.set(KEY.token, null);
  store.set(KEY.me, null, sessionStorage);
  mePromise = meFor = undefined;
}
export function setClientId(id) { store.set(KEY.client, id.trim()); }
export function loginUrl() {
  const state = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  store.set(KEY.state, state);
  return `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(clientId())}&response_type=token&state=${state}`;
}
export function logout() {
  [KEY.token, KEY.user].forEach(k => store.set(k, null));
  cache.clear();
  store.set(KEY.me, null, sessionStorage);
  mePromise = meFor = undefined;
}

// Map of mediaId -> {status, progress, score} for the current rider, in one request.
// Best effort, like the lookup itself: if who you are can't be read, cards just show no list badges.
export async function listStatus(ids) {
  const user = await me().catch(() => null);
  const out = new Map();
  if (!user || !ids.length) return out;
  const pages = Math.ceil(ids.length / 50);
  const parts = Array.from({ length: pages }, (_, i) =>
    `p${i}: Page(page:${i + 1},perPage:50){ mediaList(userId:$u,type:ANIME,mediaId_in:$ids){ mediaId status progress score updatedAt } }`);
  const d = await gql(`query($u:Int,$ids:[Int]){ ${parts.join(' ')} }`, { u: user.id, ids }).catch(() => ({}));
  Object.values(d).forEach(p => p?.mediaList.forEach(e => out.set(e.mediaId, e)));
  return out;
}

// Every title on the rider's list as Map(mediaId -> status). One request, kept in memory for this page only.
let listPromise;
export function myList() {
  return (listPromise ??= me().then(async user => {
    if (!user) return new Map();
    const d = await gql(`query($u:Int){ MediaListCollection(userId:$u,type:ANIME){ lists{ entries{ mediaId status } } } }`, { u: user.id });
    return new Map(d.MediaListCollection.lists.flatMap(l => l.entries).map(e => [e.mediaId, e.status]));
  }).catch(() => new Map()));
}
// "Seen" = anything you've started, finished or given up on. Planning still counts as new.
export const seenIds = async () => [...(await myList())].filter(([, s]) => s !== 'PLANNING').map(([id]) => id);

// Save many entries in one request using aliased mutations.
export async function saveEntries(entries) {
  if (!entries.length) return;
  const body = entries.map((e, i) =>
    `m${i}: SaveMediaListEntry(mediaId:${+e.mediaId}${e.status ? `,status:${e.status}` : ''}${e.progress != null ? `,progress:${+e.progress}` : ''}){ mediaId status progress updatedAt }`);
  const d = await gql(`mutation{ ${body.join(' ')} }`);
  // AniList answers a batch with the entries it saved plus an error for the rest; don't call that a success
  const saved = entries.filter((_, i) => d[`m${i}`]).map(e => +e.mediaId);
  if (saved.length < entries.length) {
    const err = new Error(saved.length
      ? `Saved ${saved.length} of ${entries.length}. The rest didn't go through; try again.`
      : "AniList didn't save that. Try again.");
    err.saved = saved;
    throw err;
  }
  return d;
}

// ---- shared bits ----------------------------------------------------------
export const CARD = 'id title{english romaji} format status episodes duration seasonYear averageScore popularity genres coverImage{large color} isAdult';

export const title = m => m?.title?.english || m?.title?.romaji || 'Untitled';

// AniList's SEARCH_MATCH loves obscure synonym hits ("Demon Slayer" -> a 1996 OVA called Onigiri).
// Re-rank: exact title match, then titles containing the query by popularity, then the rest as-is.
export function rankSearch(list, q) {
  const n = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const want = n(q);
  const names = m => [n(m.title.english), n(m.title.romaji)];
  const tier = m => (names(m).includes(want) ? 0 : names(m).some(t => t.includes(want)) ? 1 : 2);
  return list.map((m, i) => ({ m, i })).sort((a, b) => tier(a.m) - tier(b.m) || (tier(a.m) === 1 ? b.m.popularity - a.m.popularity : a.i - b.i)).map(x => x.m);
}

export function plainText(html = '') {
  const doc = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, '\n'), 'text/html');
  return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

// "Ticket class" — AniList has no official age rating, so we estimate from genres/tags.
// isAdult: false = never 18+, true = only 18+, undefined = follow the rider's 18+ setting.
export const TICKETS = {
  everyone: { label: 'Everyone', note: 'No horror, gore, nudity or fan service', isAdult: false, genre_not_in: ['Ecchi', 'Hentai', 'Horror'], tag_not_in: ['Gore', 'Nudity', 'Torture', 'Suicide', 'Cannibalism'] },
  teen: { label: 'Teen', note: 'No fan service or nudity', isAdult: false, genre_not_in: ['Ecchi', 'Hentai'], tag_not_in: ['Nudity'] },
  mature: { label: 'Mature', get note() { return prefs.adult() ? 'Anything goes, 18+ included' : 'Anything except 18+ titles'; }, genre_not_in: [], tag_not_in: [] },
  adult: { label: '18+ only', note: 'Only titles AniList marks as adult, mostly hentai', isAdult: true, gated: true, genre_not_in: [], tag_not_in: [] },
};
export const tickets = () => Object.entries(TICKETS).filter(([, t]) => !t.gated || prefs.adult());
export const ticketAdult = t => (t.isAdult ?? adultArg());
