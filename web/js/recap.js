// Welcome Back Carriage: when you come back to a show, where you stopped and what happened in your last two
// stops (Kitsu's episode summaries, opened one at a time). Paused shows always get it; shows you're watching
// get it on request, or always if you opt in (home page: Recaps on).
import { store } from './api.js';
import { esc, safeUrl } from './ui.js';
import { kitsuId, kitsuRange } from './episodes.js';

const KEY = 'animetro.recap';
export const recapOn = () => store.get(KEY) === '1';
export const setRecap = on => store.set(KEY, on ? '1' : null);

// 'open': show the panel straight away; 'offer': a "Need a recap?" button; null: nothing to recap yet.
export function recapMode(entry, optIn = recapOn()) {
  if (!entry || !(entry.progress > 0)) return null;
  if (entry.status === 'PAUSED') return 'open';
  if (entry.status === 'CURRENT' || entry.status === 'REPEATING') return optIn ? 'open' : 'offer';
  return null;
}

// The episodes to recap: your last `n` watched ones, oldest first.
export const lastStops = (progress, n = 2) => Array.from({ length: Math.min(n, progress) }, (_, i) => progress - Math.min(n, progress) + 1 + i);

// "3 months ago" from a unix timestamp in seconds.
export function ago(ts, now = Date.now()) {
  if (!ts) return '';
  const days = Math.floor((now - ts * 1000) / 864e5);
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 730) return `${Math.round(days / 30.4)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

// Kitsu episodes for the last stops and the next one, by number. Empty if Kitsu doesn't have the show.
async function stopsFromKitsu(media, progress) {
  const kid = await kitsuId(media);
  if (!kid) return new Map();
  const from = Math.max(0, progress - 2);
  const { eps } = await kitsuRange(kid, from, 3);
  return new Map(eps.filter(e => e.number).map(e => [e.number, e]));
}

const epTitle = e => e?.titles?.en_us || e?.titles?.en || e?.canonicalTitle || '';

// Fills `el` with the panel for `entry` on `media` (its total and next airing episode come from AniList).
export async function recapPanel(el, media, entry) {
  const p = entry.progress, total = media.episodes, gen = (el.recapGen = (el.recapGen || 0) + 1); // a newer call wins
  const when = entry.status === 'PAUSED' ? `paused ${ago(entry.updatedAt)}` : `last logged ${ago(entry.updatedAt)}`;
  el.hidden = false;
  el.innerHTML = `
    <div class="recap-head"><span class="recap-icon" aria-hidden="true">↩</span>
      <div><h2 id="recap-h" tabindex="-1">Welcome back aboard</h2>
      <p class="hint" style="margin:0">You stopped after episode ${p}${total ? ` of ${total}` : ''}${entry.updatedAt ? `, ${when}` : ''}.</p></div></div>
    <p class="hint" id="recap-wait">Fetching your last stops…</p>`;
  let k = new Map();
  try { k = await stopsFromKitsu(media, p); } catch { /* Kitsu down: titles and summaries just stay empty */ }
  if (el.recapGen !== gen) return;
  const nextN = p + 1, aired = media.status === 'NOT_YET_RELEASED' ? 0 : media.nextAiringEpisode ? media.nextAiringEpisode.episode - 1 : Infinity;
  const next = !total || nextN <= total ? nextN : null;
  const stops = lastStops(p), summed = stops.some(n => k.get(n)?.description), fromKitsu = summed || stops.some(n => epTitle(k.get(n)));
  // main characters' faces: the fastest reminder of who's who when you watch a lot of shows at once
  const cast = (media.characters?.edges || []).filter(c => c.role === 'MAIN').slice(0, 6);
  el.querySelector('#recap-wait').outerHTML = `
    <ol class="recap-stops">${stops.map(n => {
      const e = k.get(n), thumb = safeUrl(e?.thumbnail?.original);
      return `<li>
        ${thumb ? `<img src="${thumb}" alt="" loading="lazy">` : `<span class="recap-n">${n}</span>`}
        <div><small>Episode ${n}${n === p ? ' · where you stopped' : ''}</small><b>${esc(epTitle(e) || `Episode ${n}`)}</b>
          ${e?.description ? `<details><summary>What happened</summary><p>${esc(e.description)}</p></details>` : ''}</div>
      </li>`;
    }).join('')}</ol>
    ${summed ? '' : '<p class="hint" style="margin:0">No episode summaries for this show yet; the synopsis below is the next best reminder.</p>'}
    ${cast.length ? `<div class="recap-cast"><small>Who's who</small><ul>${cast.map(c => `
      <li>${safeUrl(c.node.image?.medium) ? `<img src="${safeUrl(c.node.image.medium)}" alt="" loading="lazy">` : ''}<span>${esc(c.node.name.full)}</span></li>`).join('')}</ul></div>` : ''}
    ${next ? `<p class="recap-next">Next stop: <b>Episode ${next}${epTitle(k.get(next)) ? ` · ${esc(epTitle(k.get(next)))}` : ''}</b>${next > aired ? ' (not aired yet)' : ''}</p>` : ''}
    ${fromKitsu ? '<p class="hint" style="margin:0">Episode titles and summaries from <a href="https://kitsu.app" target="_blank" rel="noopener">Kitsu</a>. The next stop stays a mystery.</p>' : ''}`;
}
