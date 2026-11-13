// Backup sync to Simkl. Off unless switched on (My pass > Backup sync), and it only runs when you press
// the button. One way: AniList -> Simkl. Nothing on AniList changes and nothing on Simkl is removed.
// Simkl takes AniList IDs and plain episode numbers for anime, so no title matching is needed.
// Docs: https://api.simkl.org (rules we follow: 1 write per second, batched, one request at a time).
const API = 'https://api.simkl.com';
const APP = 'app-name=animetro&app-version=1.0';
const KEY = { on: 'animetro.sync', client: 'animetro.simkl.client', token: 'animetro.simkl.token' };
const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- switch, client ID, login ---------------------------------------------
export const syncOn = () => get(KEY.on) === '1';
export function setSyncOn(on) {
  put(KEY.on, on ? '1' : null);
  if (!on) [KEY.client, KEY.token].forEach(k => put(k, null)); // turning it off forgets everything
}
export const simklClient = () => get(KEY.client) || '';
export const setSimklClient = id => put(KEY.client, id.trim() || null);
const tokens = () => { try { return JSON.parse(get(KEY.token)); } catch { return null; } };
export const simklConnected = () => !!tokens()?.access;
export const simklDisconnect = () => put(KEY.token, null);
// Simkl's refresh token doesn't rotate, so a renewal may answer without one: then the one we have stays.
const keep = t => put(KEY.token, JSON.stringify({ access: t.access_token, refresh: t.refresh_token || tokens()?.refresh, expires: Date.now() + t.expires_in * 1000 }));

async function oauth(path, fields) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: simklClient(), ...fields }),
  }).catch(() => { throw new Error("Couldn't reach Simkl. Check your connection."); });
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
}

// Device login: Simkl gives a short code, you approve it on simkl.com, we poll until it lands.
export async function startLogin() {
  const r = await oauth('/oauth2/device', { scope: 'media:read media:write' });
  if (r.ok) return r.json; // { device_code, user_code, verification_uri, verification_uri_complete, interval, expires_in }
  throw new Error(r.json.error === 'invalid_client'
    ? "Simkl doesn't accept that client ID. Check it, and that the app was created on simkl.com/settings/developer as a new (AUTH V2) app."
    : r.json.error_description || `Simkl answered ${r.status}.`);
}
export async function waitForLogin(code, signal) {
  let wait = (code.interval || 5) * 1000;
  const end = Date.now() + (code.expires_in || 900) * 1000;
  while (Date.now() < end) {
    await sleep(wait);
    if (signal?.aborted) throw new Error('Cancelled.');
    const r = await oauth('/oauth2/token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: code.device_code });
    if (r.ok) return keep(r.json);
    const err = r.json.error;
    if (err === 'slow_down') wait += 5000;
    else if (err !== 'authorization_pending') throw new Error(err === 'access_denied' ? 'You declined on Simkl.' : err === 'expired_token' ? 'The code expired. Try again.' : r.json.error_description || 'Simkl login failed.');
  }
  throw new Error('The code expired. Try again.');
}

// Access tokens last 7 days; the refresh token gets a new one for 180 days. It doesn't change itself (Simkl's
// refresh tokens don't rotate), but each renewal replaces the access token, so the previous one stops working.
// force: Simkl just rejected the access token (401), so renew it even if it isn't due.
async function access(force = false) {
  const t = tokens();
  if (!t) throw new Error('Connect Simkl first.');
  if (!force && Date.now() < t.expires - 864e5) return t.access;
  const r = await oauth('/oauth2/token', { grant_type: 'refresh_token', refresh_token: t.refresh }); // throws, connected, if unreachable
  if (r.ok) { keep(r.json); return r.json.access_token; }
  // Only a rejected refresh token means the login is gone. A busy or broken Simkl (5xx, 429) keeps it.
  if (r.status === 400 || r.status === 401) { simklDisconnect(); throw new Error('Your Simkl login ran out. Connect again.'); }
  if (!force && Date.now() < t.expires) return t.access; // renewal was early anyway; the current token still works
  throw new Error(`Simkl couldn't renew your login just now (it answered ${r.status}). You're still connected; try again in a minute.`);
}

let lastWrite = 0;
// One retry for each kind of trouble: a 401 renews the token once, a 429 waits once. Waiting never renews:
// the retry after a 429 sends the very token the 429 answered (token), without asking access() again.
async function call(path, body, { renewed = false, waited = false, renew = false, token } = {}) {
  if (body) { // Simkl allows one write per second per app and user, and suspends apps that go faster
    const gap = lastWrite + 1100 - Date.now();
    if (gap > 0) await sleep(gap);
    lastWrite = Date.now();
  }
  const auth = token ?? await access(renew);
  const res = await fetch(`${API}${path}${path.includes('?') ? '&' : '?'}client_id=${encodeURIComponent(simklClient())}&${APP}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + auth, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => { throw new Error("Couldn't reach Simkl. Check your connection."); });
  if (res.status === 401 && !renewed) return call(path, body, { renewed: true, waited, renew: true });
  if (res.status === 429 && !waited) {
    await sleep(Math.min(+res.headers.get('Retry-After') || 10, 60) * 1000);
    return call(path, body, { renewed, waited: true, token: auth });
  }
  if (!res.ok) throw new Error(`Simkl answered ${res.status}. Nothing after this point was sent.`);
  return res.json().catch(() => ({}));
}

// Your anime on Simkl, every status.
export const simklLibrary = () => call('/sync/all-items/anime').then(d => d?.anime || []);

// ---- what would change ------------------------------------------------------
const STATUS = { CURRENT: 'watching', PLANNING: 'plantowatch', COMPLETED: 'completed', REPEATING: 'completed', PAUSED: 'hold', DROPPED: 'dropped' };
export const SIMKL_LABEL = { watching: 'Watching', plantowatch: 'Plan to watch', completed: 'Completed', hold: 'On hold', dropped: 'Dropped' };
const range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

// entries: AniList list entries ({ status, progress, score (0-10), media: { id, idMal, episodes, title } }).
// library: Simkl's /sync/all-items/anime rows. Returns the writes to send plus a readable list of changes.
export function plan(entries, library) {
  const byAniList = new Map(), byMal = new Map();
  for (const row of library) {
    const ids = (row.anime || row.show || {}).ids || {};
    if (ids.anilist) byAniList.set(+ids.anilist, row);
    if (ids.mal) byMal.set(+ids.mal, row);
  }
  const out = { history: [], list: [], ratings: [], changes: [], episodes: 0 };
  for (const e of entries) {
    const m = e.media, to = STATUS[e.status];
    if (!to) continue;
    const row = byAniList.get(m.id) || (m.idMal && byMal.get(m.idMal));
    const ids = { anilist: m.id, ...(m.idMal ? { mal: m.idMal } : {}) };
    const from = row?.status, had = row?.watched_episodes_count || 0;
    const change = { media: m, from, to, eps: 0, simkl: (row?.anime || row?.show)?.ids?.simkl };
    if (to === 'completed') {
      // a whole-show "completed" marks every episode watched in one go
      if (from !== 'completed') { out.history.push({ ids, status: 'completed' }); change.eps = Math.max(0, (m.episodes || e.progress || 0) - had); }
    } else if (e.progress > had) {
      out.history.push({ ids, status: to, episodes: range(had + 1, e.progress).map(number => ({ number })) });
      change.eps = e.progress - had;
    } else if (from !== to) {
      out.list.push({ ids, to });
    }
    const rating = Math.round(e.score || 0);
    if (rating >= 1 && rating <= 10 && row?.user_rating !== rating) { out.ratings.push({ ids, rating }); change.rating = rating; }
    if (from !== to || change.eps || change.rating) {
      out.changes.push(change);
      out.episodes += change.eps;
    }
  }
  return out;
}

// Sends a plan in batches of 50, one write per second. Returns what Simkl couldn't match.
export async function send(p, onProgress = () => {}) {
  const batches = (path, items) => Array.from({ length: Math.ceil(items.length / 50) }, (_, i) => [path, { anime: items.slice(i * 50, i * 50 + 50) }]);
  const jobs = [...batches('/sync/history', p.history), ...batches('/sync/add-to-list', p.list), ...batches('/sync/ratings', p.ratings)];
  const missing = new Set();
  for (const [i, [path, body]] of jobs.entries()) {
    const r = await call(path, body);
    for (const k of ['anime', 'shows', 'movies']) for (const x of r?.not_found?.[k] || []) if (x.ids?.anilist) missing.add(+x.ids.anilist);
    onProgress(i + 1, jobs.length);
  }
  return missing;
}
