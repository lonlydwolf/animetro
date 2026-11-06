// Everything comes live from AniList. The only things kept in the browser are
// your login token / username (localStorage) and a per-tab copy of your profile
// (sessionStorage) so each page doesn't spend a request asking "who am I?".
const API = 'https://graphql.anilist.co';
const KEY = { token: 'animetro.token', client: 'animetro.client', user: 'animetro.user', me: 'animetro.me' };

// AniList implicit-grant login lands back here with #access_token=...
const hash = new URLSearchParams(location.hash.slice(1));
if (hash.get('access_token')) {
  localStorage.setItem(KEY.token, hash.get('access_token'));
  localStorage.removeItem(KEY.user);
  sessionStorage.removeItem(KEY.me);
  history.replaceState(null, '', location.pathname + location.search);
}

const store = {
  get: (k, s = localStorage) => { try { return s.getItem(k); } catch { return null; } },
  set: (k, v, s = localStorage) => { try { v == null ? s.removeItem(k) : s.setItem(k, v); } catch {} },
};
export const token = () => store.get(KEY.token);
export const clientId = () => store.get(KEY.client) || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function gql(query, variables = {}, tries = 3) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token()) headers.Authorization = 'Bearer ' + token();
  let res;
  try {
    res = await fetch(API, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
  } catch {
    throw new Error("Couldn't reach AniList. Check your connection and try again.");
  }
  if (res.status === 429 && tries) {
    // ponytail: AniList allows ~30 req/min right now; we just wait it out.
    const wait = Math.min(+res.headers.get('Retry-After') || 15, 65);
    dispatchEvent(new CustomEvent('ratelimit', { detail: wait }));
    await sleep(wait * 1000);
    return gql(query, variables, tries - 1);
  }
  const json = await res.json().catch(() => ({}));
  if (json.errors?.some(e => e.status === 401 || /invalid token/i.test(e.message))) {
    logout();
    location.reload();
  }
  const empty = !json.data || Object.values(json.data).every(v => v == null);
  if (json.errors && empty) throw new Error(json.errors[0].message);
  if (!json.data) throw new Error('AniList returned an empty response.');
  return json.data;
}

// ---- who's riding -------------------------------------------------------
const ME_FIELDS = 'id name avatar{large} bannerImage siteUrl options{profileColor}';
let mePromise;
export function me() {
  return (mePromise ??= (async () => {
    const cached = store.get(KEY.me, sessionStorage);
    if (cached) return JSON.parse(cached);
    let user = null;
    if (token()) {
      user = (await gql(`{Viewer{${ME_FIELDS}}}`)).Viewer;
      if (user) user.canWrite = true;
    } else if (store.get(KEY.user)) {
      user = (await gql(`query($n:String){User(name:$n){${ME_FIELDS}}}`, { n: store.get(KEY.user) }).catch(() => null))?.User;
      if (user) user.canWrite = false;
    }
    if (user) store.set(KEY.me, JSON.stringify(user), sessionStorage);
    return user;
  })().catch(() => null));
}

export function useUsername(name) {
  store.set(KEY.user, name.trim());
  store.set(KEY.token, null);
  store.set(KEY.me, null, sessionStorage);
  mePromise = null;
}
export function setClientId(id) { store.set(KEY.client, id.trim()); }
export function loginUrl() {
  return `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(clientId())}&response_type=token`;
}
export function logout() {
  [KEY.token, KEY.user].forEach(k => store.set(k, null));
  store.set(KEY.me, null, sessionStorage);
  mePromise = null;
}

// Map of mediaId -> {status, progress, score} for the current rider, in one request.
export async function listStatus(ids) {
  const user = await me();
  const out = new Map();
  if (!user || !ids.length) return out;
  const pages = Math.ceil(ids.length / 50);
  const parts = Array.from({ length: pages }, (_, i) =>
    `p${i}: Page(page:${i + 1},perPage:50){ mediaList(userId:$u,type:ANIME,mediaId_in:$ids){ mediaId status progress score } }`);
  const d = await gql(`query($u:Int,$ids:[Int]){ ${parts.join(' ')} }`, { u: user.id, ids }).catch(() => ({}));
  Object.values(d).forEach(p => p?.mediaList.forEach(e => out.set(e.mediaId, e)));
  return out;
}

// Save many entries in one request using aliased mutations.
export async function saveEntries(entries) {
  if (!entries.length) return;
  const body = entries.map((e, i) =>
    `m${i}: SaveMediaListEntry(mediaId:${+e.mediaId}${e.status ? `,status:${e.status}` : ''}${e.progress != null ? `,progress:${+e.progress}` : ''}){ mediaId status progress }`);
  return gql(`mutation{ ${body.join(' ')} }`);
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
export const TICKETS = {
  everyone: { label: 'Everyone', note: 'No horror, gore, nudity or fan service', genre_not_in: ['Ecchi', 'Hentai', 'Horror'], tag_not_in: ['Gore', 'Nudity', 'Torture', 'Suicide', 'Cannibalism'] },
  teen: { label: 'Teen', note: 'No fan service or nudity', genre_not_in: ['Ecchi', 'Hentai'], tag_not_in: ['Nudity'] },
  mature: { label: 'Mature', note: 'Anything except 18+ titles', genre_not_in: [], tag_not_in: [] },
};
